/**
 * Unit tests for the image settings (IMG-002, AC-4)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const NAMES = ['IMAGE_DRIVER', 'IMAGE_MAX_BYTES', 'IMAGE_MAX_PIXELS'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of NAMES) saved[name] = process.env[name];
  vi.resetModules();
});

afterEach(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  vi.resetModules();
});

const loadEnv = (settings: Record<string, string>) => {
  for (const name of NAMES) delete process.env[name];
  Object.assign(process.env, settings);
  return import('../../../src/config/env');
};

describe('AC-4: image settings', () => {
  it('passes with the defaults when nothing is set', async () => {
    const { env } = await loadEnv({});
    expect(env.IMAGE_DRIVER).toBe('fake');
    expect(env.IMAGE_MAX_BYTES).toBe(3145728);
    expect(env.IMAGE_MAX_PIXELS).toBe(12000000);
  });

  it('fails and names IMAGE_DRIVER for s3', async () => {
    await expect(loadEnv({ IMAGE_DRIVER: 's3' })).rejects.toThrow(/IMAGE_DRIVER/);
  });

  it('fails and names IMAGE_MAX_BYTES for 0', async () => {
    await expect(loadEnv({ IMAGE_MAX_BYTES: '0' })).rejects.toThrow(/IMAGE_MAX_BYTES/);
  });

  it('fails and names IMAGE_MAX_PIXELS for 0', async () => {
    await expect(loadEnv({ IMAGE_MAX_PIXELS: '0' })).rejects.toThrow(/IMAGE_MAX_PIXELS/);
  });
});
