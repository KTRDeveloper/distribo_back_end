// Test databases. Test files run in parallel, one Vitest worker each at a
// time, and every worker owns a database: `test_db_w<pool id>`, a copy of
// `test_db` made by tests/global-setup.ts at the start of each run. Each
// test still empties its own worker's database, so parallel files never see
// each other's rows. `test_db` itself only holds the migrated, empty schema.
import { availableParallelism } from 'node:os';

export const TEST_SERVER_URL = 'postgresql://postgres:postgres@localhost:5434';
export const TEMPLATE_DATABASE = 'test_db';
export const TEMPLATE_DATABASE_URL = `${TEST_SERVER_URL}/${TEMPLATE_DATABASE}`;

/**
 * Parallel test files; TEST_WORKERS overrides it, CI runners get their core count.
 * Measured on 3,174 tests: 449 s in sequence, 78 s with 6, 62 s with 8, 49 s with 12
 * workers; 8 leaves memory for the rest of a developer machine.
 */
export const TEST_WORKERS = Number(
  process.env.TEST_WORKERS ?? Math.min(8, availableParallelism())
);

/** Name of the database owned by a Vitest worker (pool id 1..TEST_WORKERS). */
export function workerDatabaseName(poolId: string | number): string {
  return `${TEMPLATE_DATABASE}_w${poolId}`;
}

/**
 * URL of the database owned by the current Vitest worker.
 * @throws when Vitest gave no pool id: failing closed keeps a test from
 * emptying a database another worker is using.
 */
export function workerDatabaseUrl(poolId = process.env.VITEST_POOL_ID): string {
  if (!poolId || !/^\d+$/.test(poolId)) {
    throw new Error('VITEST_POOL_ID is missing: tests must run under Vitest');
  }
  return `${TEST_SERVER_URL}/${workerDatabaseName(poolId)}`;
}

/** True only for a worker database on the local test server. */
export function isWorkerDatabaseUrl(url: string | undefined): boolean {
  return url !== undefined && new RegExp(`^${TEST_SERVER_URL}/${TEMPLATE_DATABASE}_w\\d+$`).test(url);
}
