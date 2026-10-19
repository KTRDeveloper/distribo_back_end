import { FakeAggregator } from './aggregator.fake.js';
import type { PaymentAggregator } from './aggregator.port.js';

const instance = new FakeAggregator();

/** Returns the one payment aggregator; `PAYMENT_DRIVER` accepts only `fake` until ADR-006 is accepted. */
export function getPaymentAggregator(): PaymentAggregator {
  return instance;
}
