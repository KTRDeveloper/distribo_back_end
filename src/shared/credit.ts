/**
 * Credit-limit arithmetic for a delivery (DLV-017, CM-15). Pure bigint functions in francs.
 */

/** Credit still open: `limit - balance`, never below 0; `null` when the customer has no limit. */
export function availableCredit(limit: bigint | null, balance: bigint): bigint | null {
  if (limit === null) return null;
  const open = limit - balance;
  return open > 0n ? open : 0n;
}

/**
 * The smallest collection a delivery needs and how far it goes over the limit.
 *
 * A balance already above the limit counts as no credit left (available 0), so an old overrun
 * never has to be paid by a new sale: only the new total must be covered. Both results are
 * never below 0, and 0 with no limit.
 *
 * @param input.balance - Relationship balance locked before the gesture.
 * @param input.total - Server total of the delivered quantities.
 * @param input.collected - Payments of the same gesture.
 */
export function creditCheck(input: {
  limit: bigint | null;
  balance: bigint;
  total: bigint;
  collected: bigint;
}): { minCollect: bigint; exceededBy: bigint } {
  const available = availableCredit(input.limit, input.balance);
  if (available === null) return { minCollect: 0n, exceededBy: 0n };
  const minCollect = input.total - available;
  const exceededBy = input.total - input.collected - available;
  return {
    minCollect: minCollect > 0n ? minCollect : 0n,
    exceededBy: exceededBy > 0n ? exceededBy : 0n,
  };
}
