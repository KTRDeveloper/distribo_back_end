import { findCacheMismatches } from './finance.repository.js';

/** A cached total that differs from the sum of its entries; `id` is the relationship or collaboration id. */
export type Mismatch = { id: string; expected: string; actual: string };

/**
 * Compares every cached `balance` and `amount_held` with the sum of its entries (C-37, CM-17) and
 * returns the differences. It only reads, inside one repeatable-read snapshot (ASVS v5.0.0-2.3.3),
 * so it can run while the application writes. Amounts are decimal strings of integer XAF.
 *
 * @returns Relationships whose balance is wrong and collaborations whose held money is wrong.
 */
export async function reconcile(): Promise<{
  balanceMismatches: Mismatch[];
  heldMismatches: Mismatch[];
}> {
  const { balances, held } = await findCacheMismatches();
  return { balanceMismatches: balances, heldMismatches: held };
}
