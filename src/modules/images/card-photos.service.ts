import type { Prisma } from '@prisma/client';
import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { httpError } from '../../lib/http-error.js';
import { imageUrl } from '../../lib/image-keys.js';
import {
  lockProductImageKeys,
  lockVariantImageKeys,
  readVariantImageKeys,
  setProductImageKeys,
  setVariantImageKeys,
} from '../catalog/catalog.repository.js';
import { runInTransaction } from '../organization/organization.repository.js';
import { copyImage } from './image-copy.service.js';
import { deleteImageFiles, storeUploadedImage } from './image.service.js';

/** The most photos a product or a variant holds (C-49; the database CHECK says the same). */
export const PHOTOS_PER_CARD = 5;

/**
 * A card that holds an ordered list of photo keys (a product or a variant). `lock` reads
 * the list under a row lock; `write` replaces it and returns the previous list. Both run in the
 * caller's transaction and answer 404 `NOT_FOUND` when the card is not in the business.
 */
export type PhotoCard = {
  lock(tx: Prisma.TransactionClient): Promise<string[]>;
  write(tx: Prisma.TransactionClient, keys: string[]): Promise<string[]>;
};

/**
 * The photo list of a live product of the business. The product is looked up by id and business
 * together (ASVS v5.0.0-8.2.2), and the business must still be active when the list is locked,
 * in the same transaction as the write.
 */
export function productCard(organizationId: string, productId: string): PhotoCard {
  return {
    lock: async (tx) => {
      await assertOrganizationActive(organizationId, tx);
      return lockProductImageKeys(tx, organizationId, productId);
    },
    write: (tx, keys) => setProductImageKeys(tx, organizationId, productId, keys),
  };
}

/**
 * The photo list of a live variant (ACTIVE or INACTIVE) of the business. The variant is looked up
 * by id and business together (ASVS v5.0.0-8.2.2) and must belong to `productId`, the product of
 * the path; otherwise `lock` answers 404 `NOT_FOUND` and nothing is written. The business must
 * still be active when the list is locked, in the same transaction as the write.
 */
export function variantCard(
  organizationId: string,
  productId: string,
  variantId: string
): PhotoCard {
  return {
    lock: async (tx) => {
      await assertOrganizationActive(organizationId, tx);
      const held = await lockVariantImageKeys(tx, organizationId, variantId);
      if (held.productId !== productId) throw httpError(404, 'NOT_FOUND', 'Not found');
      return held.keys;
    },
    write: (tx, keys) => setVariantImageKeys(tx, organizationId, variantId, keys),
  };
}

/**
 * Adds or replaces the photo at a 1-based position of a card and returns the public addresses in
 * order (C-49, C-50). A held position is replaced; the position after the last adds; any other
 * position answers 400 `VALIDATION_ERROR`. Order: check and store the new file, then in one
 * transaction lock the list, change it and write it, then delete the replaced file. If the
 * transaction fails for any reason the new file is deleted at once, so nothing is left behind and
 * the list is unchanged. The key is built by the server (ASVS v5.0.0-15.3.3); the caller has
 * already checked the role and the business.
 * @throws {HttpError} 400 `UNSUPPORTED_IMAGE` / `IMAGE_TOO_LARGE` / `VALIDATION_ERROR`, 404
 * `NOT_FOUND`, 409 `ORGANIZATION_NOT_ACTIVE`.
 */
