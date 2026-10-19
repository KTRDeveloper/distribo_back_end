import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildImageUrl, imageKeySchema, imageUrl, newImageKey } from '../../../src/lib/image-keys';
import { uuidV7Schema } from '../../../src/shared/ids';

const UUID = '3f8a2c4e-9b1d-4e6f-8a7b-1c2d3e4f5a6b';
const V4_KEY = /^(logos|avatars|products)\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;

describe('newImageKey', () => {
  it.each(['logos', 'avatars', 'products'] as const)('AC-1 builds a %s key', (folder) => {
    const key = newImageKey(folder);
    expect(key).toMatch(V4_KEY);
    expect(key.startsWith(`${folder}/`)).toBe(true);
    expect(imageKeySchema.safeParse(key).success).toBe(true);
  });

  it('AC-2 keys are distinct and never a UUIDv7', () => {
    const keys = Array.from({ length: 1000 }, () => newImageKey('products'));
    expect(new Set(keys).size).toBe(1000);
    for (const key of keys) {
      const id = key.slice('products/'.length, -'.webp'.length);
      expect(id).toHaveLength(36);
      expect(uuidV7Schema.safeParse(id).success).toBe(false);
    }
  });
});

describe('imageKeySchema', () => {
  it.each([
    [`products/${UUID}.webp`, true],
    [`logos/${UUID}.webp`, true],
    ['avatars/3f8a2c4e-9b1d-7e6f-8a7b-1c2d3e4f5a6b.webp', false],
    [`products/${UUID.toUpperCase()}.webp`, false],
    [`products/${UUID}.png`, false],
    [`other/${UUID}.webp`, false],
  ])('AC-3 %s -> accepted: %s', (key, accepted) => {
    expect(imageKeySchema.safeParse(key).success).toBe(accepted);
  });

  it('rejects a trailing newline, which "$" alone would let through', () => {
    expect(imageKeySchema.safeParse(`products/${UUID}.webp\n`).success).toBe(false);
  });
});

describe('address building', () => {
  it('AC-4 buildImageUrl joins base address and key', () => {
    expect(buildImageUrl('https://cdn.example.com/img', `products/${UUID}.webp`)).toBe(
      `https://cdn.example.com/img/products/${UUID}.webp`
    );
  });

  it('AC-4 imageUrl uses the test base address; null gives null', () => {
    expect(imageUrl(`products/${UUID}.webp`)).toBe(
      `http://localhost:3000/images/products/${UUID}.webp`
    );
    expect(imageUrl(null)).toBeNull();
  });
});

describe('crafted key (AB-1, CWE-22)', () => {
  it.each(['../secret', 'products/../../secret', '//other-host/x.webp'])(
    'imageUrl(%s) throws a RangeError',
    (key) => {
      expect(() => imageUrl(key)).toThrow(RangeError);
      expect(() => buildImageUrl('http://localhost:3000/images', key)).toThrow(RangeError);
    }
  );
});

describe('IMAGE_PUBLIC_BASE_URL validation (AC-5)', () => {
  const original = process.env.IMAGE_PUBLIC_BASE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.IMAGE_PUBLIC_BASE_URL;
    else process.env.IMAGE_PUBLIC_BASE_URL = original;
    vi.doUnmock('dotenv');
    vi.resetModules();
  });

  async function loadEnv(value: string | undefined) {
    vi.resetModules();
    // Keep a developer's .env file from filling the variable back in.
    vi.doMock('dotenv', () => ({ default: { config: () => ({}) } }));
    if (value === undefined) delete process.env.IMAGE_PUBLIC_BASE_URL;
    else process.env.IMAGE_PUBLIC_BASE_URL = value;
    return import('../../../src/config/env');
  }

  it.each([
    ['missing', undefined],
    ['no scheme', 'localhost:3000/images'],
    ['trailing slash', 'http://localhost:3000/images/'],
    ['query', 'http://localhost:3000/images?size=1'],
    ['fragment', 'http://localhost:3000/images#top'],
    ['javascript scheme', 'javascript:alert(1)'],
  ])('rejects %s', async (_label, value) => {
    await expect(loadEnv(value)).rejects.toThrow(/IMAGE_PUBLIC_BASE_URL/);
  });

  it('accepts a valid base address', async () => {
    const { env } = await loadEnv('https://cdn.example.com/images');
    expect(env.IMAGE_PUBLIC_BASE_URL).toBe('https://cdn.example.com/images');
  });
});
