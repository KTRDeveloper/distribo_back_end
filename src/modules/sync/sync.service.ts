import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import type { Actor } from '../../types/express.js';
import type { AdminContext } from '../admin/admin.service.js';
import { recordAdminAction } from '../admin/admin.repository.js';
import { resolveMoneyPeriod } from '../finance/finance.schemas.js';
import {
  type FlaggedLine,
  findFlaggedOrders,
  findArchive,
  findArchivePage,
  findIssueRows,
  findViewerData,
  markDevicePulled,
  withPullSnapshot,
} from './sync.repository.js';
import { judgeBatch, notifyReplayed, type PushResult } from './sync.judge.js';
import {
  archivedChangesSchema,
  type ListArchivesQuery,
  syncExceptionsQuerySchema,
} from './sync.schemas.js';
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

/** One cause of flag: how many orders carry it, the money at stake and who made them. */
export type SyncExceptionItem = {
  code: string;
  count: number;
  amount: number;
  persons: string[];
};

/** Start of a code in an issue text: at the start or after " ; ", upper case, then a colon. */
const CODE_START = /(?:^| ; )([A-Z][A-Z0-9_]*): /g;
const OVER_LIMIT = /plafond dépassé de ([\d\s\u00a0\u202f]+)/;

/** Splits an order's issue text into its `CODE: message` parts (a message may hold " ; "). */
function issueParts(text: string): Array<{ code: string; message: string }> {
  const starts = [...text.matchAll(CODE_START)];
  return starts.map((match, index) => ({
    code: match[1],
    message: text.slice(match.index + match[0].length, starts[index + 1]?.index ?? text.length),
  }));
}

/** Francs lost on the lines sold below the price the server now holds, quantities in thousandths. */
function priceChangedAmount(lines: FlaggedLine[]): bigint {
  let total = 0n;
  for (const line of lines) {
    // Only lines whose reference price is stale were caught by the control.
    if (line.referencePrice === line.currentPrice) continue;
    const gap = line.currentPrice - line.unitPriceApplied;
    if (gap <= 0n) continue;
    total += (gap * BigInt(Math.round(line.quantity.mul(1000).toNumber())) + 500n) / 1000n;
  }
  return total;
}

/**
 * The owner reads the flagged operations of a period grouped by cause (SYNC-021). OWNER only: any
 * other role is refused with a logged 403 before the query is read (ASVS v5.0.0-8.2.1); the
 * organization is the actor's, never a client value. Each order counts once per code it carries.
 * `PRICE_CHANGED` adds, for the lines sold below the price the server holds now, the gap times the
 * quantity; `CREDIT_EXCEEDED` adds the amount over the limit written in the issue text; other
 * codes have amount 0. `persons` lists who entered the orders (the deliverer for a credit overrun,
 * which the delivery caused). Fields are listed one by one (ASVS v5.0.0-15.3.1). Largest amount
 * first, then code.
 *
 * @param actor - Person, organization and role from `loadActor`.
 * @param query - Raw `from` and `to` (`YYYY-MM-DD`); default the last 7 days, at most 92 days apart.
 * @throws HttpError 403 `FORBIDDEN` below OWNER; 400 `VALIDATION_ERROR` for a bad or too long period.
 */
export async function syncExceptions(
  actor: Actor,
  query: { from?: string; to?: string }
): Promise<{ items: SyncExceptionItem[] }> {
  if (actor.role !== 'OWNER') {
    logger.warn(
      {
        event: 'permission_refused',
        personId: actor.personId,
        action: 'read',
        subjectType: 'SyncExceptions',
      },
      'Permission refused'
    );
    throw httpError(403, 'FORBIDDEN', 'Permission denied');
  }
  const period = resolveMoneyPeriod(syncExceptionsQuerySchema.parse(query));
  const orders = await findFlaggedOrders(actor.organizationId, period);

  const groups = new Map<string, { count: number; amount: bigint; persons: Set<string> }>();
  for (const order of orders) {
    const seen = new Set<string>();
    for (const part of issueParts(order.syncIssue)) {
      if (seen.has(part.code)) continue;
      seen.add(part.code);
      const group = groups.get(part.code) ?? { count: 0, amount: 0n, persons: new Set() };
      group.count += 1;
      if (part.code === 'PRICE_CHANGED') {
        group.amount += priceChangedAmount(order.lines);
      } else if (part.code === 'CREDIT_EXCEEDED') {
        const digits = OVER_LIMIT.exec(part.message)?.[1].replace(/\D/g, '');
        if (digits) group.amount += BigInt(digits);
      }
      group.persons.add(
        part.code === 'CREDIT_EXCEEDED'
          ? (order.deliveredById ?? order.enteredById)
          : order.enteredById
      );
      groups.set(part.code, group);
    }
  }

  const items = [...groups.entries()].map(([code, group]) => ({
    code,
    count: group.count,
    amount: Number(group.amount),
    persons: [...group.persons].sort(),
  }));
  items.sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code));
  return { items };
}

