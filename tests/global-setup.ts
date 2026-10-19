// Vitest globalSetup: runs once per test run, before any test worker starts
// (setupFiles run before every test file). Applies pending migrations to the
// template database a single time (Prisma's output is shown only on failure),
// then gives each worker a fresh copy of it (see tests/test-db.ts).
import { execSync } from 'node:child_process';
import { Client } from 'pg';
import {
  TEMPLATE_DATABASE,
  TEMPLATE_DATABASE_URL,
  TEST_SERVER_URL,
  TEST_WORKERS,
  workerDatabaseName,
} from './test-db';

export default async function setup(): Promise<void> {
  // `migrate deploy` is safe/idempotent (applies only pending migrations,
  // never resets or force-pushes schema state), unlike
  // `db push --accept-data-loss` which Prisma's own AI-agent safety gate
  // refuses to run non-interactively without fresh per-invocation consent.
  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEMPLATE_DATABASE_URL },
      stdio: 'pipe',
    });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    process.stderr.write(`${stdout?.toString() ?? ''}${stderr?.toString() ?? ''}`);
    throw error;
  }

  // A copy keeps the template's tables, triggers and grants; roles belong to
  // the server, so the application role works in every copy. Recreated each
  // run, so a copy never lags behind a new migration. Names are built from
  // fixed constants and an integer, never from input.
  const client = new Client({ connectionString: `${TEST_SERVER_URL}/postgres` });
  await client.connect();
  try {
    for (let poolId = 1; poolId <= TEST_WORKERS; poolId += 1) {
      const name = workerDatabaseName(poolId);
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE}`);
    }
  } finally {
    await client.end();
  }
}
