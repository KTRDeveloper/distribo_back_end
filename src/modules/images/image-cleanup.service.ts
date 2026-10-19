import { imageKeySchema } from '../../lib/image-keys.js';
import { releaseDeletedImageKeys } from '../catalog/catalog.repository.js';
import { runInTransaction } from '../organization/organization.repository.js';
import { getImageStorage } from './image.ports.js';
import { findCitedKeys } from './image.repository.js';
import { deleteImageFiles } from './image.service.js';

const PAGE_SIZE = 500;
const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const RELEASE_BATCH = 500;

/**
 * Empties the photo keys of products and variants deleted more than 24 hours before `now`, then
 * deletes their files. Each round empties the keys in its own transaction and passes them to
 * `deleteImageFiles` only after the commit (ASVS v5.0.0-2.3.3); rounds go on until one releases no
 * key. A card deleted later, or not deleted, keeps its keys.
 * @returns the number of keys emptied.
 */
async function releaseDeletedCards(now: Date): Promise<number> {
  const deletedBefore = new Date(now.getTime() - MIN_AGE_MS);
  let released = 0;
  for (;;) {
    const keys = await runInTransaction((tx) =>
      releaseDeletedImageKeys(tx, deletedBefore, RELEASE_BATCH)
    );
    if (keys.length === 0) break;
    released += keys.length;
    await deleteImageFiles(keys);
  }
  return released;
}

/**
 * Nightly cleanup (C-50). It first releases the photos of products and variants deleted more than
 * 24 hours ago (`released`), then walks the whole storage in pages of 500 files and deletes, one
 * `deleteImageFiles` call per page, every file stored more than 24 hours before `now` that no
 * card cites. A younger file is never deleted (an upload may still be writing its card) and a
 * cited file is never deleted, whatever its age. A key that is not a canonical server key is
 * counted as scanned but never sent for deletion.
 * Fail closed: if the release, the listing or the citation query fails, nothing more is deleted
 * and the error is thrown; a failed release stops the run before the walk (CWE-755).
 * @returns `scanned`: files listed; `deleted`: old uncited files sent for deletion; `released`:
 * keys emptied from deleted cards.
 */
export async function cleanupOrphanImages(
  now: Date
): Promise<{ scanned: number; deleted: number; released: number }> {
  const released = await releaseDeletedCards(now);
  const storage = getImageStorage();
  const limit = now.getTime() - MIN_AGE_MS;
  let scanned = 0;
  let deleted = 0;
  let after: string | null = null;

  for (;;) {
    const page = await storage.listFiles(after, PAGE_SIZE);
    if (page.length === 0) break;
    scanned += page.length;
    after = page[page.length - 1].key;

    const old = page
      .filter((file) => file.storedAt.getTime() < limit)
      .map((file) => file.key)
      .filter((key) => imageKeySchema.safeParse(key).success);
    if (old.length > 0) {
      const cited = await findCitedKeys(old);
      const orphans = old.filter((key) => !cited.has(key));
      if (orphans.length > 0) {
        await deleteImageFiles(orphans);
        deleted += orphans.length;
      }
    }

    if (page.length < PAGE_SIZE) break;
  }
  return { scanned, deleted, released };
}
