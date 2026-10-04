import { generateSecret, generateURI, verifySync } from 'otplib';
import { decrypt, encrypt } from './crypto.js';
import { checkAndConsume, type RateLimitClient } from './rate-limit.js';

const ISSUER = 'Distribo';
const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** One step either side of the current one, to absorb clock drift. */
const TOLERANCE_SECONDS = PERIOD_SECONDS;
/** Long enough to outlive the last window in which a used step is still acceptable (3 steps). */
const USED_STEP_TTL_SECONDS = 90;
const CODE_FORMAT = /^\d{6}$/;

/**
 * Creates a new TOTP secret (160-bit, base32) and the `otpauth://` URI an authenticator app
 * scans. The label is a fixed placeholder: the URI carries no personal data.
 *
 * @returns The plaintext secret (encrypt it with `encryptSecret` before storing) and its URI.
 */
export function createTotpSecret(): { secret: string; otpauthUri: string } {
  const secret = generateSecret();
  const otpauthUri = generateURI({
    issuer: ISSUER,
    label: 'administrator',
    secret,
    digits: DIGITS,
    period: PERIOD_SECONDS,
  });
  return { secret, otpauthUri };
}

/** Encrypts a TOTP secret with AES-256-GCM for storage (v5.0.0-11.3.2). */
export function encryptSecret(secret: string): string {
  return encrypt(secret);
}

/** Decrypts a stored TOTP secret; throws if the data was tampered with or the key differs. */
export function decryptSecret(encrypted: string): string {
  return decrypt(encrypted);
}

/**
 * Verifies a TOTP code for an administrator, accepting the current 30-second step and one
 * step either side, and refusing a step this administrator has already used (v5.0.0-6.5.1,
 * CWE-294). The step is claimed with an atomic Redis consume only after the code matched, so
 * a wrong guess burns nothing and parallel presentations of one code yield a single success.
 * Fails closed: a Redis error rejects instead of accepting the code.
 *
 * @param administratorId - Owner of the secret; scopes the used-step key.
 * @param secret - Plaintext base32 secret (decrypt it first).
 * @param code - Code typed by the user; anything but exactly 6 digits returns false.
 * @param client - Redis client, injectable for tests.
 */
export async function verifyTotp(
  administratorId: string,
  secret: string,
  code: string,
  client?: RateLimitClient
): Promise<boolean> {
  if (!CODE_FORMAT.test(code)) return false;

  const result = verifySync({
    secret,
    token: code,
    digits: DIGITS,
    period: PERIOD_SECONDS,
    epochTolerance: TOLERANCE_SECONDS,
  });
  if (!result.valid || !('timeStep' in result) || typeof result.timeStep !== 'number') {
    return false;
  }

  const claim = await checkAndConsume(
    `totp:used:${administratorId}:${result.timeStep}`,
    1,
    USED_STEP_TTL_SECONDS,
    client
  );
  return claim.allowed;
}
