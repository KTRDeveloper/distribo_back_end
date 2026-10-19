/** Plan codes, limits and the subscription price grid (C-41); the only place they are written. */

export type PlanCode = 'FREE' | 'ESSENTIAL' | 'PRO' | 'ENTERPRISE';
export type PaidPlanCode = Exclude<PlanCode, 'FREE'>;
export type PackMonths = 1 | 3 | 6 | 12;

/** Limits and monthly price per plan; `null` means no limit. Money is integer XAF. */
export const PLANS: Record<
  PlanCode,
  { maxCollaborators: number | null; maxProducts: number | null; monthlyPrice: bigint }
> = {
  FREE: { maxCollaborators: 2, maxProducts: 30, monthlyPrice: 0n },
  ESSENTIAL: { maxCollaborators: 5, maxProducts: null, monthlyPrice: 5000n },
  PRO: { maxCollaborators: 10, maxProducts: null, monthlyPrice: 10000n },
  ENTERPRISE: { maxCollaborators: null, maxProducts: null, monthlyPrice: 25000n },
};

/** Pack lengths, in months, that can be bought. */
export const PACK_MONTHS: readonly PackMonths[] = [1, 3, 6, 12];

const PRICE_GRID: ReadonlyMap<PaidPlanCode, ReadonlyMap<PackMonths, bigint>> = new Map([
  [
    'ESSENTIAL',
    new Map<PackMonths, bigint>([
      [1, 5000n],
      [3, 15000n],
      [6, 25000n],
      [12, 50000n],
    ]),
  ],
  [
    'PRO',
    new Map<PackMonths, bigint>([
      [1, 10000n],
      [3, 30000n],
      [6, 50000n],
      [12, 100000n],
    ]),
  ],
  [
    'ENTERPRISE',
    new Map<PackMonths, bigint>([
      [1, 25000n],
      [3, 75000n],
      [6, 125000n],
      [12, 250000n],
    ]),
  ],
]);

/**
 * Price in XAF of a pack, read from the grid. The server alone chooses the price.
 *
 * @throws RangeError for any plan or month count the grid does not list (ASVS 2.2.1:
 * allowlist; no amount is ever derived or guessed for an unlisted pair).
 */
export function priceFor(plan: PaidPlanCode, months: PackMonths): bigint {
  // Map lookups never reach inherited keys such as "constructor" or "__proto__".
  const price = PRICE_GRID.get(plan)?.get(months);
  if (price === undefined) {
    throw new RangeError('No price for this plan and pack length');
  }
  return price;
}
