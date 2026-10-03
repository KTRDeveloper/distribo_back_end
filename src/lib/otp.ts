import argon2 from 'argon2';
import { randomInt } from 'crypto';

/**
 * OTP generation and hashing helpers, shared by sign-in, password-reset,
 * and email-verification flows.
 *
 * Codes are 6-digit numeric, hashed with Argon2id (v5.0.0-11.4.2) before
 * persistence so a database read never exposes a usable code.
 */

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
const OTP_MIN = 100000;
const OTP_MAX = 999999;

/**
 * Generate a 6-digit numeric one-time code.
 */
export function generateOtp(): string {
  return randomInt(OTP_MIN, OTP_MAX + 1).toString();
}

/**
 * Hash a one-time code for storage.
 */
export async function hashOtp(code: string): Promise<string> {
  return argon2.hash(code, ARGON2_OPTIONS);
}

/**
 * Compare a submitted code against its stored hash.
 */
export async function verifyOtp(code: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, code);
  } catch {
    // A malformed stored hash can never match.
    return false;
  }
}
