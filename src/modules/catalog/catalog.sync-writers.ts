import type { Prisma } from '@prisma/client';
import { NAME_MAX, TEXT_MAX } from '../../shared/limits.js';
import {
  findProductAnyState,
  insertSyncedProduct,
  updateProductText,
} from './catalog.repository.js';

/** The only fields a phone may send for a product. */
export type ProductSyncInput = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
};

export type ProductSyncResult = {
  result: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'GONE' | 'FOREIGN' | 'INVALID';
  /** Field names only, never values (v5.0.0-2.2.1). Set with `INVALID`. */
  invalidFields?: string[];
};

/** Names of the fields beyond their limits (CAT-004 limits), checked before any write. */
function invalidFieldsOf(input: ProductSyncInput): string[] {
  const invalid: string[] = [];
  if (typeof input.name !== 'string' || input.name.length < 1 || input.name.length > NAME_MAX) {
    invalid.push('name');
  }
  if (
    input.description != null &&
    (typeof input.description !== 'string' || input.description.length > TEXT_MAX)
  ) {
    invalid.push('description');
  }
  if (
    input.category != null &&
    (typeof input.category !== 'string' || input.category.length > NAME_MAX)
  ) {
    invalid.push('category');
  }
  return invalid;
}

/**
 * Creates or edits a product sent by the owner's phone, for the product push of the
 * synchronization (ADR-004). It never throws for a business reason: every refusal is a result
 * and writes nothing, so one product never fails the batch (C-36).
 *
 * Exactly three fields are read from the input: `name`, `description` and `category`. The pause,
 * the photos, the unit and the price have no way in, whatever else the row carries (C-46,
 * v5.0.0-15.3.3). The plan limit never refuses a product here: the caller pauses the excess.
 * An id found in another organization is never written (`FOREIGN`, v5.0.0-8.2.2), and a deleted
 * product stays deleted (`GONE`). Nothing is written when the texts are unchanged, so
 * `server_updated_at` does not move on a repeat (C-35).
 *
 * @param tx - Transaction of the synchronization.
 * @param organizationId - Organization of the session, never taken from the input.
 * @param now - Part of the synchronization writers' signature; the dates come from the database.
 */
export async function applyProductFromSync(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: ProductSyncInput,
  now: Date
): Promise<ProductSyncResult> {
  void now;
  const invalidFields = invalidFieldsOf(input);
  if (invalidFields.length > 0) return { result: 'INVALID', invalidFields };

  const texts = {
    name: input.name,
    description: input.description ?? null,
    category: input.category ?? null,
  };

  let existing = await findProductAnyState(tx, input.id);
  if (!existing) {
    const created = await insertSyncedProduct(tx, { id: input.id, organizationId, ...texts });
    if (created) return { result: 'CREATED' };
    // Another push created the id since the read: judge the row that is there now.
    existing = await findProductAnyState(tx, input.id);
    if (!existing) return { result: 'GONE' };
  }

  if (existing.organizationId !== organizationId) return { result: 'FOREIGN' };
  if (existing.deletedAt) return { result: 'GONE' };
  if (
    existing.name === texts.name &&
    existing.description === texts.description &&
    existing.category === texts.category
  ) {
    return { result: 'UNCHANGED' };
  }
  await updateProductText(tx, input.id, texts);
  return { result: 'UPDATED' };
}
