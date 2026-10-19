import { assertOrganizationActive } from '../../middleware/load-actor.js';
import { imageUrl } from '../../lib/image-keys.js';
import { logger } from '../../lib/logger.js';
import { runInTransaction, setLogoKey } from '../organization/organization.repository.js';
import type { Actor } from '../../types/express.js';
import { deleteImageFiles, storeUploadedImage } from './image.service.js';

/**
 * Writes the logo key (or clears it) and returns the previous key. The activity check runs in
 * the same transaction as the write, so a business suspended meanwhile keeps its logo.
 */
function writeKey(organizationId: string, key: string | null): Promise<string | null> {
  return runInTransaction(async (tx) => {
    await assertOrganizationActive(organizationId, tx);
    return setLogoKey(tx, organizationId, key);
  });
}

/**
 * Stores a new business logo and returns its address (C-49, C-50). The owner check happened
 * upstream (`change_logo`); the business comes from the actor, never from the body.
 * Order: refuse an inactive business, check and store the new file, write the key in one
 * transaction (`setLogoKey`), then delete the previous file. If the write fails the new file
 * is deleted at once, so nothing is left behind and the key is unchanged. The key is built by
 * the server (ASVS v5.0.0-15.3.3).
 * @throws {HttpError} 409 `ORGANIZATION_NOT_ACTIVE`, 404 `NOT_FOUND`, 400 `UNSUPPORTED_IMAGE`
 * / `IMAGE_TOO_LARGE`.
 */
export async function replaceLogo(actor: Actor, bytes: Buffer): Promise<{ logo_url: string }> {
  await assertOrganizationActive(actor.organizationId);
  const key = await storeUploadedImage('logos', bytes);

  let previous: string | null;
  try {
    previous = await writeKey(actor.organizationId, key);
  } catch (err) {
    await deleteImageFiles([key]);
    throw err;
  }

  if (previous !== null) await deleteImageFiles([previous]);
  logger.info(
    { event: 'logo_changed', organizationId: actor.organizationId, personId: actor.personId },
    'Logo changed'
  );
  return { logo_url: imageUrl(key)! };
}

/**
 * Clears the business logo and deletes the file; a repeat changes nothing.
 * @throws {HttpError} 409 `ORGANIZATION_NOT_ACTIVE`, 404 `NOT_FOUND`.
 */
export async function removeLogo(actor: Actor): Promise<void> {
  const previous = await writeKey(actor.organizationId, null);
  if (previous !== null) await deleteImageFiles([previous]);
  logger.info(
    { event: 'logo_changed', organizationId: actor.organizationId, personId: actor.personId },
    'Logo changed'
  );
}
