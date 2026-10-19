import type { Prisma } from '@prisma/client';
import { NAME_MAX, TEXT_MAX } from '../../shared/limits.js';
import { parseQuantity } from '../../shared/money.js';
import { simplifyText, variantLabel } from '../../shared/variant.js';
import {
  findLiveTwin,
  findProductAnyState,
  findCustomerPriceAnyState,
  findLiveCustomerPriceId,
  findUsedVariantIds,
  findVariantAnyState,
  insertMergedVariant,
  insertSyncedProduct,
  insertVariant,
  listLiveVariantsOfProduct,
  lockCustomerPricePair,
  lockLiveRelationshipOfSupplier,
  lockLiveVariantsOfProduct,
  restoreProduct,
  restoreVariantOffSale,
  retireVariants,
  softDeleteCustomerPrice,
  softDeleteProduct,
  softDeleteVariants,
  updateCustomerPriceAmount,
  updateProductText,
  updateVariant,
  upsertCustomerPrice,
  type VariantAnyState,
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

export type DeleteSyncResult = {
  result: 'DELETED' | 'RETIRED' | 'ALREADY' | 'LAST_VARIANT' | 'NOT_FOUND';
  /** Labels of the variants taken off sale instead of deleted. Set with `RETIRED`. */
  retiredLabels: string[];
};

/**
 * Deletes a variant sent by the owner's phone, for the product push of the synchronization
 * (ADR-004). It never throws for a business reason: every refusal is a result (C-36).
 *
 * A variant cited by an order line or a live negotiated price is never deleted: it becomes
 * `INACTIVE` and its label is returned (`RETIRED`, C-48), so no sale loses its article. Only its
 * status changes (v5.0.0-15.3.3). An unused variant gets `deleted_at = now` (`DELETED`), unless it
 * is the last live variant of its product, which is kept (`LAST_VARIANT`, C-45). An already
 * deleted variant gives `ALREADY`; an unknown id or one of another organization gives `NOT_FOUND`
 * (v5.0.0-8.2.2). The refusals write nothing. The variant row, then the product row, are locked
 * for the caller's transaction (v5.0.0-2.3.3), so two deletions of one product's variants cannot
 * both leave it without a variant.
 *
 * @param tx - Transaction of the synchronization.
 * @param organizationId - Organization of the session, never taken from the input.
 * @param variantId - Variant to delete.
 * @param now - Deletion date.
 */
export async function deleteVariantFromSync(
  tx: Prisma.TransactionClient,
  organizationId: string,
  variantId: string,
  now: Date
): Promise<DeleteSyncResult> {
  const variant = await findVariantAnyState(tx, variantId);
  if (!variant || variant.organizationId !== organizationId) {
    return { result: 'NOT_FOUND', retiredLabels: [] };
  }
  if (variant.deletedAt) return { result: 'ALREADY', retiredLabels: [] };
  const product = await findProductAnyState(tx, variant.productId);
  // The foreign key keeps the product; its absence is an unexpected state: fail closed.
  if (!product || product.organizationId !== organizationId) {
    throw new Error('Variant points to a missing or foreign product');
  }

  if ((await findUsedVariantIds(tx, [variant.id])).size > 0) {
    await retireVariants(tx, [variant.id]);
    return {
      result: 'RETIRED',
      retiredLabels: [variantLabel(product.name, variant.name, variant.unit)],
    };
  }
  const siblings = await listLiveVariantsOfProduct(tx, product.id);
  if (!siblings.some((sibling) => sibling.id !== variant.id)) {
    return { result: 'LAST_VARIANT', retiredLabels: [] };
  }
  await softDeleteVariants(tx, [variant.id], now);
  return { result: 'DELETED', retiredLabels: [] };
}

/**
 * Deletes a product sent by the owner's phone, for the product push of the synchronization
 * (ADR-004). It never throws for a business reason: every refusal is a result (C-36).
 *
 * Each live variant is handled as in {@link deleteVariantFromSync}, except that the last-variant
 * rule does not apply: the whole product goes. With no used variant the product and its variants
 * get `deleted_at = now` (`DELETED`). Otherwise the used variants become `INACTIVE`, the unused
 * ones are deleted and the product stays, so no order line loses its article or product (C-48,
 * C-45); the answer is `RETIRED` with the labels of the retired variants. An already deleted
 * product gives `ALREADY`; an unknown id or one of another organization gives `NOT_FOUND`
 * (v5.0.0-8.2.2). The refusals write nothing. Everything runs in the caller's transaction
 * (v5.0.0-2.3.3), variants locked before the product like every other writer.
 *
 * @param tx - Transaction of the synchronization.
 * @param organizationId - Organization of the session, never taken from the input.
 * @param productId - Product to delete.
 * @param now - Deletion date.
 */
export async function deleteProductFromSync(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  now: Date
): Promise<DeleteSyncResult> {
  await lockLiveVariantsOfProduct(tx, organizationId, productId);
  const product = await findProductAnyState(tx, productId);
  if (!product || product.organizationId !== organizationId) {
    return { result: 'NOT_FOUND', retiredLabels: [] };
  }
  if (product.deletedAt) return { result: 'ALREADY', retiredLabels: [] };

  const variants = await listLiveVariantsOfProduct(tx, product.id);
  const used = await findUsedVariantIds(
    tx,
    variants.map(({ id }) => id)
  );
  if (used.size === 0) {
    await softDeleteVariants(
      tx,
      variants.map(({ id }) => id),
      now
    );
    await softDeleteProduct(tx, product.id, now);
    return { result: 'DELETED', retiredLabels: [] };
  }

  const retired = variants.filter(({ id }) => used.has(id));
  await retireVariants(
    tx,
    retired.map(({ id }) => id)
  );
  await softDeleteVariants(
    tx,
    variants.filter(({ id }) => !used.has(id)).map(({ id }) => id),
    now
  );
  return {
    result: 'RETIRED',
    retiredLabels: retired.map((variant) => variantLabel(product.name, variant.name, variant.unit)),
  };
}

/** The variant a sale line or a negotiated price ends up citing (CAT-037). */
export type ResolvedVariant = {
  variantId: string;
  productId: string;
  label: string;
  /** True when this call brought a deleted variant back, off sale (C-48). */
  restored: boolean;
  /** The id asked, when another variant is answered instead; else null. */
  redirectedFrom: string | null;
};

/** Merge links followed at most this many times (C-36). */
const MAX_MERGE_LINKS = 5;

/**
 * Finds, or brings back, the variant that a sale line or a negotiated price sent by a phone
 * cites, so that no sale is lost because its article was deleted or merged since (C-48, C-36).
 *
 * A live variant answers itself. A deleted variant with a merge link answers the live variant at
 * the end of the links, followed at most 5 times; a link that reaches no live variant (a deleted
 * end, a missing or foreign row, or the 5 links used up) leaves the last variant reached to be
 * treated as deleted without a link. A deleted variant without a link is brought back off sale
 * (`INACTIVE`) with its product, unless a live variant of the same product already has its
 * simplified name and unit (C-47): that twin is answered and nothing is restored.
 *
 * Every variant, link and the product are read through the organization of the session: an
 * unknown id or another business's variant answers `null` and writes nothing (v5.0.0-8.2.2).
 * The variant and the product are locked, and the restoration is written, in the caller's
 * transaction (v5.0.0-2.3.3). It never throws for a business reason (C-36).
 *
 * @param tx - Transaction of the synchronization.
 * @param organizationId - Organization of the session, never taken from the input.
 * @param variantId - Variant cited by the line, as sent by the phone.
 * @param now - Part of the synchronization writers' signature; the dates come from the database.
 */
export async function resolveVariantForLine(
  tx: Prisma.TransactionClient,
  organizationId: string,
  variantId: string,
  now: Date
): Promise<ResolvedVariant | null> {
  void now;
  const asked = await findVariantAnyState(tx, variantId);
  if (!asked || asked.organizationId !== organizationId) return null;

  let current = asked;
  for (
    let links = 0;
    current.deletedAt && current.mergedIntoId && links < MAX_MERGE_LINKS;
    links++
  ) {
    const next = await findVariantAnyState(tx, current.mergedIntoId);
    if (!next || next.organizationId !== organizationId) break;
    current = next;
  }

  const product = await findProductAnyState(tx, current.productId);
  // The foreign key keeps the product; its absence is an unexpected state: fail closed.
  if (!product || product.organizationId !== organizationId) {
    throw new Error('Variant points to a missing or foreign product');
  }
  const redirectedFrom = (id: string) => (id === asked.id ? null : asked.id);
  const answer = (found: VariantAnyState, restored: boolean): ResolvedVariant => ({
    variantId: found.id,
    productId: found.productId,
    label: variantLabel(product.name, found.name, found.unit),
    restored,
    redirectedFrom: redirectedFrom(found.id),
  });

  if (!current.deletedAt) return answer(current, false);

  // The product is locked above, so no other writer can slip a twin in before the restoration.
  const twinId = await findLiveTwin(tx, current.productId, current.name, current.unit);
  if (twinId) {
    const twin = await findVariantAnyState(tx, twinId);
    if (!twin || twin.organizationId !== organizationId) {
      throw new Error('Live twin is missing or foreign');
    }
    return answer(twin, false);
  }
  await restoreVariantOffSale(tx, current.id);
  if (product.deletedAt) await restoreProduct(tx, product.id);
  return answer(current, true);
}

/** The only fields a phone may send for a negotiated price. */
export type PriceSyncInput = {
  id: string;
  relationshipId: string;
  variantId: string;
  price: number;
  setById: string;
};

export type PriceSyncResult = {
  result:
    | 'CREATED'
    | 'UPDATED'
    | 'UNCHANGED'
    | 'GONE'
    | 'FOREIGN'
    | 'NO_RELATIONSHIP'
    | 'NO_VARIANT'
    | 'INVALID';
  /** Field names only, never values (v5.0.0-2.2.1). Set with `INVALID`. */
  invalidFields?: string[];
};

/** Judges an id that is already known; null when the id is unknown (a creation). */
async function judgeKnownPrice(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: PriceSyncInput
): Promise<PriceSyncResult | null> {
  const existing = await findCustomerPriceAnyState(tx, input.id);
  if (!existing) return null;
  if (existing.supplierOrganizationId !== organizationId) return { result: 'FOREIGN' };
  if (existing.deletedAt) return { result: 'GONE' };
  if (existing.price === BigInt(input.price)) return { result: 'UNCHANGED' };
  await updateCustomerPriceAmount(tx, existing.id, input.price);
  return { result: 'UPDATED' };
}

/**
 * Creates or edits a negotiated price sent by the owner's phone, for the price push of the
 * synchronization (ADR-004). It never throws for a business reason: every refusal is a result and
 * writes nothing, so one price never fails the batch (C-36).
 *
 * The price is checked first (an integer of at least 1, v5.0.0-2.2.1), before any read or write.
 * An id that is already known is judged alone: another organization's price gives `FOREIGN`, a
 * deleted one `GONE`, and a live one has only its `price` rewritten (`UPDATED`, or `UNCHANGED`
 * when equal): the relationship and variant of the input are ignored, so a price never moves to
 * another customer or variant (v5.0.0-15.3.3). An unknown id needs a live relationship supplied by
 * the organization (`NO_RELATIONSHIP`) and a variant that {@link resolveVariantForLine} finds,
 * following a merge or bringing a deleted one back off sale (`NO_VARIANT`). Both are read through
 * the organization of the session (v5.0.0-8.2.2). A live price of the same pair under another id
 * is deleted first, then the new row is written: the last arrival wins and the pair keeps one
 * live price (C-11). Concurrent pushes of one pair are ordered by the relationship lock and the
 * pair lock.
 *
 * @param tx - Transaction of the synchronization.
 * @param organizationId - Organization of the session, never taken from the input.
 * @param now - Date of the deletion of a replaced price and `set_at` of a new one.
 */
export async function applyPriceFromSync(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: PriceSyncInput,
  now: Date
): Promise<PriceSyncResult> {
  if (!Number.isSafeInteger(input.price) || input.price < 1) {
    return { result: 'INVALID', invalidFields: ['price'] };
  }

  const known = await judgeKnownPrice(tx, organizationId, input);
  if (known) return known;

  const relationshipId = await lockLiveRelationshipOfSupplier(
    tx,
    organizationId,
    input.relationshipId
  );
  if (!relationshipId) return { result: 'NO_RELATIONSHIP' };
  const variant = await resolveVariantForLine(tx, organizationId, input.variantId, now);
  if (!variant) return { result: 'NO_VARIANT' };

  await lockCustomerPricePair(tx, relationshipId, variant.variantId);
  // The same id pushed twice at once: the other push may have written it while this one waited.
  const raced = await judgeKnownPrice(tx, organizationId, input);
  if (raced) return raced;
  const replaced = await findLiveCustomerPriceId(tx, relationshipId, variant.variantId);
  if (replaced) await softDeleteCustomerPrice(tx, replaced, now);
  await upsertCustomerPrice(tx, {
    id: input.id,
    relationshipId,
    productId: variant.productId,
    variantId: variant.variantId,
    price: input.price,
    setById: input.setById,
    now,
  });
  return { result: 'CREATED' };
}

/**
 * Deletes a negotiated price sent by the owner's phone, for the price push of the synchronization
 * (ADR-004). It never throws for a business reason (C-36). A live price of the organization gets
 * `deleted_at = now` (`DELETED`); a deleted one gives `ALREADY` and is not touched again; an
 * unknown id or one of another organization gives `NOT_FOUND`, never confirming that it exists
 * (v5.0.0-8.2.2).
 *
 * @param tx - Transaction of the synchronization.
 * @param organizationId - Organization of the session, never taken from the input.
 * @param priceId - Price to delete.
 * @param now - Deletion date.
 */
export async function deletePriceFromSync(
  tx: Prisma.TransactionClient,
  organizationId: string,
  priceId: string,
  now: Date
): Promise<'DELETED' | 'ALREADY' | 'NOT_FOUND'> {
  const price = await findCustomerPriceAnyState(tx, priceId);
  if (!price || price.supplierOrganizationId !== organizationId) return 'NOT_FOUND';
  if (price.deletedAt) return 'ALREADY';
  return (await softDeleteCustomerPrice(tx, price.id, now)) ? 'DELETED' : 'ALREADY';
}
