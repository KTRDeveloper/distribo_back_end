import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../../src/shared/ids';
import { clearDatabase as clearDatabaseFromHelpers, seedAccount } from '../../helpers/database';
import { clearDatabase, prisma } from '../../setup';

// The tables the cleanup covers: every table of public except Prisma's migration history.
function rowCounts() {
  return prisma.$queryRaw<Array<{ table_name: string; row_count: number }>>`
    SELECT tablename AS table_name,
           (xpath('/row/n/text()',
             query_to_xml(format('SELECT count(*) AS n FROM public.%I', tablename), false, true, '')
           ))[1]::text::int AS row_count
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
}

function tableFiles() {
  return prisma.$queryRaw<Array<{ table_name: string; file_node: string | null }>>`
    SELECT tablename AS table_name,
           pg_relation_filenode(format('public.%I', tablename)::regclass)::text AS file_node
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('clearDatabase', () => {
  it('empties every table, an organization with its active owner included', async () => {
    const owner = await seedAccount({
      email: 'owner@test.local',
      password: 'fixture-password',
      name: 'Owner Fixture',
    });
    await prisma.organization.create({
      data: {
        id: newId(),
        name: 'Fixture Org',
        collaborations: {
          create: {
            id: newId(),
            personId: owner.id,
            role: 'OWNER',
            status: 'ACTIVE',
            acceptedAt: new Date(),
          },
        },
      },
    });
    const filled = (await rowCounts()).filter((t) => t.row_count > 0).map((t) => t.table_name);
    expect(filled).toEqual(expect.arrayContaining(['collaborations', 'organizations', 'people']));

    await clearDatabase();

    expect((await rowCounts()).filter((t) => t.row_count > 0)).toEqual([]);
  });

  // Rewriting every table's files before each test is what made the suite slow.
  it.each([
    ['tests/setup.ts', clearDatabase],
    ['tests/helpers/database.ts', clearDatabaseFromHelpers],
  ])('%s empties the tables without rewriting their files', async (_source, clear) => {
    const before = await tableFiles();

    await clear();

    expect(await tableFiles()).toEqual(before);
  });

  it('leaves foreign keys and triggers on for the statements that follow', async () => {
    await clearDatabase();

    const [setting] = await prisma.$queryRaw<Array<{ role: string }>>`
      SELECT current_setting('session_replication_role') AS role
    `;
    expect(setting?.role).toBe('origin');
    const owner = await seedAccount({
      email: 'owner@test.local',
      password: 'fixture-password',
      name: 'Owner Fixture',
    });
    // An owner's collaboration in an organization that does not exist.
    await expect(
      prisma.collaboration.create({
        data: {
          id: newId(),
          organizationId: newId(),
          personId: owner.id,
          role: 'OWNER',
          status: 'ACTIVE',
          acceptedAt: new Date(),
        },
      })
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('refuses a database other than the test database', async () => {
    vi.stubEnv('DATABASE_URL', `${process.env.DATABASE_URL}_other`);
    await expect(clearDatabase()).rejects.toThrow('Refusing to clear a non-test database');

    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'production');
    await expect(clearDatabase()).rejects.toThrow('Refusing to clear a non-test database');
  });
});
