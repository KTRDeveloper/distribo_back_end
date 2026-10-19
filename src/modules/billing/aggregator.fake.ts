import { randomUUID } from 'node:crypto';
import type { AggregatorPayment, AggregatorStatus, PaymentAggregator } from './aggregator.port.js';

const SIGNATURE_HEADER = 'x-fake-signature';
const VALID_SIGNATURE = 'valid';

/**
 * In-memory aggregator for tests and local runs (ADR-006). Not a production adapter.
 * Test helpers: `settle`, `confirmationFor`, `reset`.
 */
export class FakeAggregator implements PaymentAggregator {
  private readonly byClientReference = new Map<string, string>();
  private readonly payments = new Map<string, AggregatorPayment>();

  requestPayment(input: {
    clientReference: string;
    amount: bigint;
    operator: 'MTN_MOMO' | 'ORANGE_MONEY';
    payerPhone: string;
    description: string;
  }): Promise<{ providerReference: string }> {
    if (input.amount <= 0n) {
      return Promise.reject(new RangeError('amount must be greater than 0'));
    }
    const existing = this.byClientReference.get(input.clientReference);
    if (existing !== undefined) {
      return Promise.resolve({ providerReference: existing });
    }
    const providerReference = `fake-${randomUUID()}`;
    this.byClientReference.set(input.clientReference, providerReference);
    this.payments.set(providerReference, {
      providerReference,
      status: 'PENDING',
      amount: input.amount,
      paidAt: null,
    });
    return Promise.resolve({ providerReference });
  }

  getStatus(providerReference: string): Promise<AggregatorPayment | null> {
    const payment = this.payments.get(providerReference);
    return Promise.resolve(payment ? { ...payment } : null);
  }

  /** Accepts only the fake signature header; a body that is not a JSON reference gives null. */
  verifyConfirmation(input: {
    headers: Record<string, string | undefined>;
    rawBody: Buffer;
  }): { providerReference: string } | null {
    if (input.headers[SIGNATURE_HEADER] !== VALID_SIGNATURE) {
      return null;
    }
    let body: unknown;
    try {
      body = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      return null;
    }
    if (typeof body !== 'object' || body === null) {
      return null;
    }
    const providerReference = (body as { providerReference?: unknown }).providerReference;
    return typeof providerReference === 'string' && providerReference.length > 0
      ? { providerReference }
      : null;
  }

  listStatement(day: string): Promise<AggregatorPayment[]> {
    return Promise.resolve(
      [...this.payments.values()]
        .filter(
          (payment) => payment.paidAt !== null && payment.paidAt.toISOString().slice(0, 10) === day
        )
        .map((payment) => ({ ...payment }))
    );
  }

  /** Test helper: moves a payment to a final status. `paidAt` defaults to now for SUCCEEDED. */
  settle(providerReference: string, status: AggregatorStatus, paidAt?: Date): void {
    const payment = this.payments.get(providerReference);
    if (!payment) {
      throw new Error('unknown provider reference');
    }
    payment.status = status;
    payment.paidAt = paidAt ?? (status === 'SUCCEEDED' ? new Date() : null);
  }

  /** Test helper: a call as the aggregator would send it (valid signature header). */
  confirmationFor(providerReference: string): {
    headers: Record<string, string | undefined>;
    rawBody: Buffer;
  } {
    return {
      headers: { [SIGNATURE_HEADER]: VALID_SIGNATURE },
      rawBody: Buffer.from(JSON.stringify({ providerReference })),
    };
  }

  /** Test helper: forgets every payment. */
  reset(): void {
    this.byClientReference.clear();
    this.payments.clear();
  }
}
