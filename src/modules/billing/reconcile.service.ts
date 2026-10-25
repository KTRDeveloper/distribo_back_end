import { z } from 'zod';
import { getPaymentAggregator } from './aggregator.js';
import { findPaymentsByReferences, listConfirmedOn } from './payment.repository.js';

export type PaymentMismatch = {
  event: 'payment_unknown_locally' | 'money_without_plan' | 'payment_amount_differs' | 'plan_without_money';
  id: string;
};

const utcDay = z.string().length(10).regex(/^\d{4}-\d{2}-\d{2}$/).refine((day) => {
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
});

/**
 * Compares a UTC statement with local payments without repairing any row (C-53).
 * Only ids and fixed events leave this service; amounts and payer data never enter logs.
 * @param day Complete UTC calendar day, YYYY-MM-DD.
 * @param _now Job clock; comparisons use the requested day, not payment creation time.
 * @returns All mismatches, using the provider reference only when no local id exists.
 * @throws On invalid input or any failed read, so an unavailable check cannot appear clean (ASVS 16.5.3).
 */
export async function reconcilePayments(day: string, _now: Date): Promise<PaymentMismatch[]> {
  utcDay.parse(day);
  const statement = await getPaymentAggregator().listStatement(day);
  const successful = statement.filter((payment) => payment.status === 'SUCCEEDED');
  const references = successful.map((payment) => payment.providerReference);
  const local = await findPaymentsByReferences(references);
  const confirmed = await listConfirmedOn(day);
  const byReference = new Map(local.map((payment) => [payment.providerReference, payment]));
  const succeededReferences = new Set(references);
  const mismatches: PaymentMismatch[] = [];

  for (const line of successful) {
    const payment = byReference.get(line.providerReference);
    if (!payment) {
      mismatches.push({ event: 'payment_unknown_locally', id: line.providerReference });
    } else if (payment.status !== 'SUCCEEDED' && payment.status !== 'REFUNDED') {
      mismatches.push({ event: 'money_without_plan', id: payment.id });
    } else if (payment.status === 'SUCCEEDED' && payment.amount !== line.amount) {
      mismatches.push({ event: 'payment_amount_differs', id: payment.id });
    }
  }
  for (const payment of confirmed) {
    if (!succeededReferences.has(payment.providerReference)) {
      mismatches.push({ event: 'plan_without_money', id: payment.id });
    }
  }
  return mismatches;
}
