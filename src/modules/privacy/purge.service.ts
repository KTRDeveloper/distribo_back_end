import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { logger } from '../../lib/logger.js';

/** Rows removed per statement: keeps each transaction and its locks short. */
const BATCH_SIZE = 1000;

export type PurgeCounts = Record<string, number>;

type Deleter = (client: PrismaClient, now: Date, limit: number) => Promise<number>;

/**
 * One batched delete per table (CM-35). Each statement picks at most `limit` due rows by physical
 * row id, so tables with a composite key work the same way. Every cutoff is computed by the
 * database from `now`, so months follow the calendar. Nothing here touches commercial data or
 * journals: they are kept at least 10 years.
 */
const DELETERS: Record<string, Deleter> = {
  notifications: (db, now, limit) => db.$executeRaw`
    DELETE FROM notifications WHERE ctid IN (
      SELECT ctid FROM notifications
      WHERE created_at < ${now}::timestamptz - interval '24 months'
      LIMIT ${limit})`,
  // A journal entry (REPLAY_SYNC) may still point to the archive, and the foreign key forbids
  // deleting it: such an archive stays as long as the entry does.
  sync_archives: (db, now, limit) => db.$executeRaw`
    DELETE FROM sync_archives WHERE ctid IN (
      SELECT a.ctid FROM sync_archives a
      WHERE a.received_at < ${now}::timestamptz - interval '90 days'
        AND NOT EXISTS (SELECT 1 FROM admin_actions j WHERE j.sync_archive_id = a.id)
      LIMIT ${limit})`,
  otp_challenges: (db, now, limit) => db.$executeRaw`
    DELETE FROM otp_challenges WHERE ctid IN (
      SELECT ctid FROM otp_challenges
      WHERE expires_at < ${now}::timestamptz - interval '30 days'
         OR consumed_at < ${now}::timestamptz - interval '30 days'
      LIMIT ${limit})`,
  refresh_tokens: (db, now, limit) => db.$executeRaw`
    DELETE FROM refresh_tokens WHERE ctid IN (
      SELECT ctid FROM refresh_tokens
      WHERE expires_at < ${now}::timestamptz - interval '30 days'
         OR revoked_at < ${now}::timestamptz - interval '30 days'
      LIMIT ${limit})`,
  idempotency_keys: (db, now, limit) => db.$executeRaw`
    DELETE FROM idempotency_keys WHERE ctid IN (
      SELECT ctid FROM idempotency_keys
      WHERE created_at < ${now}::timestamptz - interval '30 days'
      LIMIT ${limit})`,
};

/**
 * Deletes the data that outlived its retention period (CM-35, ASVS v5.0.0-14.2.4): notifications
 * after 24 months, sync archives after 90 days, one-time codes and refresh tokens 30 days after
 * they expired or were consumed or revoked, idempotency keys after 30 days.
 *
 * Connects with `MIGRATION_DATABASE_URL` only: the application account cannot delete immutable
 * tables (ASVS v5.0.0-13.3.2), and there is no fallback to `DATABASE_URL`, so a missing value
 * stops the purge before any delete (fail closed).
 *
 * @param now - The reference date; a parameter so tests can fix it.
 * @returns The number of rows deleted per table.
 * @throws When `MIGRATION_DATABASE_URL` is missing or a delete fails.
 */
export async function purge(now: Date): Promise<PurgeCounts> {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    throw new Error('MIGRATION_DATABASE_URL is required to run the purge');
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const counts = new Map<string, number>();
    for (const [table, deleteBatch] of Object.entries(DELETERS)) {
      let total = 0;
      for (;;) {
        const deleted = await deleteBatch(client, now, BATCH_SIZE);
        total += deleted;
        if (deleted < BATCH_SIZE) break;
      }
      counts.set(table, total);
    }
    const result: PurgeCounts = Object.fromEntries(counts);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    // Table names and counts only: no row content (ASVS v5.0.0-16.3.3, CWE-532).
    logger.info({ event: 'purge_done', counts: result, total }, 'retention purge done');
    return result;
  } finally {
    await client.$disconnect();
  }
}
