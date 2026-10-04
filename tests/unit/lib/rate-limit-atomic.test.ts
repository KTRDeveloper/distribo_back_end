import { describe, it, expect } from 'vitest';
import { checkAndConsume, type RateLimitClient } from '../../../src/lib/rate-limit.js';

/** Client with `eval`: records the call and answers like the Lua script would. */
function createScriptClient(reply: unknown) {
  const calls: unknown[][] = [];
  const client: RateLimitClient = {
    get: () => Promise.reject(new Error('get must not be used when eval exists')),
    set: () => Promise.reject(new Error('set must not be used when eval exists')),
    eval: (...args) => {
      calls.push(args);
      return Promise.resolve(reply);
    },
  };
  return { client, calls };
}

describe('rate-limit atomic path', () => {
  it('passes key, limit and window to one script call', async () => {
    const { client, calls } = createScriptClient([1, 2]);
    const r = await checkAndConsume('login:fail:x', 5, 300, client);
    expect(r).toEqual({ allowed: true, remaining: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(1)).toEqual([1, 'login:fail:x', 5, 300]);
  });

  it('refuses when the script says the limit is reached', async () => {
    const { client } = createScriptClient([0, 5]);
    expect(await checkAndConsume('k', 5, 60, client)).toEqual({ allowed: false, remaining: 0 });
  });

  it('fails closed on an unexpected reply', async () => {
    const { client } = createScriptClient('OK');
    await expect(checkAndConsume('k', 5, 60, client)).rejects.toThrow();
  });
});
