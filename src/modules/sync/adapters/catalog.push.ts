import { logger } from '../../../lib/logger.js';
import {
  applyProductFromSync,
  applyVariantFromSync,
  type ProductSyncInput,
  type ProductSyncResult,
  type VariantSyncInput,
  type VariantSyncResult,
} from '../../catalog/catalog.sync-writers.js';
import type { LineOutcome, PushContext, Row, TableChange } from '../sync.types.js';

const TABLE = 'products' as const;
const VARIANTS_TABLE = 'product_variants' as const;

const outcomeFor =
  (table: LineOutcome['table']) =>
  (
    id: string,
    kind: LineOutcome['kind'],
    code?: string,
    message?: string,
    mergedInto?: string
  ): LineOutcome => ({
    table,
    id,
    kind,
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(mergedInto ? { mergedInto } : {}),
  });

const outcome = outcomeFor(TABLE);
const variantOutcome = outcomeFor(VARIANTS_TABLE);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Stands for a product id that is not a UUID: no product has it, so a new variant is `NO_PRODUCT`. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Reads the only four fields a phone may send for a product (ASVS v5.0.0-15.3.3). Values are
 * handed over as sent: the writer checks type and length before any write (v5.0.0-2.2.1).
 */
function readProduct(row: Row): ProductSyncInput {
  return {
    id: String(row['id']),
    name: row['name'] as string,
    description: (row['description'] ?? null) as string | null,
    category: (row['category'] ?? null) as string | null,
  };
}

/** Maps a writer result to the line's outcome; field names only, never values. */
function outcomeOf(id: string, result: ProductSyncResult): LineOutcome {
  switch (result.result) {
    case 'CREATED':
    case 'UPDATED':
    case 'UNCHANGED':
      return outcome(id, 'accepted');
    case 'INVALID':
      return outcome(
        id,
        'aside',
        'INVALID',
        `These fields of this product cannot be stored: ${(result.invalidFields ?? []).join(', ')}`
      );
    case 'GONE':
      return outcome(id, 'aside', 'GONE', 'This product was deleted');
    case 'FOREIGN':
      logger.warn(
        { event: 'sync_line_forbidden', table: TABLE, recordId: id, code: 'OUT_OF_SCOPE' },
        'line refused'
      );
      return outcome(id, 'forbidden', 'OUT_OF_SCOPE', 'This line is outside your scope');
  }
}

/**
 * Push side of `products` (SYNC-031): the owner's phone creates and edits products. Each created
 * or updated row goes through `applyProductFromSync` in the batch's transaction, with the
 * organization the judge stamped from the scope, never one the phone chose (ASVS v5.0.0-8.2.1).
 * Only `name`, `description` and `category` are read: the pause, the photos, the unit and the
 * price belong to the server (C-46). A refusal is a line outcome, so one product never fails the
 * batch (C-36). Deletions arrive with SYNC-033: a deleted line is set aside until then.
 *
 * @param ctx - Viewer and the batch's transaction; lines arrive already judged.
 * @param change - Judged lines of the table.
 */
export async function pushProducts(ctx: PushContext, change: TableChange): Promise<LineOutcome[]> {
  const outcomes: LineOutcome[] = [];
  for (const row of [...change.created, ...change.updated]) {
    const organizationId = row['organization_id'];
    const id = String(row['id']);
    // The judge stamps it on every line; a missing one is an unexpected state: fail closed.
    if (typeof organizationId !== 'string') {
      outcomes.push(outcome(id, 'forbidden', 'OUT_OF_SCOPE', 'This line is outside your scope'));
      continue;
    }
    const result = await applyProductFromSync(ctx.tx, organizationId, readProduct(row), new Date());
    outcomes.push(outcomeOf(id, result));
  }
  for (const id of change.deleted) {
    outcomes.push(outcome(id, 'aside', 'DELETE_PENDING', 'Product deletions are not stored yet'));
  }
  return outcomes;
}

