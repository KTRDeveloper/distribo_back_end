import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../setup.js';

const OWNER = '0199c043-0000-7000-8000-000000000001';
const MEMBER = '0199c043-0000-7000-8000-000000000002';
const GUEST = '0199c043-0000-7000-8000-000000000003';
const ORG = '0199c043-0000-7000-8000-000000000004';
const LIVE_A = '0199c043-0000-7000-8000-000000000011';
const LIVE_B = '0199c043-0000-7000-8000-000000000012';
const DELETED = '0199c043-0000-7000-8000-000000000013';
const REG = new Date('2026-01-01T00:00:00.000Z');

type ScratchRow = { id: string; flagged: boolean; deleted?: boolean };

/** Runs the migration's actual preflight against isolated legacy rows, never production tables. */
async function preflight(rows: ScratchRow[], drop = false) {
  const folder = readdirSync('prisma/migrations').find((name) =>
    name.endsWith('_org_043_drop_collaboration_public_contact')
  );
  if (!folder) throw new Error('ORG-043 migration missing');
  const sql = readFileSync(`prisma/migrations/${folder}/migration.sql`, 'utf8');
  const block = sql.match(/DO \$\$[\s\S]*?\$\$;/)?.[0];
  if (!block) throw new Error('ORG-043 preflight missing');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE collaborations (
      id uuid, is_public_contact boolean, deleted_at timestamptz
    ) ON COMMIT DROP`);
    await tx.$executeRawUnsafe('SET LOCAL search_path = pg_temp, public');
    for (const row of rows) {
      await tx.$executeRaw`INSERT INTO collaborations VALUES (
        ${row.id}::uuid, ${row.flagged}, ${row.deleted ? REG : null}::timestamptz
      )`;
    }
    const contactsBefore = await tx.organizationContact.count();
    await tx.$executeRawUnsafe('SAVEPOINT preflight');
    let error: unknown;
    try {
      await tx.$executeRawUnsafe(block);
    } catch (caught) {
      error = caught;
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT preflight');
    }
    const remaining = await tx.$queryRaw<Array<{ id: string; is_public_contact: boolean }>>`
      SELECT id, is_public_contact FROM collaborations ORDER BY id
    `;
    if (drop && !error) {
      await tx.$executeRawUnsafe(
        'ALTER TABLE pg_temp.collaborations DROP COLUMN is_public_contact'
      );
      const columns = await tx.$queryRaw<Array<{ attname: string }>>`
        SELECT attname FROM pg_attribute
        WHERE attrelid = 'pg_temp.collaborations'::regclass AND attnum > 0 AND NOT attisdropped
      `;
      expect(columns.map((column) => column.attname)).not.toContain('is_public_contact');
    }
    expect(await tx.organizationContact.count()).toBe(contactsBefore);
    return { error, remaining };
  });
}

/** Reads only PostgreSQL's diagnostic, without Prisma's query wrapper. */
function diagnostic(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const meta = error.meta as {
    message?: string;
    driverAdapterError?: { cause?: { message?: string } };
  };
  return meta.driverAdapterError?.cause?.message ?? meta.message;
}

beforeEach(async () => {
  await prisma.person.createMany({
    data: [
      {
        id: OWNER,
        phoneNumber: '+237600043001',
        fullName: 'Fixture Person',
        phoneVerifiedAt: REG,
        registeredAt: REG,
        passwordHash: 'fixture-hash',
      },
      {
        id: MEMBER,
        phoneNumber: '+237600043002',
        fullName: 'Fixture Person',
        phoneVerifiedAt: REG,
        registeredAt: REG,
        passwordHash: 'fixture-hash',
      },
      { id: GUEST, phoneNumber: '+237600043003' },
    ],
  });
  await prisma.organization.create({
    data: {
      id: ORG,
      name: 'Fixture Business',
      collaborations: { create: { id: OWNER, personId: OWNER, role: 'OWNER', status: 'ACTIVE' } },
    },
  });
});

describe('collaboration public-contact column removed (ORG-043)', () => {
  it('objects gone: flag column and people trigger/function are absent (AC-1)', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'collaborations'
    `;
    expect(columns.map((column) => column.column_name)).not.toContain('is_public_contact');
    const objects = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT proname AS name FROM pg_proc WHERE proname = 'people_clear_public_contact'
      UNION ALL
      SELECT tgname AS name FROM pg_trigger
      WHERE tgrelid = 'public.people'::regclass AND tgname = 'people_clear_public_contact'
    `;
    expect(objects).toEqual([]);
  });

  it('preflight stops with only the two live ids, not the deleted id or personal data (AC-2)', async () => {
    const { error } = await preflight([
      { id: LIVE_A, flagged: true },
      { id: LIVE_B, flagged: true },
      { id: DELETED, flagged: true, deleted: true },
    ]);
    expect(diagnostic(error)).toBe(`Live public-contact collaborations: ${LIVE_A}, ${LIVE_B}`);
  });

  it('preflight passes for live unflagged rows (AC-3)', async () => {
    expect((await preflight([{ id: LIVE_A, flagged: false }])).error).toBeUndefined();
  });

  it('registered person: ACTIVE guest is still rejected with 23514 (AC-4)', async () => {
    await expect(prisma.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status)
      VALUES (${MEMBER}::uuid, ${GUEST}::uuid, ${ORG}::uuid, 'SELLER', 'ACTIVE')
    `).rejects.toMatchObject({ meta: { driverAdapterError: { cause: { code: '23514' } } } });
  });

  it('number released: phone null succeeds without changing any collaboration (AC-5)', async () => {
    await prisma.collaboration.create({
      data: {
        id: MEMBER,
        personId: MEMBER,
        organizationId: ORG,
        role: 'SELLER',
        status: 'ACTIVE',
      },
    });
    const before = await prisma.collaboration.findMany({ orderBy: { id: 'asc' } });
    await prisma.person.update({
      where: { id: MEMBER },
      data: {
        phoneNumber: null,
        phoneVerifiedAt: null,
        releasedPhoneNumber: '+237600043002',
      },
    });
    expect(await prisma.collaboration.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('deleted flag ignored and discarded without creating contacts (AC-6)', async () => {
    expect(
      (await preflight([{ id: DELETED, flagged: true, deleted: true }], true)).error
    ).toBeUndefined();
  });

  it('no silent loss: a blocked preflight leaves legacy rows and the column unchanged (AB-1)', async () => {
    const { error, remaining } = await preflight([{ id: LIVE_A, flagged: true }]);
    expect(diagnostic(error)).toBe(`Live public-contact collaborations: ${LIVE_A}`);
    expect(remaining).toEqual([{ id: LIVE_A, is_public_contact: true }]);
  });

  it('limits live-id diagnostics to 20 even when more rows block the migration', async () => {
    const ids = Array.from(
      { length: 21 },
      (_, index) => `0199c043-0000-7000-8000-${String(index + 100).padStart(12, '0')}`
    );
    const { error } = await preflight(ids.map((id) => ({ id, flagged: true })));
    expect(diagnostic(error)).toBe(
      `Live public-contact collaborations: ${ids.slice(0, 20).join(', ')}`
    );
  });
});
