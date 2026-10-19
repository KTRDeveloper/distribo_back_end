import { env } from '../../config/env.js';
import { httpError } from '../../lib/http-error.js';
import { type ImageFolder, imageKeySchema, newImageKey } from '../../lib/image-keys.js';
import { logger } from '../../lib/logger.js';
import { UnreadableImageError, getImageProcessor, getImageStorage } from './image.ports.js';
import { findCitedKeys } from './image.repository.js';

/**
 * Checks a received photo and stores a re-encoded copy under a new server key; returns the key.
 * Order: size, content inspection (the declared type and any file name prove nothing, ASVS
 * v5.0.0-5.2.2), pixel count before any pixel is decoded (ASVS v5.0.0-5.2.6), re-encoding to
 * WebP without metadata (no GPS or camera data survives, CWE-200), then storage. The received
 * bytes are never stored, and a refused file stores nothing. The caller writes the key on the
 * card in one transaction, then calls `deleteImageFiles` for the previous key (C-49, C-50), or
 * deletes the new file at once if that transaction fails.
 * @throws {HttpError} 400 `VALIDATION_ERROR` (empty), `IMAGE_TOO_LARGE` (bytes or pixels),
 * `UNSUPPORTED_IMAGE` (unreadable or other format).
 */
export async function storeUploadedImage(folder: ImageFolder, bytes: Buffer): Promise<string> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw httpError(400, 'VALIDATION_ERROR', 'The image is empty');
  }
  if (bytes.length > env.IMAGE_MAX_BYTES) {
    throw httpError(400, 'IMAGE_TOO_LARGE', 'The image is too large');
  }

  const processor = getImageProcessor();
  let size: { width: number; height: number };
  try {
    size = await processor.inspect(bytes);
  } catch (err) {
    if (err instanceof UnreadableImageError) {
      throw httpError(400, 'UNSUPPORTED_IMAGE', 'The file must be a JPEG, PNG or WebP image');
    }
    throw err;
  }
  if (size.width * size.height > env.IMAGE_MAX_PIXELS) {
    throw httpError(400, 'IMAGE_TOO_LARGE', 'The image is too large');
  }

  let clean: Buffer;
  try {
    clean = await processor.reencode(bytes, { vary: false });
  } catch (err) {
    if (err instanceof UnreadableImageError) {
      throw httpError(400, 'UNSUPPORTED_IMAGE', 'The file must be a JPEG, PNG or WebP image');
    }
    throw err;
  }
  const key = newImageKey(folder);
  await getImageStorage().put(key, clean);
  return key;
}

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
