import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const PERSON_ID = '0199d003-0000-7000-8000-000000000001';
const SUPER_PERSON_ID = '0199d003-0000-7000-8000-000000000002';
const SUPER_ID = '0199d003-0000-7000-8000-000000000011';
const DEVICE_ID = '0199d003-0000-7000-8000-000000000021';
const ARCHIVE_ID = '0199d003-0000-7000-8000-000000000031';
const ACTION_ID = '0199d003-0000-7000-8000-000000000041';
const UNKNOWN_ID = '0199d003-0000-7000-8000-0000000000ff';

type SqlError = {
  code?: string;
  message?: string;
  meta?: {
    code?: string;
    driverAdapterError?: {
      cause?: { code?: string; originalCode?: string; message?: string };
    };
  };
};

/** Extracts the PostgreSQL code wrapped by the Prisma driver adapter. */
function sqlCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as SqlError;
  const cause = candidate.meta?.driverAdapterError?.cause;
  const message = [candidate.message, cause?.message].filter(Boolean).join(' ');
  return (
    cause?.code ??
    cause?.originalCode ??
    candidate.meta?.code ??
    candidate.code ??
    message.match(/Code:\s*(\w+)/)?.[1]
  );
}

async function captureSqlCode(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation;
  } catch (error) {
    return sqlCode(error) ?? 'UNKNOWN';
  }
  return undefined;
}

const CHANGES = [{ entity: 'order', id: 'a', nested: { qty: 1.5, tags: ['x', null] } }];

/** Inserts an archive row as the application account. */
function insertArchive(
  row: { id?: string; personId?: string; deviceId?: string; changes?: unknown } = {}
): Promise<number> {
  const changes = 'changes' in row ? JSON.stringify(row.changes) : JSON.stringify(CHANGES);
  return appPrisma.$executeRaw`
    INSERT INTO sync_archives (id, person_id, device_id, changes)
    VALUES (${row.id ?? ARCHIVE_ID}::uuid, ${row.personId ?? PERSON_ID}::uuid,
      ${row.deviceId ?? DEVICE_ID}::uuid, ${changes}::jsonb)
  `;
}

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: PERSON_ID, fullName: 'Fixture Sender', phoneNumber: '+2250700016001', ...registered },
      {
        id: SUPER_PERSON_ID,
        fullName: 'Fixture Super',
        phoneNumber: '+2250700016002',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO devices (id, person_id, platform, app_version)
    VALUES (${DEVICE_ID}::uuid, ${PERSON_ID}::uuid, 'ANDROID', '1.0.0')
  `;
  await prisma.$executeRaw`
    INSERT INTO administrators (id, person_id, role, totp_secret)
    VALUES (${SUPER_ID}::uuid, ${SUPER_PERSON_ID}::uuid, 'SUPER_ADMIN', 'encrypted-secret')
  `;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('sync_archives add and read (AC-1, C-35)', () => {
  it('returns changes unchanged and sets received_at and server_updated_at', async () => {
    await expect(insertArchive()).resolves.toBe(1);
    const rows = await appPrisma.$queryRaw<
      Array<{ changes: unknown; received_at: Date; server_updated_at: Date }>
    >`SELECT changes, received_at, server_updated_at FROM sync_archives
      WHERE id = ${ARCHIVE_ID}::uuid`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.changes).toEqual(CHANGES);
    expect(Math.abs(Date.now() - (rows[0]?.received_at.getTime() ?? 0))).toBeLessThan(5_000);
    expect(Math.abs(Date.now() - (rows[0]?.server_updated_at.getTime() ?? 0))).toBeLessThan(
      5_000
    );
  });
});

describe('sync_archives immutability (AC-2, AB-1, C-32, C-39, CM-35)', () => {
  it('denies UPDATE, DELETE and TRUNCATE with 42501 and keeps the row unchanged', async () => {
    await insertArchive();

    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        UPDATE sync_archives SET changes = '[]'::jsonb WHERE id = ${ARCHIVE_ID}::uuid
      `)
    ).toBe('42501');
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        DELETE FROM sync_archives WHERE id = ${ARCHIVE_ID}::uuid
      `)
    ).toBe('42501');
    expect(await captureSqlCode(appPrisma.$executeRaw`TRUNCATE TABLE sync_archives`)).toBe(
      '42501'
    );

    const rows = await prisma.$queryRaw<Array<{ changes: unknown }>>`
      SELECT changes FROM sync_archives WHERE id = ${ARCHIVE_ID}::uuid
    `;
    expect(rows).toEqual([{ changes: CHANGES }]);
  });
});

describe('sync_archives required columns and keys (AC-3)', () => {
  it('rejects a null changes value with 23502', async () => {
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO sync_archives (id, person_id, device_id, changes)
        VALUES (${ARCHIVE_ID}::uuid, ${PERSON_ID}::uuid, ${DEVICE_ID}::uuid, NULL)
      `)
    ).toBe('23502');
  });

  it('rejects a missing person or device with 23502', async () => {
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO sync_archives (id, device_id, changes)
        VALUES (${ARCHIVE_ID}::uuid, ${DEVICE_ID}::uuid, '[]'::jsonb)
      `)
    ).toBe('23502');
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO sync_archives (id, person_id, changes)
        VALUES (${ARCHIVE_ID}::uuid, ${PERSON_ID}::uuid, '[]'::jsonb)
      `)
    ).toBe('23502');
  });

  it('rejects an unknown person or device with 23503', async () => {
    expect(await captureSqlCode(insertArchive({ personId: UNKNOWN_ID }))).toBe('23503');
    expect(await captureSqlCode(insertArchive({ deviceId: UNKNOWN_ID }))).toBe('23503');
  });
});

describe('admin_actions link to sync_archives (AC-4, C-29)', () => {
  function insertReplay(archive: string): Promise<number> {
    return appPrisma.$executeRaw`
      INSERT INTO admin_actions (id, administrator_id, action, target_person_id,
        sync_archive_id, reason)
      VALUES (${ACTION_ID}::uuid, ${SUPER_ID}::uuid, 'REPLAY_SYNC', ${PERSON_ID}::uuid,
        ${archive}::uuid, 'rejeu')
    `;
  }

  it('rejects a REPLAY_SYNC row pointing to an unknown archive with 23503', async () => {
    expect(await captureSqlCode(insertReplay(UNKNOWN_ID))).toBe('23503');
  });

  it('accepts a REPLAY_SYNC row pointing to an existing archive', async () => {
    await insertArchive();
    await expect(insertReplay(ARCHIVE_ID)).resolves.toBe(1);
  });
});

describe('sync_archives schema extras', () => {
  it('has the (person_id, received_at desc) index', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'sync_archives'
    `;
    expect(
      rows.some((r) => /person_id, received_at DESC/.test(r.indexdef))
    ).toBe(true);
  });
});
