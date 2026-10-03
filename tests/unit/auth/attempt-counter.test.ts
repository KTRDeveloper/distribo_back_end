import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  checkAndConsume,
  getCount,
  resetKey,
  type RateLimitClient,
} from '../../../src/lib/rate-limit.js';

function createFakeClient(): RateLimitClient {
  const store = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(store.get(key) ?? null),
    set: (key, value) => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
    del: (key) => {
      store.delete(key);
      return Promise.resolve(1);
    },
  };
}

describe('attempt counter', () => {
  it('counting', async () => {
    const client = createFakeClient();
    for (let i = 0; i < 3; i++) await checkAndConsume('a', 10, 60, client);
    expect(await getCount('a', client)).toBe(3);
    expect(await getCount('b', client)).toBe(0);
  });

  it('reset', async () => {
    const client = createFakeClient();
    for (let i = 0; i < 3; i++) await checkAndConsume('a', 10, 60, client);
    await resetKey('a', client);
    expect(await getCount('a', client)).toBe(0);
  });
});

describe('environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load(value: string | undefined) {
    vi.resetModules();
    if (value === undefined) delete process.env.LOGIN_LOCK_MINUTES;
    else vi.stubEnv('LOGIN_LOCK_MINUTES', value);
    return import('../../../src/config/index.js');
  }

  it('defaults to 5', async () => {
    expect((await load(undefined)).config.auth.loginLockMinutes).toBe(5);
  });
  it('reads 10', async () => {
    expect((await load('10')).config.auth.loginLockMinutes).toBe(10);
  });
  it('rejects 0', async () => {
    await expect(load('0')).rejects.toThrow();
  });
  it('rejects abc', async () => {
    await expect(load('abc')).rejects.toThrow();
  });
});