/**
 * Reads the only five fields a phone may send for a variant, and the product id of a new one
 * (ASVS v5.0.0-15.3.3). The merge link, the price date and the photos have no way in. Values are
 * handed over as sent: the writer checks every type and range before any write (v5.0.0-2.2.1).
 * A product id that is not a UUID is replaced by one no product has, so the database never sees it.
 */
function readVariant(row: Row): VariantSyncInput {
  const productId = row['product_id'];
  return {
    id: String(row['id']),
    productId: typeof productId === 'string' && UUID.test(productId) ? productId : NIL_UUID,
    name: (row['name'] ?? null) as string | null,
    unit: row['unit'] as string,
    price: row['price'] as number,
    minOrderQuantity: (row['min_order_quantity'] ?? null) as string | null,
    status: row['status'] as 'ACTIVE' | 'INACTIVE',
  };
}

/** Maps a writer result to the line's outcome; field names and labels only, never values. */
function variantOutcomeOf(id: string, result: VariantSyncResult): LineOutcome {
  switch (result.result) {
    case 'CREATED':
    case 'UPDATED':
    case 'UNCHANGED':
      return variantOutcome(id, 'accepted');
    case 'MERGED':
      return variantOutcome(
        id,
        'issue',
        'MERGED',
        `${result.label ?? ''} ajouté deux fois : variantes réunies`,
        result.mergedInto
      );
    case 'COLLISION':
      return variantOutcome(
        id,
        'aside',
        'VARIANT_EXISTS',
        'Another variant of this product has the same name and unit'
      );
    case 'NO_PRODUCT':
      return variantOutcome(
        id,
        'aside',
        'NO_PRODUCT',
        'The product of this variant does not exist'
      );
    case 'GONE':
      return variantOutcome(id, 'aside', 'GONE', 'This variant was deleted');
    case 'INVALID':
      return variantOutcome(
        id,
        'aside',
        'INVALID',
        `These fields of this variant cannot be stored: ${(result.invalidFields ?? []).join(', ')}`
      );
    case 'FOREIGN':
      logger.warn(
        { event: 'sync_line_forbidden', table: VARIANTS_TABLE, recordId: id, code: 'OUT_OF_SCOPE' },
        'line refused'
      );
      return variantOutcome(id, 'forbidden', 'OUT_OF_SCOPE', 'This line is outside your scope');
  }
}

/**
 * Push side of `product_variants` (SYNC-032): the owner's phone creates and edits variants. Each
 * created or updated row goes through `applyVariantFromSync` in the batch's transaction, with the
 * organization the judge stamped from the product's owner, never one the phone chose (ASVS
 * v5.0.0-8.2.1); the writer finds the product and any existing variant through it. A variant
 * created twice is reported as an `issue` `MERGED` pointing at the first one (C-47). A refusal is
 * a line outcome, so one variant never fails the batch (C-36). Deletions arrive with SYNC-033: a
 * deleted line is set aside until then.
 *
 * @param ctx - Viewer and the batch's transaction; lines arrive already judged.
 * @param change - Judged lines of the table.
 */
export async function pushVariants(ctx: PushContext, change: TableChange): Promise<LineOutcome[]> {
  const outcomes: LineOutcome[] = [];
  for (const row of [...change.created, ...change.updated]) {
    const organizationId = row['organization_id'];
    const id = String(row['id']);
    // The judge stamps it on every line; a missing one is an unexpected state: fail closed.
    if (typeof organizationId !== 'string') {
      outcomes.push(
        variantOutcome(id, 'forbidden', 'OUT_OF_SCOPE', 'This line is outside your scope')
      );
      continue;
    }
    const result = await applyVariantFromSync(ctx.tx, organizationId, readVariant(row), new Date());
    outcomes.push(variantOutcomeOf(id, result));
  }
  for (const id of change.deleted) {
    outcomes.push(
      variantOutcome(id, 'aside', 'DELETE_PENDING', 'Variant deletions are not stored yet')
    );
  }
  return outcomes;
}
