import { logger } from '../../../lib/logger.js';
import {
  applyPriceFromSync,
  deletePriceFromSync,
  type PriceSyncInput,
  type PriceSyncResult,
} from '../../catalog/catalog.sync-writers.js';
import type { LineOutcome, PushContext, Row, TableChange } from '../sync.types.js';

const TABLE = 'customer_prices' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Stands for an id that is not a UUID: no row has it, so the writer answers "not found". */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const outcome = (id: string, kind: LineOutcome['kind'], code?: string, message?: string) => ({
  table: TABLE,
  id,
  kind,
  ...(code ? { code } : {}),
  ...(message ? { message } : {}),
});

const outOfScope = (id: string): LineOutcome => {
  logger.warn(
    { event: 'sync_line_forbidden', table: TABLE, recordId: id, code: 'OUT_OF_SCOPE' },
    'line refused'
  );
  return outcome(id, 'forbidden', 'OUT_OF_SCOPE', 'This line is outside your scope');
};

/** The organizations the viewer owns: the only ones a price push may write for (ASVS v5.0.0-8.2.1). */
function ownedOrganizations(ctx: PushContext): string[] {
  return ctx.viewer.memberships
    .filter((m) => m.role === 'OWNER' && m.status === 'ACTIVE')
    .map((m) => m.organizationId);
}

/** A reference the phone sent, kept only when it can be a UUID so the database never sees junk. */
const uuidOrNil = (value: unknown): string =>
  typeof value === 'string' && UUID.test(value) ? value : NIL_UUID;

/** Maps a writer result to the line's outcome; codes and field names only, never values. */
function outcomeOf(id: string, result: PriceSyncResult): LineOutcome {
  switch (result.result) {
    case 'CREATED':
    case 'UPDATED':
    case 'UNCHANGED':
      return outcome(id, 'accepted');
    case 'NO_RELATIONSHIP':
      return outcome(id, 'aside', 'NO_RELATIONSHIP', 'The customer of this price does not exist');
    case 'NO_VARIANT':
      return outcome(id, 'aside', 'NO_VARIANT', 'The variant of this price does not exist');
    case 'GONE':
      return outcome(id, 'aside', 'GONE', 'This price was deleted');
    case 'INVALID':
      return outcome(
        id,
        'aside',
        'INVALID',
        `These fields of this price cannot be stored: ${(result.invalidFields ?? []).join(', ')}`
      );
    case 'FOREIGN':
      return outOfScope(id);
  }
}

type Target = { organizationId: string; relationshipId: string; variantId: string };

/**
 * Where a written price belongs, read from the server's rows only: a new price from the relationship
 * it names, an existing one from the stored price. The result is an organization the viewer owns, or
 * a line outcome when there is none (ASVS v5.0.0-8.2.1, v5.0.0-15.3.3).
 */
async function targetOf(
  ctx: PushContext,
  row: Row,
  listed: 'created' | 'updated'
): Promise<Target | LineOutcome> {
  const id = String(row['id']);
  const owned = ownedOrganizations(ctx);
  if (listed === 'updated') {
    const stored = await ctx.tx.customerPrice.findUnique({
      where: { id },
      select: {
        customerRelationshipId: true,
        productVariantId: true,
        customerRelationship: { select: { supplierOrganizationId: true } },
      },
    });
    if (!stored) return outcome(id, 'aside', 'NOT_FOUND', 'This record does not exist');
    const organizationId = stored.customerRelationship.supplierOrganizationId;
    if (organizationId === null || !owned.includes(organizationId)) return outOfScope(id);
    return {
      organizationId,
      relationshipId: stored.customerRelationshipId,
      variantId: stored.productVariantId ?? NIL_UUID,
    };
  }
  const relationshipId = uuidOrNil(row['customer_relationship_id']);
  const relationship = await ctx.tx.customerRelationship.findUnique({
    where: { id: relationshipId },
    select: { supplierOrganizationId: true },
  });
  if (!relationship) {
    return outcome(id, 'aside', 'NO_RELATIONSHIP', 'The customer of this price does not exist');
  }
  const organizationId = relationship.supplierOrganizationId;
  if (organizationId === null || !owned.includes(organizationId)) return outOfScope(id);
  return { organizationId, relationshipId, variantId: uuidOrNil(row['product_variant_id']) };
}

/** Writes one created or updated price in the batch's transaction. */
async function writeOne(
  ctx: PushContext,
  row: Row,
  listed: 'created' | 'updated',
  now: Date
): Promise<LineOutcome> {
  const id = String(row['id']);
  const target = await targetOf(ctx, row, listed);
  if ('kind' in target) return target;
  const input: PriceSyncInput = {
    id,
    relationshipId: target.relationshipId,
    variantId: target.variantId,
    price: row['price'] as number,
    // The author is the session's person, never a value of the row (ASVS v5.0.0-15.3.3).
    setById: ctx.viewer.personId,
  };
  return outcomeOf(id, await applyPriceFromSync(ctx.tx, target.organizationId, input, now));
}

/**
 * Deletes a price in the first organization the viewer owns that holds it. A deleted line holds
 * only an id: the writer is given each owned organization, never one the phone named, and answers
 * `NOT_FOUND` for the ones that do not hold the price (ASVS v5.0.0-8.2.1).
 */
async function deleteOne(ctx: PushContext, id: string, now: Date): Promise<LineOutcome> {
  const priceId = uuidOrNil(id);
  for (const organizationId of ownedOrganizations(ctx)) {
    const result = await deletePriceFromSync(ctx.tx, organizationId, priceId, now);
    if (result !== 'NOT_FOUND') return outcome(id, 'accepted');
  }
  return outcome(id, 'aside', 'NOT_FOUND', 'This record does not exist');
}

/**
 * Push side of `customer_prices` (SYNC-034): the owner's phone sets, changes and removes negotiated
 * prices. Each created or updated row goes through `applyPriceFromSync` in the batch's transaction,
 * with the organization found from the relationship or the stored price and checked against the
 * viewer's owned organizations, never one the phone chose; the author is the viewer (ASVS
 * v5.0.0-8.2.1, v5.0.0-15.3.3). A deleted id goes through `deletePriceFromSync` after the others.
 * A refusal is a line outcome, so one price never fails the batch (C-36); the same pair entered on
 * two phones keeps the later price (C-11).
 *
 * @param ctx - Viewer and the batch's transaction; lines arrive already judged.
 * @param change - Judged lines of the table.
 */
export async function pushPrices(ctx: PushContext, change: TableChange): Promise<LineOutcome[]> {
  const outcomes: LineOutcome[] = [];
  const now = new Date();
  for (const row of change.created) outcomes.push(await writeOne(ctx, row, 'created', now));
  for (const row of change.updated) outcomes.push(await writeOne(ctx, row, 'updated', now));
  for (const id of change.deleted) outcomes.push(await deleteOne(ctx, id, now));
  return outcomes;
}
