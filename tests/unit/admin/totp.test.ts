import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateSync } from 'otplib';
import {
  createTotpSecret,
  encryptSecret,
  decryptSecret,
  verifyTotp,
} from '../../../src/lib/totp.js';
import type { RateLimitClient } from '../../../src/lib/rate-limit.js';

const ADMIN_ID = '0192f0a0-0000-7000-8000-000000000001';
const OTHER_ADMIN_ID = '0192f0a0-0000-7000-8000-000000000002';
// A fixed instant in the middle of a 30-second step, so that +-1 step is unambiguous.
const NOW_MS = 1_800_000_015_000;

/** In-memory Redis stand-in: `eval` mimics the atomic consume script and records TTLs. */
function createFakeRedis() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  const client: RateLimitClient = {
    get: (key) => Promise.resolve(counts.has(key) ? String(counts.get(key)) : null),
    set: (key, value, _mode, ttl) => {
      counts.set(key, Number(value));
      ttls.set(key, ttl);
      return Promise.resolve('OK');
    },
    eval: (_script, _n, ...args) => {
      const [key, limit, window] = args as [string, number, number];
      const current = counts.get(key) ?? 0;
      if (current >= limit) return Promise.resolve([0, current]);
      counts.set(key, current + 1);
      ttls.set(key, window);
      return Promise.resolve([1, current + 1]);
    },
  };
  return { client, counts, ttls };
}

function codeAt(secret: string, offsetSeconds: number): string {
  return generateSync({ secret, epoch: NOW_MS / 1000 + offsetSeconds });
}

describe('totp', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a base32 secret and an otpauth URI with the issuer', () => {
    const { secret, otpauthUri } = createTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri.startsWith('otpauth://totp/')).toBe(true);
    expect(otpauthUri).toContain('Distribo');
    expect(otpauthUri).toContain(`secret=${secret}`);
  });

  it('accepts the current step and one step either side, refuses two steps away', async () => {
    const { secret } = createTotpSecret();
    const { client } = createFakeRedis();
    expect(await verifyTotp(ADMIN_ID, secret, codeAt(secret, 0), client)).toBe(true);
    expect(await verifyTotp(ADMIN_ID, secret, codeAt(secret, -30), client)).toBe(true);
    expect(await verifyTotp(ADMIN_ID, secret, codeAt(secret, 30), client)).toBe(true);
    expect(await verifyTotp(ADMIN_ID, secret, codeAt(secret, -60), client)).toBe(false);
    expect(await verifyTotp(ADMIN_ID, secret, codeAt(secret, 60), client)).toBe(false);
  });

  it('refuses an accepted code presented again', async () => {
    const { secret } = createTotpSecret();
    const { client } = createFakeRedis();
    const code = codeAt(secret, 0);
    expect(await verifyTotp(ADMIN_ID, secret, code, client)).toBe(true);
    expect(await verifyTotp(ADMIN_ID, secret, code, client)).toBe(false);
  });

  it('encrypts the secret and decrypts it back', () => {
    const { secret } = createTotpSecret();
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toBe(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it.each([
    ['12345', '12345'],
    ['1234567', '1234567'],
    ['abcdef', 'abcdef'],
    ['empty', ''],
  ])('returns false for a malformed code (%s)', async (_label, code) => {
    const { secret } = createTotpSecret();
    const { client, counts } = createFakeRedis();
    expect(await verifyTotp(ADMIN_ID, secret, code, client)).toBe(false);
    expect(counts.size).toBe(0);
  });

  it('refuses the replay of an observed valid code (AB-1)', async () => {
    const { secret } = createTotpSecret();
    const { client } = createFakeRedis();
    const observed = codeAt(secret, 0);
    expect(await verifyTotp(ADMIN_ID, secret, observed, client)).toBe(true);
    // The attacker replays it later, still inside its validity window.
    vi.setSystemTime(NOW_MS + 20_000);
    expect(await verifyTotp(ADMIN_ID, secret, observed, client)).toBe(false);
  });

  it('stores the used step per administrator for 90 seconds', async () => {
    const { secret } = createTotpSecret();
    const { client, counts, ttls } = createFakeRedis();
    const step = Math.floor(NOW_MS / 1000 / 30);
    await verifyTotp(ADMIN_ID, secret, codeAt(secret, 0), client);
    const key = `totp:used:${ADMIN_ID}:${step}`;
    expect(counts.get(key)).toBe(1);
    expect(ttls.get(key)).toBe(90);
  });

  it('does not let one administrator use up the code of another', async () => {
    const { secret } = createTotpSecret();
    const { client } = createFakeRedis();
    const code = codeAt(secret, 0);
    expect(await verifyTotp(ADMIN_ID, secret, code, client)).toBe(true);
    expect(await verifyTotp(OTHER_ADMIN_ID, secret, code, client)).toBe(true);
  });

  it('does not consume a step when the code is wrong', async () => {
    const { secret } = createTotpSecret();
    const { client, counts } = createFakeRedis();
    const good = codeAt(secret, 0);
    const wrong = good === '000000' ? '000001' : '000000';
    expect(await verifyTotp(ADMIN_ID, secret, wrong, client)).toBe(false);
    expect(counts.size).toBe(0);
    expect(await verifyTotp(ADMIN_ID, secret, good, client)).toBe(true);
  });

  it('accepts a code only once when presented in parallel', async () => {
    const { secret } = createTotpSecret();
    const { client } = createFakeRedis();
    const code = codeAt(secret, 0);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => verifyTotp(ADMIN_ID, secret, code, client))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
