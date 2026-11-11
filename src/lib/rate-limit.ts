import { redis } from './redis.js';

/**
 * Minimal Redis-backed rate limiter. A client with `eval` (ioredis) consumes in
 * one atomic Lua script; a client with only GET/SET (lightweight test doubles
 * that don't implement scripts) falls back to a read-then-write that is not atomic.
 */
export interface RateLimitClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del?(key: string): Promise<unknown>;
  /** Remaining time to live in milliseconds (Redis PTTL); -1 no expiry, -2 no key. */
  pttl?(key: string): Promise<number>;
  eval?(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Refuse without touching the key once `limit` is reached; otherwise count one
 * and restart the window. Returns `{allowed, count}`.
 */
const CONSUME_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then return {0, current} end
local count = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return {1, count}
`;

/**
 * Check whether `key` is still within `limit` for the current window, and
 * consume one unit if so. Atomic when the client supports `eval`, so parallel
 * callers cannot all pass the same stale count.
 */
export async function checkAndConsume(
  key: string,
  limit: number,
  windowSeconds: number,
  client: RateLimitClient = redis
): Promise<RateLimitResult> {
  if (client.eval) {
    const reply = await client.eval(CONSUME_SCRIPT, 1, key, limit, windowSeconds);
    if (!Array.isArray(reply) || reply.length !== 2) {
      throw new Error('Unexpected rate-limit script reply');
    }
    const [allowed, count] = reply as [number, number];
    return allowed === 1
      ? { allowed: true, remaining: limit - count }
      : { allowed: false, remaining: 0 };
  }
  const current = await client.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  const next = count + 1;
  await client.set(key, String(next), 'EX', windowSeconds);

  return { allowed: true, remaining: limit - next };
}

/** Current count for `key`; a missing key counts 0. */
export async function getCount(key: string, client: RateLimitClient = redis): Promise<number> {
  const current = await client.get(key);
  return current ? parseInt(current, 10) : 0;
}

/**
 * Remaining time of the counter `key`, in whole seconds rounded up, at least 1. Read only: it never
 * extends a lock (ASVS 6.3.1). A client without `pttl` gives `windowSeconds`.
 */
export async function secondsLeft(
  key: string,
  windowSeconds: number,
  client: RateLimitClient = redis
): Promise<number> {
  if (!client.pttl) return windowSeconds;
  const ms = await client.pttl(key);
  return Math.max(1, Math.ceil(ms / 1000));
}

/** Clear the counter for `key` (e.g. after a successful login). */
export async function resetKey(key: string, client: RateLimitClient = redis): Promise<void> {
  if (client.del) {
    await client.del(key);
    return;
  }
  await client.set(key, '0', 'EX', 1);
}
