import type { Prisma } from '@prisma/client';
import { configService } from '../../lib/config-service.js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { getAdapters } from './sync.registry.js';
import { archiveBatch, withPushTransaction } from './sync.repository.js';
import type { PushBatch } from './sync.schemas.js';
import { recordPush } from './sync.service.js';
import { SYNC_TABLES, type LineOutcome, type SyncTable, type Viewer } from './sync.types.js';

/** A phone clock further than this from server time makes the app ask for automatic time (CM-31). */
const CLOCK_SKEW_LIMIT_MS = 5 * 60_000;

/** The answer of a processed push. */
export type PushResponse = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
  clock_skew: boolean;
  resync_required: boolean;
};

export type PushInput = {
  lastPulledAt: number;
  changes: PushBatch;
  appVersion: string;
  clientTime?: number;
};

/** Compares dotted numbers part by part, missing parts counting as 0: negative, 0 or positive. */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const DOTTED_NUMBERS = /^\d{1,6}(\.\d{1,6}){0,3}$/;

/**
 * Refuses an app older than the platform minimum (remote-config `sync` / `min_app_version`).
 * No minimum configured means every version passes; a phone that sends no version when a minimum
 * exists is refused (fail closed).
 *
 * @throws HttpError 426 `APP_UPDATE_REQUIRED` below the minimum.
 * @throws Error when the configured minimum is not dotted numbers: a platform misconfiguration is
 * an unexpected state, answered 500 by the global handler.
 */
async function assertAppVersion(viewer: Viewer, appVersion: string): Promise<void> {
  const configured = await configService.get<string | number>('sync', 'min_app_version');
  if (configured === null || configured === undefined || configured === '') return;
  const minimum = String(configured);
  if (!DOTTED_NUMBERS.test(minimum)) {
    throw new Error('sync.min_app_version is not a dotted version');
  }
  if (appVersion === '' || compareVersions(appVersion, minimum) < 0) {
    logger.warn(
      { event: 'sync_app_version_refused', personId: viewer.personId, deviceId: viewer.deviceId },
      'push refused: app version below the platform minimum'
    );
    throw httpError(426, 'APP_UPDATE_REQUIRED', 'Update the app to keep syncing');
  }
}

/**
 * Throws 409 when a pushed `updated` row was changed on the server after the phone's last pull.
 * The comparison runs on what the phone could have pulled (the viewer's own scope), so the answer
 * never confirms that a row outside the viewer's scope exists (ASVS v5.0.0-8.2.2).
 *
 * @throws HttpError 409 `SYNC_CONFLICT`: the phone pulls, then sends again.
 */
async function assertNoConflict(
  viewer: Viewer,
  changes: PushBatch,
  lastPulledAt: number,
  tx: Prisma.TransactionClient
): Promise<void> {
  const since = new Date(lastPulledAt);
  for (const adapter of getAdapters()) {
    const pushed = changes[adapter.table]?.updated ?? [];
    if (pushed.length === 0) continue;
    const ids = new Set(pushed.map((row) => row['id']).filter((id) => typeof id === 'string'));
    const newer = await adapter.pull(viewer, since, tx);
    const changedOnServer = [...newer.created, ...newer.updated].map((row) => row['id']);
    if (
      [...changedOnServer, ...newer.deleted].some((id) => typeof id === 'string' && ids.has(id))
    ) {
      throw httpError(409, 'SYNC_CONFLICT', 'Pull the latest changes, then send again');
    }
  }
}

function countRows(table: { created: unknown[]; updated: unknown[]; deleted: unknown[] }): number {
  return table.created.length + table.updated.length + table.deleted.length;
}

/**
 * Hands each table of the batch to its adapter inside the transaction and tallies the outcomes.
 * A table the registry does not know is set aside, row by row, and never stops the rest (C-36).
 * Tables run in the order of the sync tables, parents before children.
 * SYNC-010 replaces this loop with `judgeBatch` (scope, field rights, computed fields).
 */
async function applyBatch(
  viewer: Viewer,
  changes: PushBatch,
  tx: Prisma.TransactionClient
): Promise<Omit<PushResponse, 'clock_skew'>> {
  const adapters = new Map(getAdapters().map((a) => [a.table, a]));
  const outcomes: LineOutcome[] = [];
  let aside = 0;

  for (const [name, change] of Object.entries(changes)) {
    if (!adapters.has(name as SyncTable)) aside += countRows(change);
  }
  for (const table of SYNC_TABLES) {
    const change = changes[table];
    const adapter = adapters.get(table);
    if (!change || !adapter) continue;
    outcomes.push(...(await adapter.push({ viewer, tx }, { table, ...change })));
  }

  const rejected: PushResponse['rejected'] = [];
  let accepted = 0;
  for (const outcome of outcomes) {
    if (outcome.kind === 'accepted' || outcome.kind === 'issue') accepted += 1;
    else if (outcome.kind === 'aside') aside += 1;
    else {
      rejected.push({
        table: outcome.table,
        id: outcome.id,
        code: outcome.code ?? 'REFUSED',
        message: outcome.message ?? 'Line refused',
      });
    }
  }
  return { accepted, rejected, aside, resync_required: false };
}

/**
 * One push exchange: the batch is archived as received first, in its own committed write, so a
 * refusal or a failure later loses nothing (ASVS v5.0.0-16.3.1, CM-28). Then, in order: the app
 * version check (426), the clock check (reported, never refused), the conflict check (409, nothing
 * applied) and the judging of the batch in one transaction (ASVS v5.0.0-2.3.3); last, the device's
 * `last_synced_at` is set.
 *
 * @param viewer - Built from the database for this exchange.
 * @param input - Already validated: `lastPulledAt` is not in the future, `clientTime` is epoch ms.
 * @throws HttpError 426 `APP_UPDATE_REQUIRED`, 409 `SYNC_CONFLICT`.
 */
export async function pushChanges(viewer: Viewer, input: PushInput): Promise<PushResponse> {
  await archiveBatch(viewer.personId, viewer.deviceId, input.changes as Prisma.InputJsonValue);
  await assertAppVersion(viewer, input.appVersion);

  const clockSkew =
    input.clientTime !== undefined && Math.abs(input.clientTime - Date.now()) > CLOCK_SKEW_LIMIT_MS;

  const result = await withPushTransaction(async (tx) => {
    await assertNoConflict(viewer, input.changes, input.lastPulledAt, tx);
    return applyBatch(viewer, input.changes, tx);
  });

  await recordPush(viewer);
  return { ...result, clock_skew: clockSkew };
}
