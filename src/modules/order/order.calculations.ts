import { lineAmount } from '../../shared/money.js';

/**
 * Amount of one order line (CM-14): the delivered quantity when set, else the ordered one,
 * times the applied price, half a franc rounded up. Every write of `amount` must use this.
 *
 * @param line - quantities in thousandths and the applied unit price in francs
 * @returns the line amount in francs
 */
export function lineAmountOf(line: {
  quantityMilli: bigint;
  deliveredQuantityMilli?: bigint | null;
  unitPriceApplied: bigint;
}): bigint {
  return lineAmount(line.deliveredQuantityMilli ?? line.quantityMilli, line.unitPriceApplied);
}

/** Order total (C-19): the sum of the line amounts plus the delivery cost. */
export function orderTotal(amounts: bigint[], deliveryCost: bigint): bigint {
  return amounts.reduce((sum, amount) => sum + amount, deliveryCost);
}
