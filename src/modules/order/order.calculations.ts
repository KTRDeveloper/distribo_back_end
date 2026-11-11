import type { ReceptionMode } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';
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

/**
 * Decides the reception mode and the delivery address to store, for both a new order (`stored` is
 * null) and an edit (ORD-037, C-60). A PICKUP order has no address: sending one with it is a 400.
 * On an edit, nothing sent keeps the stored values; DELIVERY on an order not yet DELIVERY, with no
 * address sent, applies the relationship's usual address.
 *
 * @param sent - Mode and address from the body (`undefined` = absent; `null` clears the address).
 * @param stored - The order's current mode and address, or null at creation.
 * @param usualAddress - The relationship's usual delivery address.
 * @returns The mode and address to write.
 * @throws 400 `VALIDATION_ERROR` when the resulting mode is PICKUP and a non-null address is sent.
 */
export function resolveReception(
  sent: { mode?: ReceptionMode; address?: string | null },
  stored: { mode: ReceptionMode | null; address: string | null } | null,
  usualAddress: string | null
): { receptionMode: ReceptionMode | null; deliveryAddressApplied: string | null } {
  const receptionMode = sent.mode ?? stored?.mode ?? null;
  if (receptionMode === 'PICKUP') {
    if (sent.address !== undefined && sent.address !== null) {
      throw httpError(400, 'VALIDATION_ERROR', 'A pickup order has no delivery address.');
    }
    return { receptionMode, deliveryAddressApplied: null };
  }
  if (sent.address !== undefined) return { receptionMode, deliveryAddressApplied: sent.address };
  if (stored === null || (sent.mode === 'DELIVERY' && stored.mode !== 'DELIVERY')) {
    return { receptionMode, deliveryAddressApplied: usualAddress };
  }
  return { receptionMode, deliveryAddressApplied: stored.address };
}
