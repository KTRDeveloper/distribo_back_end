/**
 * Unit tests for phone number normalization
 */

import { describe, it, expect } from 'vitest';
import { normalizeE164, isCameroonMobile, phoneNumberSchema } from '../../../src/shared/phone.js';
import { uniquePhone } from '../../helpers/phone.js';
import { ZodError } from 'zod';

describe('Phone number utilities', () => {
  describe('normalizeE164', () => {
    describe('AC-1: Normalization', () => {
      it('should normalize unspaced Cameroon mobile: 677123456 → +237677123456', () => {
        expect(normalizeE164('677123456')).toBe('+237677123456');
      });

      it('should normalize spaced Cameroon mobile: 6 77 12 34 56 → +237677123456', () => {
        expect(normalizeE164('6 77 12 34 56')).toBe('+237677123456');
      });

      it('should normalize with country code and spaces: +237 677 12 34 56 → +237677123456', () => {
        expect(normalizeE164('+237 677 12 34 56')).toBe('+237677123456');
      });

      it('should normalize with 00 prefix: 00237677123456 → +237677123456', () => {
        expect(normalizeE164('00237677123456')).toBe('+237677123456');
      });

      it('should normalize with country code no prefix: 237677123456 → +237677123456', () => {
        expect(normalizeE164('237677123456')).toBe('+237677123456');
      });

      it('should return null for landline: +237222123456', () => {
        expect(normalizeE164('+237222123456')).toBeNull();
      });

      it('should return null for too short: 12345', () => {
        expect(normalizeE164('12345')).toBeNull();
      });

      it('should return null for non-numeric: abc', () => {
        expect(normalizeE164('abc')).toBeNull();
      });
    });

    describe('AC-4: E.164 shape', () => {
      const e164Pattern = /^\+[1-9][0-9]{7,14}$/;

      it('should match pattern for valid result', () => {
        const result = normalizeE164('677123456');
        expect(result).toMatch(e164Pattern);
      });

      it('should not match pattern for null', () => {
        const result = normalizeE164('invalid');
        expect(result).toBeNull();
      });

      it('should handle multiple valid Cameroon numbers', () => {
        const validNumbers = [
          '677123456',
          '6 77 12 34 56',
          '+237677123456',
          '00237677123456',
          '237677123456',
          '688654321',
          '695999888',
          '679111222',
        ];

        validNumbers.forEach((num) => {
          const result = normalizeE164(num);
          expect(result).toMatch(e164Pattern);
        });
      });
    });
  });

  describe('isCameroonMobile', () => {
    describe('AC-2: Only Cameroon mobiles', () => {
      it('should return true for valid Cameroon mobile', () => {
        expect(isCameroonMobile('+237677123456')).toBe(true);
      });

      it('should return true for other valid Cameroon mobiles', () => {
        expect(isCameroonMobile('+237688654321')).toBe(true);
        expect(isCameroonMobile('+237695999888')).toBe(true);
      });

      it('should return false for Senegal mobile', () => {
        expect(isCameroonMobile('+221701234567')).toBe(false);
      });

      it('should return false for US number', () => {
        expect(isCameroonMobile('+12025551234')).toBe(false);
      });

      it('should return false for malformed input', () => {
        expect(isCameroonMobile('not-a-number')).toBe(false);
      });

      it('should return false for Cameroon landline', () => {
        expect(isCameroonMobile('+237222123456')).toBe(false);
      });
    });
  });

  describe('phoneNumberSchema', () => {
    describe('AC-3: Schema validation', () => {
      it('should parse valid spaced number: 6 77 12 34 56 → +237677123456', () => {
        const result = phoneNumberSchema.parse('6 77 12 34 56');
        expect(result).toBe('+237677123456');
      });

      it('should parse valid unspaced number', () => {
        const result = phoneNumberSchema.parse('677123456');
        expect(result).toBe('+237677123456');
      });

      it('should parse with country code', () => {
        const result = phoneNumberSchema.parse('+237677123456');
        expect(result).toBe('+237677123456');
      });

      it('should parse with 00 prefix', () => {
        const result = phoneNumberSchema.parse('00237677123456');
        expect(result).toBe('+237677123456');
      });

      it('should reject invalid number and not echo input in error message', () => {
        expect(() => {
          phoneNumberSchema.parse('invalid-phone-number');
        }).toThrow(ZodError);

        try {
          phoneNumberSchema.parse('invalid-phone-number');
        } catch (error) {
          if (error instanceof ZodError) {
            const message = JSON.stringify(error.errors);
            expect(message).not.toContain('invalid-phone-number');
          }
        }
      });

      it('should reject landline and not echo input', () => {
        expect(() => {
          phoneNumberSchema.parse('+237222123456');
        }).toThrow(ZodError);

        try {
          phoneNumberSchema.parse('+237222123456');
        } catch (error) {
          if (error instanceof ZodError) {
            const message = JSON.stringify(error.errors);
            expect(message).not.toContain('+237222123456');
          }
        }
      });

      it('should reject too-short number and not echo input', () => {
        expect(() => {
          phoneNumberSchema.parse('12345');
        }).toThrow(ZodError);

        try {
          phoneNumberSchema.parse('12345');
        } catch (error) {
          if (error instanceof ZodError) {
            const message = JSON.stringify(error.errors);
            expect(message).not.toContain('12345');
          }
        }
      });

      it('should reject non-numeric and not echo input', () => {
        expect(() => {
          phoneNumberSchema.parse('abc');
        }).toThrow(ZodError);

        try {
          phoneNumberSchema.parse('abc');
        } catch (error) {
          if (error instanceof ZodError) {
            const message = JSON.stringify(error.errors);
            expect(message).not.toContain('abc');
          }
        }
      });
    });
  });

  describe('test helper: uniquePhone()', () => {
    describe('AC-1: Valid and distinct', () => {
      it('should generate 50 valid distinct Cameroon mobile numbers', () => {
        const phones = new Set<string>();

        for (let i = 0; i < 50; i++) {
          const phone = uniquePhone();
          phones.add(phone);

          // Each should be valid E.164
          expect(phone).toMatch(/^\+[1-9][0-9]{7,14}$/);

          // Each should be a Cameroon mobile
          expect(isCameroonMobile(phone)).toBe(true);

          // Should normalize to itself
          expect(normalizeE164(phone)).toBe(phone);
        }

        // All should be distinct
        expect(phones.size).toBe(50);
      });
    });
  });
});
