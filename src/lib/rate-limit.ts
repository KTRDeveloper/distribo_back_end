import { redis } from './redis.js';

/**
 * Minimal Redis-backed fixed-window rate limiter. Only relies on GET/SET
 * (with TTL) so it works against any ioredis-compatible client, including
 * lightweight test doubles that don't implement INCR/pipelines.
 */
export interface RateLimitClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Check whether `key` is still within `limit` for the current window, and
 * consume one unit if so. Not perfectly atomic (read-then-write), which is
 * an acceptable tradeoff for OTP request/verify throttling at this scale.
 */
export async function checkAndConsume(
  key: string,
  limit: number,
  windowSeconds: number,
  client: RateLimitClient = redis
): Promise<RateLimitResult> {
  const current = await client.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  const next = count + 1;
  await client.set(key, String(next), 'EX', windowSeconds);

  return { allowed: true, remaining: limit - next };
}
