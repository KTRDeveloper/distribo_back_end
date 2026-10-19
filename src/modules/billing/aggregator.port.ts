/**
 * Port to the Mobile Money payment aggregator (ADR-006). Billing code depends on
 * this type only; the real adapter is in no story, the fake one serves tests and local runs.
 */

export type AggregatorOperator = 'MTN_MOMO' | 'ORANGE_MONEY';

export type AggregatorStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';

export type AggregatorPayment = {
  providerReference: string;
  status: AggregatorStatus;
  /** Integer XAF. */
  amount: bigint;
  paidAt: Date | null;
};

export type PaymentAggregator = {
  /**
   * Asks the aggregator to collect a payment. Repeating a `clientReference` returns the same
   * `providerReference`. Throws a RangeError for an amount of 0 or less (v5.0.0-2.2.1).
   */
  requestPayment(input: {
    clientReference: string;
    amount: bigint;
    operator: AggregatorOperator;
    payerPhone: string;
    description: string;
  }): Promise<{ providerReference: string }>;

  /** Reads the payment at the aggregator; null when the reference is unknown. */
  getStatus(providerReference: string): Promise<AggregatorPayment | null>;

  /**
   * Gives the reference only when the call really comes from the aggregator, else null.
   * What the body claims about the status proves nothing: ask `getStatus` (v5.0.0-8.2.1).
   */
  verifyConfirmation(input: {
    headers: Record<string, string | undefined>;
    rawBody: Buffer;
  }): { providerReference: string } | null;

  /** Every payment of one UTC day (`YYYY-MM-DD`). */
  listStatement(day: string): Promise<AggregatorPayment[]>;
};
