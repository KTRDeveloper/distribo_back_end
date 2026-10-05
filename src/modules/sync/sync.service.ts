import { logger } from '../../lib/logger.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import { findIssueRows, markDevicePulled, withPullSnapshot } from './sync.repository.js';
import { getAdapters } from './sync.registry.js';
import type { TableChange, Viewer } from './sync.types.js';

export type TableChanges = Pick<TableChange, 'created' | 'updated' | 'deleted'>;

/**
 * Collects what changed for the viewer since the phone's last pull, from every registered adapter.
 *
 * The returned `timestamp` is read before the queries: a row written while they run is sent again
 * by the next pull instead of being missed. Each adapter starts from the viewer's memberships
 * (ASVS v5.0.0-8.2.2), so nothing outside the viewer's scope is returned.
 *
 * @param viewer - Built from the database for this exchange, never from the request.
 * @param lastPulledAt - Epoch milliseconds of the previous pull, or null for a first pull.
 */
export async function pullChanges(
  viewer: Viewer,
  lastPulledAt: number | null
): Promise<{ changes: Record<string, TableChanges>; timestamp: number }> {
  const timestamp = Date.now();
  const since = lastPulledAt === null ? null : new Date(lastPulledAt);

  const changes = await withPullSnapshot(async (tx) => {
    const byTable: Record<string, TableChanges> = {};
    for (const adapter of getAdapters()) {
      byTable[adapter.table] = await adapter.pull(viewer, since, tx);
    }
    return byTable;
  });

  return { changes, timestamp };
}

/**
 * Records a pull on the viewer's device: `last_synced_at` is server time, and a full pull also sets
 * `scope_version_seen` to the person's current version, read from the database (C-34, CM-03).
 * The phone's own claim is never stored (ASVS v5.0.0-8.2.2): a claim above the real version is only
 * logged as a security event.
 *
 * @param viewer - Built from the database; `scopeVersion` is the person's current value.
 * @param phoneScopeVersion - The version the phone claims to know (`X-Scope-Version`).
 * @param full - True for a pull with an empty `last_pulled_at`.
 */
export async function recordPull(
  viewer: Viewer,
  phoneScopeVersion: number,
  full: boolean
): Promise<void> {
  if (phoneScopeVersion > viewer.scopeVersion) {
    logger.warn(
      { event: 'scope_version_claim_ahead', personId: viewer.personId, deviceId: viewer.deviceId },
      'phone claims a newer scope version than the server'
    );
  }
  await markDevicePulled(viewer.personId, viewer.deviceId, full ? viewer.scopeVersion : null);
}

export type PullResult =
  | { resync_required: true; timestamp: number; scope_version: number }
  | {
      changes: Record<string, TableChanges>;
      timestamp: number;
      scope_version: number;
    };

/**
 * One pull exchange. An incremental pull from a phone whose version is below the person's gets
 * `resync_required` and no data (CM-03): its local copy may hold rows the person lost the right to
 * see. A full pull is always answered, because it is how the phone starts again; once it completes,
 * the device records the version it now holds.
 *
 * @param viewer - Built from the database; the comparison uses its `scopeVersion` only.
 * @param lastPulledAt - Epoch milliseconds of the previous pull, or null for a full pull.
 * @param phoneScopeVersion - The version the phone claims to know.
 */
export async function pull(
  viewer: Viewer,
  lastPulledAt: number | null,
  phoneScopeVersion: number
): Promise<PullResult> {
  const full = lastPulledAt === null;
  if (!full && phoneScopeVersion < viewer.scopeVersion) {
    const timestamp = Date.now();
    await recordPull(viewer, phoneScopeVersion, false);
    return { resync_required: true, timestamp, scope_version: viewer.scopeVersion };
  }
  const result = await pullChanges(viewer, lastPulledAt);
  await recordPull(viewer, phoneScopeVersion, full);
  return { ...result, scope_version: viewer.scopeVersion };
}

/**
 * Records a processed push on the viewer's device: `last_synced_at` becomes server time. The
 * scope version the device has seen is left alone; only a full pull moves it (C-34).
 */
export async function recordPush(viewer: Viewer): Promise<void> {
  await markDevicePulled(viewer.personId, viewer.deviceId, null);
}

/** One thing to resolve: a flagged order or delivery, in the fields a person reads. */
export type IssueView = {
  table: 'orders' | 'deliveries';
  id: string;
  order_id: string;
  code: string;
  message: string;
  created_at: string;
};

/**
 * The list of things to resolve (CM-28, CM-31): the viewer's orders and deliveries that the server
 * flagged in `sync_issue`, newest first, keyset-paged. The flag lives on the record, so a corrected
 * record (empty field) is simply no longer found. `code` is the text before the first colon
 * (the whole text when there is none), `message` the text as stored; fields are listed one by one
 * (ASVS v5.0.0-15.3.1).
 *
 * @param viewer - Built from the database for this request, never from the client.
 * @param query - Page size and opaque cursor.
 * @throws HttpError 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listIssues(
  viewer: Viewer,
  query: { limit: number; cursor?: string }
): Promise<{ items: IssueView[]; next_cursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const rows = (await findIssueRows(viewer, cursor, query.limit + 1)).sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      table: row.table,
      id: row.id,
      order_id: row.orderId,
      code: row.syncIssue.split(':', 1)[0].trim(),
      message: row.syncIssue,
      created_at: row.createdAt.toISOString(),
    })),
    next_cursor:
      rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}
