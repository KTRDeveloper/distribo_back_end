/**
 * Tests for the plan limits and the subscription price grid.
 */

import { describe, expect, it } from 'vitest';
import {
  PACK_MONTHS,
  PLANS,
  priceFor,
  type PackMonths,
  type PaidPlanCode,
} from '../../../src/shared/plans.js';

describe('plan limits', () => {
  it.each([
    ['FREE', 2, 30, 0n],
    ['ESSENTIAL', 5, null, 5000n],
    ['PRO', 10, null, 10000n],
    ['ENTERPRISE', null, null, 25000n],
  ] as const)('%s carries its limits and monthly price', (plan, collaborators, products, price) => {
    expect(PLANS[plan].maxCollaborators).toBe(collaborators);
    expect(PLANS[plan].maxProducts).toBe(products);
    expect(PLANS[plan].monthlyPrice).toBe(price);
  });

  it('lists the four pack lengths', () => {
    expect(PACK_MONTHS).toEqual([1, 3, 6, 12]);
  });
});

describe('price grid', () => {
  it.each([
    ['ESSENTIAL', 1, 5000n],
    ['ESSENTIAL', 3, 15000n],
    ['ESSENTIAL', 6, 25000n],
    ['ESSENTIAL', 12, 50000n],
    ['PRO', 1, 10000n],
    ['PRO', 3, 30000n],
    ['PRO', 6, 50000n],
    ['PRO', 12, 100000n],
    ['ENTERPRISE', 1, 25000n],
    ['ENTERPRISE', 3, 75000n],
    ['ENTERPRISE', 6, 125000n],
    ['ENTERPRISE', 12, 250000n],
  ] as const)('%s for %i month(s) costs %s', (plan, months, price) => {
    expect(priceFor(plan, months)).toBe(price);
  });
});

describe('no price outside the grid', () => {
  it.each([
    ['FREE', 1],
    ['PRO', 2],
    ['PRO', 0],
    ['GOLD', 1],
    ['PRO', -1],
    ['PRO', 1.5],
    ['PRO', Number.NaN],
    ['constructor', 1],
    ['__proto__', 1],
    ['PRO', '3'],
  ] as const)('priceFor(%s, %s) throws a RangeError', (plan, months) => {
    expect(() => priceFor(plan as PaidPlanCode, months as unknown as PackMonths)).toThrow(
      RangeError
    );
  });
});
