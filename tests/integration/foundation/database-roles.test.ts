import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const SCRATCH_DEFAULTS = 'public.fnd_scratch_defaults';
const SCRATCH_JOURNAL = 'public.fnd_scratch_journal';
const SCRATCH_SERVER_TIME = 'public.fnd_scratch_server_time';
const SCRATCH_CHECK = 'public.fnd_scratch_check';
const appPrisma = getAppRolePrisma();

type SqlError = {
  meta?: {
    code?: string;
    driverAdapterError?: {
      cause?: {
        code?: string;
        originalCode?: string;
      };
    };
  };
  code?: string;
};

function sqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as SqlError & { message?: string };

  // Check for Prisma adapter error structure
  if (candidate.meta?.driverAdapterError?.cause?.code) {
    return candidate.meta.driverAdapterError.cause.code;
  }
  if (candidate.meta?.driverAdapterError?.cause?.originalCode) {
    return candidate.meta.driverAdapterError.cause.originalCode;
  }

  // Direct meta.code property
  if (candidate.meta?.code) return candidate.meta.code;
  // Direct code property
  if (candidate.code) return candidate.code;
  // Extract from error message (e.g., "Code: 23514")
  if (candidate.message?.match(/Code:\s*(\w+)/)) {
    return candidate.message.match(/Code:\s*(\w+)/)?.[1];
  }
  return undefined;
}

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('application database role and server-time trigger', () => {
  it('creates a NOLOGIN role with default table privileges', async () => {
    const role = await prisma.$queryRaw<
      Array<{
        rolcanlogin: boolean;
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
      }>
    >`
      SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
      FROM pg_roles
      WHERE rolname = 'distribo_app'
    `;

    expect(role).toHaveLength(1);
    expect(role[0]).toMatchObject({
      rolcanlogin: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });

    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${SCRATCH_DEFAULTS} (
        id integer PRIMARY KEY,
        payload text NOT NULL
      )
    `);

    try {
      const tableName = SCRATCH_DEFAULTS.replace('public.', '');
      const privileges = await prisma.$queryRawUnsafe<Array<{ privilege_type: string }>>(
        `SELECT privilege_type
        FROM (VALUES
          ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
        ) AS required(privilege_type)
        WHERE has_table_privilege('distribo_app', '${tableName}', privilege_type)
        ORDER BY privilege_type`
      );

      expect(privileges.map(({ privilege_type }) => privilege_type)).toEqual([
        'DELETE',
        'INSERT',
        'SELECT',
        'UPDATE',
      ]);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE ${SCRATCH_DEFAULTS}`);
    }
  });

  it('allows inserts and selects but rejects immutable-table writes', async () => {
    // Ensure the app role has schema permissions
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO distribo_app`);

    // Drop the table first in case it exists from a previous run
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${SCRATCH_JOURNAL}`);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${SCRATCH_JOURNAL} (
        id integer PRIMARY KEY,
        payload text NOT NULL
      )
    `);
    await prisma.$executeRawUnsafe(
      `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE ${SCRATCH_JOURNAL} FROM distribo_app`
    );

    try {
      await appPrisma.$executeRawUnsafe(
        `INSERT INTO ${SCRATCH_JOURNAL} (id, payload) VALUES (1, 'entry')`
      );
      const rows = await appPrisma.$queryRawUnsafe<Array<{ id: number; payload: string }>>(
        `SELECT id, payload FROM ${SCRATCH_JOURNAL}`
      );
      expect(rows).toEqual([{ id: 1, payload: 'entry' }]);

      for (const statement of [
        `UPDATE ${SCRATCH_JOURNAL} SET payload = 'changed' WHERE id = 1`,
        `DELETE FROM ${SCRATCH_JOURNAL} WHERE id = 1`,
        `TRUNCATE TABLE ${SCRATCH_JOURNAL}`,
      ]) {
        let failed = false;
        let errorCode: string | undefined;
        try {
          await appPrisma.$executeRawUnsafe(statement);
        } catch (error) {
          failed = true;
          errorCode = sqlState(error);
        }
        expect(failed).toBe(true);
        expect(errorCode).toBe('42501');
      }

      const unchanged = await prisma.$queryRawUnsafe<Array<{ payload: string }>>(
        `SELECT payload FROM ${SCRATCH_JOURNAL}`
      );
      expect(unchanged).toEqual([{ payload: 'entry' }]);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${SCRATCH_JOURNAL}`);
    }
  });

  it('sets server_updated_at from the database clock on insert and update', async () => {
    // Drop the table first in case it exists from a previous run
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${SCRATCH_SERVER_TIME} CASCADE`);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${SCRATCH_SERVER_TIME} (
        id integer PRIMARY KEY,
        server_updated_at timestamptz NOT NULL
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fnd_scratch_server_time_trigger
      BEFORE INSERT OR UPDATE ON ${SCRATCH_SERVER_TIME}
      FOR EACH ROW EXECUTE FUNCTION set_server_updated_at()
    `);

    try {
      await appPrisma.$executeRawUnsafe(
        `INSERT INTO ${SCRATCH_SERVER_TIME} (id, server_updated_at) VALUES (1, '2001-01-01T00:00:00Z')`
      );
      const inserted = await prisma.$queryRawUnsafe<Array<{ server_updated_at: Date }>>(
        `SELECT server_updated_at FROM ${SCRATCH_SERVER_TIME}`
      );
      const insertedAt = inserted[0].server_updated_at.getTime();
      expect(Math.abs(Date.now() - insertedAt)).toBeLessThan(5_000);

      await prisma.$executeRawUnsafe('SELECT pg_sleep(0.01)');
      await appPrisma.$executeRawUnsafe(
        `UPDATE ${SCRATCH_SERVER_TIME} SET server_updated_at = '2001-01-01T00:00:00Z' WHERE id = 1`
      );
      const updated = await prisma.$queryRawUnsafe<Array<{ server_updated_at: Date }>>(
        `SELECT server_updated_at FROM ${SCRATCH_SERVER_TIME}`
      );
      expect(updated[0].server_updated_at.getTime()).toBeGreaterThan(insertedAt);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${SCRATCH_SERVER_TIME} CASCADE`);
    }
  });

  it('enforces CHECK constraints for direct SQL writes', async () => {
    // Drop the table first in case it exists from a previous run
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${SCRATCH_CHECK} CASCADE`);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE ${SCRATCH_CHECK} (
        amount integer NOT NULL CHECK (amount > 0)
      )
    `);

    try {
      let failed = false;
      let errorCode: string | undefined;
      try {
        await prisma.$executeRawUnsafe(`INSERT INTO ${SCRATCH_CHECK} (amount) VALUES (0)`);
      } catch (error) {
        failed = true;
        errorCode = sqlState(error);
      }
      expect(failed).toBe(true);
      expect(errorCode).toBe('23514');
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${SCRATCH_CHECK} CASCADE`);
    }
  });

  it('prefers MIGRATION_DATABASE_URL and falls back to DATABASE_URL', async () => {
    const originalMigrationUrl = process.env.MIGRATION_DATABASE_URL;
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const migrationUrl = 'postgresql://migration:secret@localhost:5432/migrations';
    const databaseUrl = 'postgresql://application:secret@localhost:5432/application';

    try {
      process.env.DATABASE_URL = databaseUrl;
      process.env.MIGRATION_DATABASE_URL = migrationUrl;
      vi.resetModules();
      const withMigrationUrl = await import('../../../prisma.config.ts');
      expect(withMigrationUrl.default.datasource?.url).toBe(migrationUrl);

      delete process.env.MIGRATION_DATABASE_URL;
      vi.resetModules();
      const withoutMigrationUrl = await import('../../../prisma.config.ts');
      expect(withoutMigrationUrl.default.datasource?.url).toBe(databaseUrl);
    } finally {
      process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalMigrationUrl === undefined) delete process.env.MIGRATION_DATABASE_URL;
      else process.env.MIGRATION_DATABASE_URL = originalMigrationUrl;
    }
  });
});
