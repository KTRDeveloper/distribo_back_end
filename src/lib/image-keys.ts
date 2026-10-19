import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { env } from '../config/env.js';

/** Storage folders. Product photos and variant photos share `products`. */
export type ImageFolder = 'logos' | 'avatars' | 'products';

/**
 * Accept only canonical keys: `<folder>/<lower-case UUIDv4>.webp`. Anything else (other
 * folder, upper case, other extension, path segments) is rejected, so a key can never
 * reach outside the image base address (ASVS v5.0.0-5.3.2, v5.0.0-13.2.4).
 */
export const imageKeySchema: z.ZodString = z
  .string()
  .regex(
    /^(logos|avatars|products)\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/,
    'Expected a canonical image key'
  );

/**
 * Build the storage key of a new image from a random UUIDv4 (never a UUIDv7, which carries
 * its creation time). No client text, organization, product or person id enters the key.
 */
export function newImageKey(folder: ImageFolder): string {
  return `${folder}/${uuidv4()}.webp`;
}

/**
 * Join a base address and a canonical key.
 * @throws {RangeError} when the key is not canonical (CWE-22: no address is built).
 */
export function buildImageUrl(baseUrl: string, key: string): string {
  if (!imageKeySchema.safeParse(key).success) {
    throw new RangeError('Invalid image key');
  }
  return `${baseUrl}/${key}`;
}

/**
 * Public address of a stored key, from the deployment's `IMAGE_PUBLIC_BASE_URL`;
 * null stays null (no image).
 * @throws {RangeError} when the key is not canonical.
 */
export function imageUrl(key: string | null): string | null {
  if (key === null) return null;
  return buildImageUrl(env.IMAGE_PUBLIC_BASE_URL, key);
}
