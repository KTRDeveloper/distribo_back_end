import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { splitVat } from '../../../src/modules/billing/receipt.service';

describe('AC-1: splitVat', () => {
  it.each([
    [5000n, 1925, 4193n, 807n],
    [15000n, 1925, 12579n, 2421n],
    [25000n, 1925, 20964n, 4036n],
    [5000n, 0, 5000n, 0n],
  ])('splits %s at %s bp into %s and %s', (total, rate, excl, vat) => {
    expect(splitVat(total, rate)).toEqual({ amountExclTax: excl, vatAmount: vat });
  });

  it('rounds half up and keeps the parts adding up to the total', () => {
    // 1 × 10000 / 10100 = 0.99 → 1; 3 × 10000 / 20000 = 1.5 → 2
    expect(splitVat(1n, 100)).toEqual({ amountExclTax: 1n, vatAmount: 0n });
    expect(splitVat(3n, 10000)).toEqual({ amountExclTax: 2n, vatAmount: 1n });
  });
});

describe('AC-5: VAT_RATE_BP setting', () => {
  const original = process.env.VAT_RATE_BP;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.VAT_RATE_BP;
    else process.env.VAT_RATE_BP = original;
    vi.resetModules();
  });

  const loadEnv = (value: string | undefined) => {
    if (value === undefined) delete process.env.VAT_RATE_BP;
    else process.env.VAT_RATE_BP = value;
    return import('../../../src/config/env');
  };

  it('passes with 1925 when unset', async () => {
    expect((await loadEnv(undefined)).env.VAT_RATE_BP).toBe(1925);
  });

  it('passes with 0', async () => {
    expect((await loadEnv('0')).env.VAT_RATE_BP).toBe(0);
  });

  it('fails and names the variable for 500', async () => {
    await expect(loadEnv('500')).rejects.toThrow(/VAT_RATE_BP/);
  });
});
