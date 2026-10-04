import type { Row } from './sync.types.js';

/** The columns every synchronized row carries (C-35). */
export type SyncedRow = { id: string; deletedAt: Date | null; serverUpdatedAt: Date };

/** Epoch milliseconds, the only timestamp format a phone receives. */
export function toEpoch(date: Date): number {
  return date.getTime();
}

/**
 * Splits rows read from one table into the `created`, `updated` and `deleted` lists of a pull.
 *
 * With `since` null every live row is `created` and nothing is `deleted`. Otherwise the rows are
 * expected to be already filtered on `server_updated_at > since`: a deleted one is listed by id, a
 * live one is `created` when its creation time is later than `since`, else `updated`.
 *
 * @param createdAt - Creation time of a row (`created_at`, or the closest column of the table).
 * @param toRow - The explicit field list sent to the phone (ASVS v5.0.0-15.3.1).
 */
export function classifyChanges<T extends SyncedRow>(
  rows: T[],
  since: Date | null,
  createdAt: (row: T) => Date,
  toRow: (row: T) => Row
): { created: Row[]; updated: Row[]; deleted: string[] } {
  const result = { created: [] as Row[], updated: [] as Row[], deleted: [] as string[] };
  for (const row of rows) {
    if (since === null) {
      if (row.deletedAt === null) result.created.push(toRow(row));
    } else if (row.deletedAt !== null) {
      if (row.serverUpdatedAt > since) result.deleted.push(row.id);
    } else if (createdAt(row) > since) {
      result.created.push(toRow(row));
    } else {
      result.updated.push(toRow(row));
    }
  }
  return result;
}
