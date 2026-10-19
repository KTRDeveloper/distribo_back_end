/**
 * Tests for business payment code generation.
 */

import { describe, expect, it } from 'vitest';
import { generatePaymentCode } from '../../../src/lib/payment-code.js';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

describe('payment code', () => {
  it('has the fixed shape and is unique over 1000 draws', () => {
    const codes = Array.from({ length: 1000 }, () => generatePaymentCode());

    for (const code of codes) {
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
      expect(code).not.toMatch(/[0O1I]/);
    }
    expect(new Set(codes).size).toBe(1000);
  });

  it('draws every symbol of the alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      for (const symbol of generatePaymentCode()) seen.add(symbol);
    }

    expect(ALPHABET).toHaveLength(32);
    expect([...ALPHABET].filter((symbol) => !seen.has(symbol))).toEqual([]);
  });
});
