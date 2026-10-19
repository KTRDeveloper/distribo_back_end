import { imageKeySchema } from '../../lib/image-keys.js';
import { logger } from '../../lib/logger.js';
import { getImageStorage } from './image.ports.js';
import { findCitedKeys } from './image.repository.js';

/**
 * Deletes from storage the photo files whose key no card cites (C-50). A key that a product,
 * a variant, a person or an organization still holds is kept (C-49), so a shared key never
 * removes another card's photo. A key that is not a canonical server key is skipped, never
 * sent to storage (ASVS v5.0.0-5.3.2). An absent file is no error; a storage error is logged
 * as `image_delete_failed` (warn) and never fails the caller, the nightly cleanup retries.
 */
export async function deleteImageFiles(keys: string[]): Promise<void> {
  const candidates = [...new Set(keys)].filter((key) => {
    if (imageKeySchema.safeParse(key).success) return true;
    logger.warn({ event: 'image_delete_skipped' }, 'Image key is not canonical');
    return false;
  });
  if (candidates.length === 0) return;

  const cited = await findCitedKeys(candidates);
  const storage = getImageStorage();
  for (const key of candidates) {
    if (cited.has(key)) continue;
    try {
      await storage.delete(key);
    } catch (err) {
      logger.warn({ event: 'image_delete_failed', key, err }, 'Image file could not be deleted');
    }
  }
}
