import { describe, expect, it } from 'vitest';
import { availableCredit, creditCheck } from '../../../src/shared/credit.js';

describe('availableCredit (DLV-017)', () => {
  it.each([
    [100000n, 40000n, 60000n],
    [100000n, 100000n, 0n],
    [100000n, 120000n, 0n],
    [0n, -20000n, 20000n],
    [null, 120000n, null],
  ])('limit %s, balance %s gives %s', (limit, balance, expected) => {
    expect(availableCredit(limit, balance)).toBe(expected);
  });
});

describe('creditCheck (AC-1, CM-15)', () => {
  it.each([
    [120000n, 100000n, 10000n, 10000n, 10000n, 0n],
    [120000n, 100000n, 10000n, 9999n, 10000n, 1n],
    [100000n, 100000n, 10000n, 10000n, 10000n, 0n],
    [90000n, 100000n, 30000n, 20000n, 20000n, 0n],
    [5000n, 0n, 10000n, 10000n, 10000n, 0n],
    [-20000n, 0n, 30000n, 10000n, 10000n, 0n],
    [120000n, null, 10000n, 0n, 0n, 0n],
    [40000n, 50000n, 30000n, 19999n, 20000n, 1n],
  ])(
    'balance %s, limit %s, total %s, collected %s gives min %s and overrun %s',
    (balance, limit, total, collected, minCollect, exceededBy) => {
      expect(creditCheck({ limit, balance, total, collected })).toEqual({
        minCollect,
        exceededBy,
      });
    }
  );
});
