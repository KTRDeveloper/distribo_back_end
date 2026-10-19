import { randomInt } from 'node:crypto';

/** 32 symbols without the look-alikes 0, O, 1 and I. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

/**
 * Draw a business payment code: 8 random symbols, unrelated to the business name.
 * Uses `crypto.randomInt` (uniform, no modulo bias), never `Math.random` (ASVS 11.5.1).
 * It is an identifier, not a secret; uniqueness is enforced by the database (C-41).
 */
export function generatePaymentCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}
