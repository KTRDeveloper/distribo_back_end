import { describe, it, expect } from 'vitest';
import { checkAndConsume, type RateLimitClient } from '../../../src/lib/rate-limit.js';

function createFakeClient(): RateLimitClient & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK';
    },
  };
}

describe('rate-limit', () => {
  it('allows requests under the limit', async () => {
    const client = createFakeClient();

    const first = await checkAndConsume('key', 3, 60, client);
    const second = await checkAndConsume('key', 3, 60, client);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });

  it('blocks requests once the limit is reached', async () => {
    const client = createFakeClient();

    await checkAndConsume('key', 2, 60, client);
    await checkAndConsume('key', 2, 60, client);
    const third = await checkAndConsume('key', 2, 60, client);

    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('tracks separate keys independently', async () => {
    const client = createFakeClient();

    await checkAndConsume('key-a', 1, 60, client);
    const resultB = await checkAndConsume('key-b', 1, 60, client);

    expect(resultB.allowed).toBe(true);
  });
});
