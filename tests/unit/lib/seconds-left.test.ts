import { describe, expect, it, vi } from 'vitest';
import { secondsLeft, type RateLimitClient } from '../../../src/lib/rate-limit.js';

function clientWith(pttl: number): RateLimitClient {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    pttl: vi.fn().mockResolvedValue(pttl),
  };
}

describe('secondsLeft', () => {
  it.each([
    [60000, 60],
    [1200, 2],
    [1, 1],
    [-2, 1],
  ])('remaining %i ms -> %i seconds', async (pttl, seconds) => {
    expect(await secondsLeft('k', 900, clientWith(pttl))).toBe(seconds);
  });

  it('gives the window when the client cannot read the remaining time', async () => {
    const client: RateLimitClient = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
    };
    expect(await secondsLeft('k', 900, client)).toBe(900);
  });

  it('never writes to the key', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      eval: vi.fn().mockResolvedValue([]),
      pttl: vi.fn().mockResolvedValue(5000),
    };
    await secondsLeft('k', 900, client);
    expect(client.set).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
    expect(client.eval).not.toHaveBeenCalled();
  });
});