export async function putCardPhoto(
  card: PhotoCard,
  position: number,
  bytes: Buffer
): Promise<{ image_urls: string[] }> {
  if (!Number.isInteger(position) || position < 1 || position > PHOTOS_PER_CARD) {
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const key = await storeUploadedImage('products', bytes);

  let keys: string[];
  let replaced: string | undefined;
  try {
    ({ keys, replaced } = await runInTransaction(async (tx) => {
      const held = await card.lock(tx);
      if (position > held.length + 1) {
        throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
      }
      const next = [...held];
      const previous = next[position - 1];
      next[position - 1] = key;
      await card.write(tx, next);
      return { keys: next, replaced: previous };
    }));
  } catch (err) {
    await deleteImageFiles([key]);
    throw err;
  }

  if (replaced !== undefined) await deleteImageFiles([replaced]);
  return { image_urls: keys.map((held) => imageUrl(held)!) };
}

/**
 * Removes the photo whose file name is `photoId` from a card and returns the public addresses of
 * those that remain (C-50). The photo is found by its id, never by its position, so a retry cannot
 * remove another photo. In one transaction the list is locked, the key dropped and the list
 * written; after the commit the file is deleted. An id the card does not hold changes nothing,
 * writes nothing and deletes no file. The caller has already checked the role and the format of
 * the id.
 * @throws {HttpError} 404 `NOT_FOUND`, 409 `ORGANIZATION_NOT_ACTIVE`.
 */
export async function removeCardPhoto(
  card: PhotoCard,
  photoId: string
): Promise<{ image_urls: string[] }> {
  const wanted = `products/${photoId.toLowerCase()}.webp`;
  const { keys, removed } = await runInTransaction(async (tx) => {
    const held = await card.lock(tx);
    if (!held.includes(wanted)) return { keys: held, removed: false };
    const next = held.filter((key) => key !== wanted);
    await card.write(tx, next);
    return { keys: next, removed: true };
  });

  if (removed) await deleteImageFiles([wanted]);
  return { image_urls: keys.map((held) => imageUrl(held)!) };
}

/** The body of a photo taken from another variant (already validated by the route). */
export type TakePhotoInput = { id: string; source_variant_id: string; source_photo_id: string };

/**
 * Appends to a variant a copy of a photo held by another variant of the same product and
 * business, and returns the public addresses of the destination in order (C-56). In one
 * transaction (ASVS v5.0.0-2.3.3): the destination is locked; the source is read without a lock,
 * so two crossed copies cannot block each other; the photo is found by its id in the source's
 * keys; `copyImage` stores the new file and writes the registry row; the new key is appended.
 * The source keeps its photo. Both variants are read inside the business of the session
 * (ASVS v5.0.0-8.2.2), so a stranger's id is a 404. If the transaction fails after the file was
 * written, the new file is deleted at once. The caller has already checked the role and the
 * body's format.
 * @throws {HttpError} 400 `VALIDATION_ERROR` (source is the destination), 404 `NOT_FOUND`
 * (no such variant, product pair, photo, or the source file is gone), 409 `PHOTO_LIMIT_REACHED`
 * or `ORGANIZATION_NOT_ACTIVE`.
 */
export async function takeVariantPhoto(
  organizationId: string,
  productId: string,
  variantId: string,
  input: TakePhotoInput
): Promise<{ image_urls: string[] }> {
  if (input.source_variant_id.toLowerCase() === variantId.toLowerCase()) {
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const wanted = `products/${input.source_photo_id.toLowerCase()}.webp`;
  const destination = variantCard(organizationId, productId, variantId);

  let created: string | null = null;
  try {
    const keys = await runInTransaction(async (tx) => {
      const held = await destination.lock(tx);
      const source = await readVariantImageKeys(tx, organizationId, input.source_variant_id);
      if (source.productId !== productId || !source.keys.includes(wanted)) {
        throw httpError(404, 'NOT_FOUND', 'Not found');
      }
      if (held.length >= PHOTOS_PER_CARD) {
        throw httpError(409, 'PHOTO_LIMIT_REACHED', 'The variant already holds the most photos');
      }
      created = await copyImage(tx, wanted);
      if (created === null) throw httpError(404, 'NOT_FOUND', 'Not found');
      const next = [...held, created];
      await destination.write(tx, next);
      return next;
    });
    return { image_urls: keys.map((held) => imageUrl(held)!) };
  } catch (err) {
    if (created !== null) await deleteImageFiles([created]);
    throw err;
  }
}
