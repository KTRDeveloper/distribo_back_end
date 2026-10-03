// Vitest globalSetup: runs once per test run, before any test worker starts
// (setupFiles run before every test file). Applies pending migrations to the
// test database a single time; Prisma's output is shown only on failure.
import { execSync } from 'node:child_process';

const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5434/test_db';

export default function setup(): void {
  // `migrate deploy` is safe/idempotent (applies only pending migrations,
  // never resets or force-pushes schema state), unlike
  // `db push --accept-data-loss` which Prisma's own AI-agent safety gate
  // refuses to run non-interactively without fresh per-invocation consent.
  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: 'pipe',
    });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    process.stderr.write(`${stdout?.toString() ?? ''}${stderr?.toString() ?? ''}`);
    throw error;
  }
}
