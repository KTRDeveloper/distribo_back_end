import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';
import { logger } from '../../../src/lib/logger';
import { newImageKey } from '../../../src/lib/image-keys';
import { getImageStorage } from '../../../src/modules/images/image.ports';
import { releaseDeletedImageKeys } from '../../../src/modules/catalog/catalog.repository';
import { cleanupOrphanImages } from '../../../src/modules/images/image-cleanup.service';
import { runImageCleanupJob } from '../../../src/jobs/image-cleanup';

// The real release query, wrapped so that a test can make it fail
vi.mock('../../../src/modules/catalog/catalog.repository', async (importActual) => {
  const actual =
    await importActual<typeof import('../../../src/modules/catalog/catalog.repository')>();
  return { ...actual, releaseDeletedImageKeys: vi.fn(actual.releaseDeletedImageKeys) };
});

const ORG_ID = '0199c012-0000-7000-8000-000000000001';
const P_DELETED = '0199c012-0000-7000-8000-000000000011';
const P_RECENT = '0199c012-0000-7000-8000-000000000012';
const P_LIVE = '0199c012-0000-7000-8000-000000000013';
const V_DELETED = '0199c012-0000-7000-8000-000000000021';
const V_LIVE = '0199c012-0000-7000-8000-000000000022';
const NOW = new Date('2026-06-15T12:00:00.000Z');
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

const storage = getImageStorage();
const exists = async (key: string) => (await storage.get(key)) !== null;

/** Stores a file whose storage time is `hoursAgo` hours before NOW and returns its key. */
async function storeAged(hoursAgo: number): Promise<string> {
  const key = newImageKey('products');
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(ago(hoursAgo));
    await storage.put(key, Buffer.from('file'));
  } finally {
    vi.useRealTimers();
  }
  return key;
}

async function insertProduct(id: string, keys: string[], deletedAt: Date | null) {
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, image_keys, deleted_at)
    VALUES (${id}::uuid, ${ORG_ID}::uuid, 'Fixture Shirt', ${keys}::text[], ${deletedAt})
  `;
}

async function insertVariant(id: string, keys: string[], deletedAt: Date | null) {
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, image_keys, deleted_at)
    VALUES (${id}::uuid, ${P_LIVE}::uuid, ${ORG_ID}::uuid, ${'Fixture ' + id}, 'piece', 3000, ${keys}::text[], ${deletedAt})
  `;
}

async function keysOf(table: 'products' | 'product_variants', id: string): Promise<string[]> {
  const rows =
    table === 'products'
      ? await prisma.$queryRaw<Array<{ image_keys: string[] }>>`
          SELECT image_keys FROM products WHERE id = ${id}::uuid`
      : await prisma.$queryRaw<Array<{ image_keys: string[] }>>`
          SELECT image_keys FROM product_variants WHERE id = ${id}::uuid`;
  return rows[0].image_keys;
}

beforeEach(async () => {
  await prisma.organization.create({ data: { id: ORG_ID, name: 'Fixture Business' } });
  await insertProduct(P_LIVE, [], null);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(releaseDeletedImageKeys).mockClear();
  vi.useRealTimers();
  for (const file of await storage.listFiles(null, 5000)) await storage.delete(file.key);
});

describe('cleanup of deleted cards', () => {
  it('AC-1, C-50 releases the photos of a deleted product and a deleted variant', async () => {
    const [a, b, c] = [await storeAged(30), await storeAged(30), await storeAged(30)];
    await insertProduct(P_DELETED, [a, b], ago(30));
    await insertVariant(V_DELETED, [c], ago(25));

    const result = await cleanupOrphanImages(NOW);

    expect(await keysOf('products', P_DELETED)).toEqual([]);
    expect(await keysOf('product_variants', V_DELETED)).toEqual([]);
    for (const key of [a, b, c]) expect(await exists(key)).toBe(false);
    expect(result.released).toBe(3);
  });

  it('AC-1 logs the three counts and never a key', async () => {
    const info = vi.spyOn(logger, 'info');
    const key = await storeAged(30);
    await insertProduct(P_DELETED, [key], ago(30));

    expect(await runImageCleanupJob(NOW)).toBe(0);

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'image_cleanup_done',
        scanned: 0,
        deleted: 0,
        released: 1,
      }),
      expect.any(String)
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain(key);
  });

  it('AC-2, C-50 keeps the key and the file of a product deleted 2 hours ago', async () => {
    const key = await storeAged(30);
    await insertProduct(P_RECENT, [key], ago(2));

    const result = await cleanupOrphanImages(NOW);

    expect(await keysOf('products', P_RECENT)).toEqual([key]);
    expect(await exists(key)).toBe(true);
    expect(result.released).toBe(0);
  });

  it('AC-3 returns 1, logs image_cleanup_failed and deletes no file when the release fails', async () => {
    const error = vi.spyOn(logger, 'error');
    const key = await storeAged(30);
    const orphan = await storeAged(30);
    await insertProduct(P_DELETED, [key], ago(30));
    vi.mocked(releaseDeletedImageKeys).mockRejectedValueOnce(new Error('db down'));

    expect(await runImageCleanupJob(NOW)).toBe(1);

    expect(error.mock.calls[0][0]).toMatchObject({ event: 'image_cleanup_failed' });
    expect(await exists(key)).toBe(true);
    expect(await exists(orphan)).toBe(true);
    expect(await keysOf('products', P_DELETED)).toEqual([key]);
  });

  it('AB-1, CWE-284 leaves the keys and files of a live product and a live variant', async () => {
    const [a, b] = [await storeAged(30), await storeAged(30)];
    await prisma.$executeRaw`UPDATE products SET image_keys = ${[a]}::text[] WHERE id = ${P_LIVE}::uuid`;
    await insertVariant(V_LIVE, [b], null);

    const result = await cleanupOrphanImages(NOW);

    expect(await keysOf('products', P_LIVE)).toEqual([a]);
    expect(await keysOf('product_variants', V_LIVE)).toEqual([b]);
    expect(await exists(a)).toBe(true);
    expect(await exists(b)).toBe(true);
    expect(result).toEqual({ scanned: 2, deleted: 0, released: 0 });
  });

  it('releases in rounds of 500 until a call returns no key', async () => {
    const keys = Array.from({ length: 3 }, () => newImageKey('products'));
    await insertProduct(P_DELETED, keys.slice(0, 2), ago(30));
    await insertVariant(V_DELETED, keys.slice(2), ago(30));

    const result = await cleanupOrphanImages(NOW);

    expect(result.released).toBe(3);
    const calls = vi.mocked(releaseDeletedImageKeys).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][1]).toEqual(ago(24));
    expect(calls[0][2]).toBe(500);
  });
});
