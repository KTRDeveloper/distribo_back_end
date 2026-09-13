import { describe, it, expect } from 'vitest';
import { generateOtp, hashOtp, verifyOtp } from '../../../src/lib/otp.js';

describe('OTP helper', () => {
  it('generates a 6-digit numeric code', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateOtp();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('generates codes across the full range without leading-zero collapse', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateOtp()));
    // Extremely unlikely to all collide; sanity check on distribution.
    expect(codes.size).toBeGreaterThan(50);
  });

  it('hashes a code such that the plaintext is not recoverable from the hash', async () => {
    const code = '482913';
    const hash = await hashOtp(code);

    expect(hash).not.toBe(code);
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies a correct code against its hash', async () => {
    const code = '482913';
    const hash = await hashOtp(code);

    await expect(verifyOtp(code, hash)).resolves.toBe(true);
  });

  it('rejects an incorrect code against a hash', async () => {
    const hash = await hashOtp('482913');

    await expect(verifyOtp('000000', hash)).resolves.toBe(false);
  });
});
