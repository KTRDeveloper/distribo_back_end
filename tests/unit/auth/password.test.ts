import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, validatePasswordRules } from '../../../src/lib/password.js';

describe('validatePasswordRules', () => {
  it.each([
    ['1234567', ['TOO_SHORT']],
    ['abcdefgh', []],
    ['le riz aime la pluie', []],
    ['a'.repeat(64), []],
    ['a'.repeat(65), ['TOO_LONG']],
    ['Password', ['BLOCKED']],
    ['12345678', ['BLOCKED']],
    ['😀'.repeat(8), []],
  ])('%s', async (pw, expected) => {
    expect(await validatePasswordRules(pw)).toEqual(expected);
  });
  it('no composition rule', async () => {
    expect(await validatePasswordRules('zqxjkvbw')).toEqual([]);
  });
});

describe('hash', () => {
  it('hashes and verifies exactly as typed', async () => {
    const p = 'le riz aime la pluie';
    const a = await hashPassword(p);
    const b = await hashPassword(p);
    expect(a.startsWith('$argon2id$')).toBe(true);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, p)).toBe(true);
    expect(await verifyPassword(b, p)).toBe(true);
    expect(await verifyPassword(a, p + ' ')).toBe(false);
  });
  it('garbage hash returns false', async () => {
    expect(await verifyPassword('$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234', 'x')).toBe(false);
    expect(await verifyPassword('garbage', 'x')).toBe(false);
  });
});
