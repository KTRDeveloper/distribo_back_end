/**
 * Unit tests for money and quantity arithmetic
 */

import { describe, it, expect } from 'vitest';
import { parseQuantity, lineAmount } from '../../../src/shared/money.js';

describe('Money and quantity arithmetic', () => {
  describe('lineAmount', () => {
    describe('AC-1: Rounding to nearest franc, half up', () => {
      it('should calculate 2.5 × 333 = 833', () => {
        const result = lineAmount(BigInt(2500), BigInt(333));
        expect(result).toBe(BigInt(833));
      });

      it('should calculate 0.001 × 500 = 1', () => {
        const result = lineAmount(BigInt(1), BigInt(500));
        expect(result).toBe(BigInt(1));
      });

      it('should calculate 0.001 × 499 = 0', () => {
        const result = lineAmount(BigInt(1), BigInt(499));
        expect(result).toBe(BigInt(0));
      });

      it('should calculate 10 × 3000 = 30000', () => {
        const result = lineAmount(BigInt(10000), BigInt(3000));
        expect(result).toBe(BigInt(30000));
      });

      it('should calculate 0 × 3000 = 0', () => {
        const result = lineAmount(BigInt(0), BigInt(3000));
        expect(result).toBe(BigInt(0));
      });
    });

    describe('AC-3: Negative inputs', () => {
      it('should throw RangeError for negative quantity', () => {
        expect(() => lineAmount(BigInt(-1), BigInt(333))).toThrow(RangeError);
      });

      it('should throw RangeError for negative price', () => {
        expect(() => lineAmount(BigInt(2500), BigInt(-1))).toThrow(RangeError);
      });
    });
  });

  describe('parseQuantity', () => {
    describe('AC-2: Quantity parsing', () => {
      it('should parse 2.5 to 2500', () => {
        const result = parseQuantity('2.5');
        expect(result).toBe(BigInt(2500));
      });

      it('should parse 0.001 to 1', () => {
        const result = parseQuantity('0.001');
        expect(result).toBe(BigInt(1));
      });

      it('should throw RangeError for 0.0001 (more than 3 decimals)', () => {
        expect(() => parseQuantity('0.0001')).toThrow(RangeError);
      });

      it('should throw RangeError for -1', () => {
        expect(() => parseQuantity('-1')).toThrow(RangeError);
      });

      it('should throw RangeError for 1e3 (scientific notation)', () => {
        expect(() => parseQuantity('1e3')).toThrow(RangeError);
      });
    });
  });
});
