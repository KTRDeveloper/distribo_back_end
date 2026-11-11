import type { ReceiptFields } from '../../src/modules/order/order.state.js';

/** The four receipt fields a DELIVERED order carries (A8 point 9), for fixtures that write DELIVERED. */
export const RECEIPT_FIELDS: ReceiptFields = {
  supplierNameApplied: 'Test supplier',
  customerNameApplied: null,
  collectedApplied: 0n,
  balanceAfterApplied: 0n,
};