/**
 * A super administrator replays an archived batch after the cause of a refusal is fixed (SYNC-022,
 * CM-32). SUPER_ADMIN only: any other role is refused with a logged 403 before the archive is read
 * (ASVS v5.0.0-8.2.1). The batch is judged as if sent by its author with their current rights,
 * never the administrator's (the author's viewer is rebuilt from the database, with no device
 * grace: `scope_version_seen` is left out). Only the version, clock and conflict checks of a push
 * are skipped. The REPLAY_SYNC journal row, the applied lines and the `sync.replayed` notifications
 * to the author and the owners are one transaction: when the journal insert fails, nothing is
 * applied (ASVS v5.0.0-2.3.3, v5.0.0-16.3.1). A batch may be replayed again; lines are idempotent by
 * record id, and each replay is journaled. The author's device `last_synced_at` is not touched.
 *
 * @param admin - From `adminAuthMiddleware`.
 * @param archiveId - The archive to replay.
 * @param input - The mandatory reason kept in the journal.
 * @throws HttpError 403 `FORBIDDEN` below SUPER_ADMIN; 404 `NOT_FOUND` for an unknown archive.
 * @throws Error when the stored batch no longer passes the push schema (unexpected: 500).
 */
export async function replayArchive(
  admin: AdminContext,
  archiveId: string,
  input: { reason: string }
): Promise<PushResult> {
  if (admin.role !== 'SUPER_ADMIN') {
    logger.warn(
      { event: 'admin_access_denied', personId: admin.personId, action: 'replay_sync' },
      'Permission refused'
    );
    throw httpError(403, 'FORBIDDEN', 'Not allowed');
  }
  const archive = await findArchive(archiveId);
  if (!archive) throw httpError(404, 'NOT_FOUND', 'Not found');
  const changes = archivedChangesSchema.safeParse(archive.changes);
  if (!changes.success) throw new Error('Archived batch does not match the push schema');
  const author = await findViewerData(archive.personId);
  if (!author) throw httpError(404, 'NOT_FOUND', 'Not found');

  const viewer: Viewer = {
    personId: archive.personId,
    deviceId: archive.deviceId,
    memberships: author.memberships.map((m) => ({
      organizationId: m.organizationId,
      role: m.role,
      status: 'ACTIVE' as const,
    })),
    scopeVersion: author.scopeVersion,
    isOnline: false,
  };
  const result = await judgeBatch(viewer, changes.data, {
    replay: true,
    beforeApply: async (tx) => {
      await recordAdminAction(tx, {
        administratorId: admin.administratorId,
        action: 'REPLAY_SYNC',
        targetPersonId: archive.personId,
        syncArchiveId: archive.id,
        reason: input.reason,
      });
    },
    afterApply: (tx) => notifyReplayed(tx, archive.personId, archive.receivedAt),
  });
  logger.warn(
    {
      event: 'sync_archive_replayed',
      administratorId: admin.administratorId,
      archiveId: archive.id,
      personId: archive.personId,
      accepted: result.accepted,
      rejected: result.rejected.length,
    },
    'archived batch replayed'
  );
  return result;
}

/** Rows created, updated and deleted in one table of an archived batch. */
export type RowCounts = { created: number; updated: number; deleted: number };

/** An archived batch as the list shows it: no content, only how many rows each table carried. */
export type ArchiveSummary = {
  id: string;
  person_id: string;
  device_id: string;
  received_at: string;
  row_counts: Record<string, RowCounts>;
};

/** An opened archived batch: the summary and the stored `changes`. */
export type ArchiveDetail = ArchiveSummary & { changes: unknown };

const arrayLength = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/** Counts created, updated and deleted rows per table; a malformed stored value counts as zero. */
function countRows(changes: unknown): Record<string, RowCounts> {
  const counts: Record<string, RowCounts> = {};
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) return counts;
  for (const [table, change] of Object.entries(changes)) {
    const part = (typeof change === 'object' && change !== null ? change : {}) as Record<
      string,
      unknown
    >;
    counts[table] = {
      created: arrayLength(part.created),
      updated: arrayLength(part.updated),
      deleted: arrayLength(part.deleted),
    };
  }
  return counts;
}

function summarize(archive: {
  id: string;
  personId: string;
  deviceId: string;
  receivedAt: Date;
  changes: unknown;
}): ArchiveSummary {
  return {
    id: archive.id,
    person_id: archive.personId,
    device_id: archive.deviceId,
    received_at: archive.receivedAt.toISOString(),
    row_counts: countRows(archive.changes),
  };
}

/**
 * Lists archived batches for any administrator (SYNC-023): newest first, optionally of one person
 * and within a period (`from` and `to` days both included, UTC). Only the summary is returned, never
 * the stored `changes`, which are sensitive (ASVS v5.0.0-14.2.4). The caller's administrator role is
 * checked by the route before this runs.
 *
 * @param query - Validated query; `cursor` is the opaque value of a previous page.
 * @throws HttpError 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listArchives(
  query: ListArchivesQuery
): Promise<{ items: ArchiveSummary[]; next_cursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const rows = await findArchivePage({
    personId: query.person_id,
    from: query.from ? resolveMoneyPeriod({ from: query.from, to: query.from }).from : undefined,
    toExclusive: query.to ? resolveMoneyPeriod({ to: query.to }).toExclusive : undefined,
    cursor,
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(summarize),
    next_cursor:
      rows.length > query.limit && last
        ? encodeCursor({ createdAt: last.receivedAt, id: last.id })
        : null,
  };
}

/**
 * Opens one archived batch with its `changes` (SYNC-023). The route restricts it to SUPER_ADMIN:
 * full batches are sensitive (ASVS v5.0.0-8.2.1, v5.0.0-14.2.4).
 *
 * @param archiveId - The archive to open.
 * @throws HttpError 404 `NOT_FOUND` for an unknown archive.
 */
export async function getArchive(archiveId: string): Promise<ArchiveDetail> {
  const archive = await findArchive(archiveId);
  if (!archive) throw httpError(404, 'NOT_FOUND', 'Not found');
  return { ...summarize(archive), changes: archive.changes };
}
