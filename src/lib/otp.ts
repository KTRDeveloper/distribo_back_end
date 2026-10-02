import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';

/**
 * OTP generation and hashing helpers, shared by sign-in, password-reset,
 * and email-verification flows.
 *
 * Codes are 6-digit numeric, hashed with bcrypt before persistence (mirrors
 * the existing Account.passwordHash pattern) so a database read never
 * exposes a usable code.
 */

const OTP_BCRYPT_ROUNDS = 10;
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
  return bcrypt.hash(code, OTP_BCRYPT_ROUNDS);
}

/**
 * Compare a submitted code against its stored hash.
 */
export async function verifyOtp(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
