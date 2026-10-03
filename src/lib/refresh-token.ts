import { randomBytes, createHash } from 'crypto';

/**
 * Refresh token generation and hashing helpers.
 *
 * Unlike OTP codes and passwords (low-entropy secrets hashed with Argon2id,
 * see src/lib/otp.ts), a refresh token is a 256-bit random value with no
 * meaningful brute-force risk — a fast cryptographic hash is the correct,
 * standard choice for storage (see specs/005-refresh-tokens/research.md §2).
 */

const REFRESH_TOKEN_BYTES = 32;

/**
 * Generate a new opaque refresh token secret.
 */
export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/**
 * Hash a refresh token for storage/lookup.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
