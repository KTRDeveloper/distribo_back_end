import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

const P = '0190a1b2-0000-7000-8000-000000000001';
const Q = '0190a1b2-0000-7000-8000-000000000002';
const ANDROID_ID = 'a1b2c3d4e5f60718';
const KEY_A = 'a'.repeat(32);

async function load(key: string | undefined) {
  vi.resetModules();
  if (key === undefined) delete process.env.ANDROID_ID_HASH_KEY;
  else vi.stubEnv('ANDROID_ID_HASH_KEY', key);
  return import('../../../src/lib/android-id.js');
}

describe('hashAndroidId', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('same input gives the same 64 lowercase hex characters', async () => {
    const { hashAndroidId } = await load(KEY_A);
    const first = hashAndroidId(P, ANDROID_ID);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAndroidId(P, ANDROID_ID)).toBe(first);
  });

  it('two persons get different fingerprints for the same phone', async () => {
    const { hashAndroidId } = await load(KEY_A);
    expect(hashAndroidId(P, ANDROID_ID)).not.toBe(hashAndroidId(Q, ANDROID_ID));
  });

  it('another key gives another fingerprint', async () => {
    const before = (await load(KEY_A)).hashAndroidId(P, ANDROID_ID);
    const after = (await load('b'.repeat(32))).hashAndroidId(P, ANDROID_ID);
    expect(after).not.toBe(before);
  });

  it.each([
    ['absent', undefined, false],
    ['31 characters', 'k'.repeat(31), false],
    ['32 characters', 'k'.repeat(32), true],
  ])('key required: %s', async (_name, value, loads) => {
    if (loads) await expect(load(value)).resolves.toBeDefined();
    else await expect(load(value)).rejects.toThrow();
  });

  it('a plain SHA-256 does not match the fingerprint', async () => {
    const { hashAndroidId } = await load(KEY_A);
    const plain = createHash('sha256').update(`${P}:${ANDROID_ID}`).digest('hex');
    expect(hashAndroidId(P, ANDROID_ID)).not.toBe(plain);
  });
});
