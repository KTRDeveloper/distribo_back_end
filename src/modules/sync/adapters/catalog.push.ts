import { logger } from '../../../lib/logger.js';
import {
  applyProductFromSync,
  type ProductSyncInput,
  type ProductSyncResult,
} from '../../catalog/catalog.sync-writers.js';
import type { LineOutcome, PushContext, Row, TableChange } from '../sync.types.js';

const TABLE = 'products' as const;

const outcome = (
  id: string,
  kind: LineOutcome['kind'],
  code?: string,
  message?: string
): LineOutcome => ({
  table: TABLE,
  id,
  kind,
  ...(code ? { code } : {}),
  ...(message ? { message } : {}),
});

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
    const result = await applyProductFromSync(
      ctx.tx,
      organizationId,
      readProduct(row),
      new Date()
    );
    outcomes.push(outcomeOf(id, result));
  }
  for (const id of change.deleted) {
    outcomes.push(outcome(id, 'aside', 'DELETE_PENDING', 'Product deletions are not stored yet'));
  }
  return outcomes;
}
