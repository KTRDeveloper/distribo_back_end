import type { Prisma } from '@prisma/client';
import { NAME_MAX, TEXT_MAX } from '../../shared/limits.js';
import { parseQuantity } from '../../shared/money.js';
import { simplifyText, variantLabel } from '../../shared/variant.js';
import {
  findLiveTwin,
  findProductAnyState,
  findVariantAnyState,
  insertMergedVariant,
  insertSyncedProduct,
  insertVariant,
  updateProductText,
  updateVariant,
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

/** The only fields a phone may send for a variant. */
export type VariantSyncInput = {
  id: string;
  productId: string;
  name: string | null;
  unit: string;
  price: number;
  minOrderQuantity: string | null;
  status: 'ACTIVE' | 'INACTIVE';
};

export type VariantSyncResult = {
  result:
    | 'CREATED'
    | 'UPDATED'
    | 'UNCHANGED'
    | 'MERGED'
    | 'COLLISION'
    | 'NO_PRODUCT'
    | 'FOREIGN'
    | 'GONE'
    | 'INVALID';
  /** Field names only, never values (v5.0.0-2.2.1). Set with `INVALID`. */
  invalidFields?: string[];
  /** Id of the variant a duplicate was folded into. Set with `MERGED` (CAT-035). */
  mergedInto?: string;
  /** Label of that variant. Set with `MERGED` (CAT-035). */
  label?: string;
};

/** Largest quantity `numeric(12,3)` holds, in thousandths. */
const QUANTITY_MAX_MILLI = 999_999_999_999n;

/** Thousandths of a valid minimum quantity (above 0, three decimals at most), else null. */
function quantityMilli(text: unknown): bigint | null {
  if (typeof text !== 'string' || text.length > 32) return null;
  try {
    const milli = parseQuantity(text);
    return milli > 0n && milli <= QUANTITY_MAX_MILLI ? milli : null;
  } catch {
    return null;
  }
}

/** Names of the fields beyond their limits (CAT-022 limits, C-13), checked before any write. */
function invalidVariantFieldsOf(input: VariantSyncInput): string[] {
  const invalid: string[] = [];
  if (input.name != null && (typeof input.name !== 'string' || input.name.length > NAME_MAX)) {
    invalid.push('name');
  }
  if (
    typeof input.unit !== 'string' ||
    input.unit.length > NAME_MAX ||
    simplifyText(input.unit) === ''
  ) {
    invalid.push('unit');
  }
  if (!Number.isSafeInteger(input.price) || input.price < 1) invalid.push('price');
  if (input.minOrderQuantity != null && quantityMilli(input.minOrderQuantity) === null) {
    invalid.push('minOrderQuantity');
  }
  if (input.status !== 'ACTIVE' && input.status !== 'INACTIVE') invalid.push('status');
  return invalid;
}

/** The `MERGED` answer for a folded row: the variant it points to and that variant's label. */
async function mergedResult(
  tx: Prisma.TransactionClient,
  twinId: string,
  productId: string
): Promise<VariantSyncResult> {
  const twin = await findVariantAnyState(tx, twinId);
  const product = await findProductAnyState(tx, productId);
  // The foreign key keeps both rows; their absence is an unexpected state: fail closed.
  if (!twin || !product) throw new Error('Merged variant points to a missing row');
  return {
    result: 'MERGED',
    mergedInto: twin.id,
    label: variantLabel(product.name, twin.name, twin.unit),
  };
}

/**
 * Creates or edits a variant sent by the owner's phone, for the product push of the
 * synchronization (ADR-004). It never throws for a business reason: every refusal is a result
 * and writes nothing, so one variant never fails the batch (C-36).
 *
 * Exactly five fields are read from the input: `name`, `unit`, `price`, `minOrderQuantity` and
 * `status`. The merge link, the price date and the photos have no way in, and the product of an
 * existing variant never changes (v5.0.0-15.3.3, C-13). The product of a new variant and any
 * existing variant are judged through the organization of the session (v5.0.0-8.2.2): a product
 * of another organization or a deleted one gives `NO_PRODUCT`, a variant of another organization
 * `FOREIGN`, a deleted variant `GONE`. A live twin (same simplified name and unit in the product,
 * C-47) of an edit gives `COLLISION`; for an unknown id it gives `MERGED` (CAT-035): the duplicate
 * is stored at once as a deleted row whose `merged_into_id` is the twin, found by the server in
 * the organization's product and never read from the input (v5.0.0-15.3.3, v5.0.0-8.2.2). The
 * twin keeps its price, photos, minimum and status. The same id sent again finds that row and
 * answers `MERGED` again, writing nothing (C-36). Nothing is written when the
 * five fields are unchanged, so no date moves on a repeat (C-35). A variant put back on sale is
 * never refused here: the caller pauses the excess.
 *
 * The product row is locked before a creation so two pushes for one product apply one after the
 * other; a twin created by another writer in between is caught by the unique index and reported
 * as a merge into that twin.
 *
 * @param tx - Transaction of the synchronization.
 * @param organizationId - Organization of the session, never taken from the input.
 * @param now - Deletion date of a folded duplicate; the other dates come from the database.
 */
export async function applyVariantFromSync(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: VariantSyncInput,
  now: Date
): Promise<VariantSyncResult> {
  const invalidFields = invalidVariantFieldsOf(input);
  if (invalidFields.length > 0) return { result: 'INVALID', invalidFields };

  const fields = {
    name: input.name ?? null,
    unit: input.unit,
    price: input.price,
    minOrderQuantity: input.minOrderQuantity ?? null,
    status: input.status,
  };

  let existing = await findVariantAnyState(tx, input.id);
  if (!existing) {
    const product = await findProductAnyState(tx, input.productId);
    if (!product || product.organizationId !== organizationId || product.deletedAt) {
      return { result: 'NO_PRODUCT' };
    }
    let twinId = await findLiveTwin(tx, input.productId, fields.name, fields.unit);
    if (!twinId) {
      const created = await insertVariant(tx, {
        id: input.id,
        organizationId,
        productId: product.id,
        ...fields,
      });
      if (created) return { result: 'CREATED' };
      // Another writer took the id or the twin's place since the reads: judge what is there now.
      existing = await findVariantAnyState(tx, input.id);
      if (!existing) {
        twinId = await findLiveTwin(tx, input.productId, fields.name, fields.unit);
        if (!twinId) return { result: 'COLLISION' };
      }
    }
    if (twinId) {
      await insertMergedVariant(tx, input, organizationId, twinId, now);
      existing = await findVariantAnyState(tx, input.id);
      if (!existing) return { result: 'COLLISION' };
    }
  }

  if (!existing) return { result: 'COLLISION' };
  if (existing.organizationId !== organizationId) return { result: 'FOREIGN' };
  if (existing.mergedIntoId) return mergedResult(tx, existing.mergedIntoId, existing.productId);
  if (existing.deletedAt) return { result: 'GONE' };

  const sameMinimum =
    fields.minOrderQuantity === null || existing.minOrderQuantity === null
      ? fields.minOrderQuantity === existing.minOrderQuantity
      : quantityMilli(fields.minOrderQuantity) === quantityMilli(existing.minOrderQuantity);
  if (
    existing.name === fields.name &&
    existing.unit === fields.unit &&
    existing.price === BigInt(fields.price) &&
    sameMinimum &&
    existing.status === fields.status
  ) {
    return { result: 'UNCHANGED' };
  }
  if (await findLiveTwin(tx, existing.productId, fields.name, fields.unit, existing.id)) {
    return { result: 'COLLISION' };
  }
  await updateVariant(tx, existing.id, fields);
  return { result: 'UPDATED' };
}
