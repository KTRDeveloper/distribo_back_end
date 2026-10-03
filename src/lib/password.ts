import argon2 from 'argon2';
import { isBlockedPassword } from './password-blocklist.js';

export type PasswordRuleCode = 'TOO_SHORT' | 'TOO_LONG' | 'BLOCKED';

const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/** Hash with Argon2id (OWASP params, v5.0.0-11.4.2); input is used exactly as typed. */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/** Verify exactly as typed (no trim or case change); any invalid or non-Argon2id hash yields false. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  if (!hash.startsWith('$argon2id$')) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Design rules: 8-64 code points, no composition rule, blocklist (v5.0.0-6.2.1, 6.2.4, 6.2.5, 6.2.9). */
export async function validatePasswordRules(plain: string): Promise<PasswordRuleCode[]> {
  const length = [...plain].length;
  const codes: PasswordRuleCode[] = [];
  if (length < 8) codes.push('TOO_SHORT');
  if (length > 64) codes.push('TOO_LONG');
  if (await isBlockedPassword(plain)) codes.push('BLOCKED');
  return codes;
}
