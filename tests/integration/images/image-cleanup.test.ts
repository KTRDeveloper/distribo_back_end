import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';
import { logger } from '../../../src/lib/logger';
import { newImageKey } from '../../../src/lib/image-keys';
import { getImageStorage } from '../../../src/modules/images/image.ports';
import { findCitedKeys } from '../../../src/modules/images/image.repository';
import { cleanupOrphanImages } from '../../../src/modules/images/image-cleanup.service';
import { runImageCleanupJob } from '../../../src/jobs/image-cleanup';

// The real citation query, wrapped so that a test can make it fail
vi.mock('../../../src/modules/images/image.repository', async (importActual) => {
  const actual =
    await importActual<typeof import('../../../src/modules/images/image.repository')>();
  return { ...actual, findCitedKeys: vi.fn(actual.findCitedKeys) };
});

const ORG_ID = '0199c007-0000-7000-8000-000000000001';
const PRODUCT_ID = '0199c007-0000-7000-8000-000000000011';
const NOW = new Date('2026-06-15T12:00:00.000Z');
const HOUR = 3_600_000;

const storage = getImageStorage();
const exists = async (key: string) => (await storage.get(key)) !== null;

/** Stores a file whose storage time is `hoursAgo` hours before NOW. */
async function storeAged(key: string, hoursAgo: number): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date(NOW.getTime() - hoursAgo * HOUR));
    await storage.put(key, Buffer.from('file'));
  } finally {
    vi.useRealTimers();
  }
}

async function seedProduct(imageKeys: string[]): Promise<void> {
  await prisma.product.create({
    data: {
      id: PRODUCT_ID,
      organizationId: ORG_ID,
      name: 'Riz',
      imageKeys,
    },
  });
}

beforeEach(async () => {
  await prisma.organization.create({ data: { id: ORG_ID, name: 'Fixture Business' } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(findCitedKeys).mockClear();
  vi.useRealTimers();
  for (const file of await storage.listFiles(null, 5000)) await storage.delete(file.key);
});

describe('cleanupOrphanImages', () => {
  it('AC-1, C-50 deletes a 30-hour-old uncited file and counts it', async () => {
    const key = newImageKey('products');
    await storeAged(key, 30);

    const result = await cleanupOrphanImages(NOW);

    expect(await exists(key)).toBe(false);
    expect(result).toEqual({ scanned: 1, deleted: 1, released: 0 });
  });

  it('AC-2, C-50 keeps a recent uncited file and an old cited file', async () => {
    const recent = newImageKey('products');
    const cited = newImageKey('products');
    await storeAged(recent, 2);
    await storeAged(cited, 120);
    await seedProduct([cited]);

    const result = await cleanupOrphanImages(NOW);

    expect(await exists(recent)).toBe(true);
    expect(await exists(cited)).toBe(true);
    expect(result).toEqual({ scanned: 2, deleted: 0, released: 0 });
  });

  it('keeps a file stored exactly 24 hours before now', async () => {
    const key = newImageKey('products');
    await storeAged(key, 24);

    const result = await cleanupOrphanImages(NOW);

    expect(await exists(key)).toBe(true);
    expect(result.deleted).toBe(0);
  });

  it('AC-3 deletes 1200 old uncited files over three pages and keeps the 3 cited', async () => {
    const orphans = Array.from({ length: 1200 }, () => newImageKey('products'));
    const cited = Array.from({ length: 3 }, () => newImageKey('products'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW.getTime() - 40 * HOUR));
    for (const key of [...orphans, ...cited]) await storage.put(key, Buffer.from('file'));
    vi.useRealTimers();
    await seedProduct(cited);

    const result = await cleanupOrphanImages(NOW);

    expect(result).toEqual({ scanned: 1203, deleted: 1200, released: 0 });
    const left = await storage.listFiles(null, 5000);
    expect(left.map((file) => file.key).sort()).toEqual([...cited].sort());
  });

  it('AB-1, CWE-755 deletes nothing and throws when the citation query fails', async () => {
    const key = newImageKey('products');
    await storeAged(key, 30);
    vi.mocked(findCitedKeys).mockRejectedValueOnce(new Error('db down'));

    await expect(cleanupOrphanImages(NOW)).rejects.toThrow();

    expect(await exists(key)).toBe(true);
  });

  it('throws and deletes nothing more when the storage list fails', async () => {
    const key = newImageKey('products');
    await storeAged(key, 30);
    vi.spyOn(storage, 'listFiles').mockRejectedValue(new Error('storage down'));

    await expect(cleanupOrphanImages(NOW)).rejects.toThrow('storage down');
    expect(await exists(key)).toBe(true);
  });
});

describe('runImageCleanupJob', () => {
  it('AC-4 returns 0 with a working storage and logs both counts', async () => {
    const info = vi.spyOn(logger, 'info');
    const key = newImageKey('products');
    await storeAged(key, 30);

    expect(await runImageCleanupJob(NOW)).toBe(0);

    expect(await exists(key)).toBe(false);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'image_cleanup_done', scanned: 1, deleted: 1 }),
      expect.any(String)
    );
  });

  it('AC-4 returns 1 and logs image_cleanup_failed when listing fails', async () => {
    const error = vi.spyOn(logger, 'error');
    vi.spyOn(storage, 'listFiles').mockRejectedValue(new Error('storage down'));

    expect(await runImageCleanupJob(NOW)).toBe(1);

    expect(error.mock.calls[0][0]).toMatchObject({ event: 'image_cleanup_failed' });
  });

  it('AB-1 exits with 1 and deletes nothing when the citation query throws', async () => {
    const key = newImageKey('products');
    await storeAged(key, 30);
    vi.mocked(findCitedKeys).mockRejectedValueOnce(new Error('db down'));

    expect(await runImageCleanupJob(NOW)).toBe(1);
    expect(await exists(key)).toBe(true);
  });
});
