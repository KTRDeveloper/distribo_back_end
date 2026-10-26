import type { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import type { PackMonths, PaidPlanCode } from '../../shared/plans.js';
import { insertCreditNote, insertReceipt, nextReceiptNumber, type ReceiptRow } from './receipt.repository.js';

/**
 * Cancels a frozen receipt without recalculating its customer, tax rate or positive amounts.
 * @param tx Caller transaction shared with payment status, periods and events (ASVS 2.3.3).
 * @param receipt Original receipt whose values must cancel exactly (ASVS 2.2.3).
 * @param now Issue date used for the shared gapless receipt series (C-54).
 * @returns The immutable credit note linked to the original receipt.
 */
export async function issueCreditNote(
  tx: Prisma.TransactionClient,
  receipt: ReceiptRow,
  now: Date,
): Promise<ReceiptRow> {
  return insertCreditNote(tx, await nextReceiptNumber(tx, now), receipt, now);
}

export type ReceiptInput = {
  payment: {
    id: string;
    organizationId: string;
    plan: PaidPlanCode;
    months: PackMonths;
    amount: bigint;
    customerTaxId: string | null;
  };
  customerName: string;
  startsAt: Date;
  endsAt: Date;
  now: Date;
};

const PLAN_LABELS: Readonly<Record<PaidPlanCode, string>> = {
  ESSENTIAL: 'Essentiel',
  PRO: 'Pro',
  ENTERPRISE: 'Entreprise',
};

const RECEIPT_TIME_ZONE = 'Africa/Douala';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: RECEIPT_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Formats a date as dd/mm/yyyy in the Africa/Douala zone. */
function formatDate(date: Date): string {
  const parts = Object.fromEntries(dateFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year}`;
}

/**
 * Splits a VAT-inclusive total: `amountExclTax = round(total × 10000 / (10000 + rateBp))` to
 * the nearest franc, half up, in integer arithmetic; `vatAmount` is the rest, so the two
 * always add up to the total (ASVS v5.0.0-2.2.3).
 */
export function splitVat(
  total: bigint,
  rateBp: number
): { amountExclTax: bigint; vatAmount: bigint } {
  const divisor = 10000n + BigInt(rateBp);
  const amountExclTax = (total * 10000n * 2n + divisor) / (divisor * 2n);
  return { amountExclTax, vatAmount: total - amountExclTax };
}

/**
 * Issues the frozen receipt of a confirmed payment. The number is taken in the caller's
 * transaction, so a rollback frees it and the series has no gap (C-54, ASVS v5.0.0-2.3.3).
 * `now` is both the issue date and the year of the number.
 */
export async function issueReceipt(
  tx: Prisma.TransactionClient,
  input: ReceiptInput
): Promise<ReceiptRow> {
  const { payment } = input;
  const { amountExclTax, vatAmount } = splitVat(payment.amount, env.VAT_RATE_BP);
  const duration = `${payment.months} mois`;
  const label =
    `${PLAN_LABELS[payment.plan]} — ${duration}, ` +
    `du ${formatDate(input.startsAt)} au ${formatDate(input.endsAt)}`;
  const number = await nextReceiptNumber(tx, input.now);
  return insertReceipt(tx, number, {
    organizationId: payment.organizationId,
    paymentId: payment.id,
    customerName: input.customerName,
    customerTaxId: payment.customerTaxId,
    label,
    amountExclTax,
    vatRateBp: env.VAT_RATE_BP,
    vatAmount,
    amount: payment.amount,
    issuedAt: input.now,
  });
}
