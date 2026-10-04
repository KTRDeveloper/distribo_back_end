import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';
import { recordAdminAction } from '../../../src/modules/admin/admin.repository';

const appPrisma = getAppRolePrisma();

const PERSON_ID = '0199d002-0000-7000-8000-000000000001';
const SUPER_PERSON_ID = '0199d002-0000-7000-8000-000000000002';
const MODERATOR_PERSON_ID = '0199d002-0000-7000-8000-000000000003';
const ORG_ID = '0199d002-0000-7000-8000-000000000004';
const SUPER_ID = '0199d002-0000-7000-8000-000000000011';
const MODERATOR_ID = '0199d002-0000-7000-8000-000000000012';
const UNKNOWN_ID = '0199d002-0000-7000-8000-0000000000ff';
const ARCHIVE_ID = '0199d002-0000-7000-8000-000000000031';
const DEVICE_ID = '0199d002-0000-7000-8000-000000000041';
const FIRST_ID = '0199d002-0000-7000-8000-000000000021';

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

type Row = {
  id?: string;
  administratorId?: string;
  action?: string;
  person?: string | null;
  organization?: string | null;
  archive?: string | null;
  reason?: string;
};

/** Inserts a journal row as the application account; defaults describe a SUSPEND of a person. */
function insertAction(row: Row = {}): Promise<number> {
  const person = 'person' in row ? row.person : PERSON_ID;
  const organization = 'organization' in row ? row.organization : null;
  const archive = 'archive' in row ? row.archive : null;
  return appPrisma.$executeRaw`
    INSERT INTO admin_actions (
      id, administrator_id, action, target_person_id, target_organization_id,
      sync_archive_id, reason
    ) VALUES (
      ${row.id ?? FIRST_ID}::uuid, ${row.administratorId ?? MODERATOR_ID}::uuid,
      ${row.action ?? 'SUSPEND'}::text::public."AdminActionType",
      ${person}::uuid, ${organization}::uuid, ${archive}::uuid, ${row.reason ?? 'abus'}
    )
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
      { id: PERSON_ID, fullName: 'Fixture Target', phoneNumber: '+2250700015001', ...registered },
      {
        id: SUPER_PERSON_ID,
        fullName: 'Fixture Super',
        phoneNumber: '+2250700015002',
        ...registered,
      },
      {
        id: MODERATOR_PERSON_ID,
        fullName: 'Fixture Moderator',
        phoneNumber: '+2250700015003',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Organization')
  `;
  await prisma.$executeRaw`
    INSERT INTO administrators (id, person_id, role, totp_secret) VALUES
      (${SUPER_ID}::uuid, ${SUPER_PERSON_ID}::uuid, 'SUPER_ADMIN', 'encrypted-secret'),
      (${MODERATOR_ID}::uuid, ${MODERATOR_PERSON_ID}::uuid, 'MODERATOR', 'encrypted-secret')
  `;
  await prisma.$executeRaw`
    INSERT INTO devices (id, person_id, platform, app_version)
    VALUES (${DEVICE_ID}::uuid, ${PERSON_ID}::uuid, 'ANDROID', '1.0.0')
  `;
  await prisma.$executeRaw`
    INSERT INTO sync_archives (id, person_id, device_id, changes)
    VALUES (${ARCHIVE_ID}::uuid, ${PERSON_ID}::uuid, ${DEVICE_ID}::uuid, '[]'::jsonb)
  `;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('admin_actions insert rules (AC-1, C-29)', () => {
  it('accepts SUSPEND with a person target and a reason', async () => {
    await expect(insertAction()).resolves.toBe(1);
  });

  it('accepts an organization target', async () => {
    await expect(insertAction({ person: null, organization: ORG_ID })).resolves.toBe(1);
  });

  it('rejects SUSPEND with both targets with 23514', async () => {
    expect(await captureSqlCode(insertAction({ organization: ORG_ID }))).toBe('23514');
  });

  it('rejects SUSPEND with no target with 23514', async () => {
    expect(await captureSqlCode(insertAction({ person: null }))).toBe('23514');
  });

  it('rejects an empty or blank reason with 23514', async () => {
    expect(await captureSqlCode(insertAction({ reason: '' }))).toBe('23514');
    expect(await captureSqlCode(insertAction({ reason: '   ' }))).toBe('23514');
  });

  it('accepts REPLAY_SYNC by a SUPER_ADMIN with a sync_archive_id', async () => {
    await expect(
      insertAction({ administratorId: SUPER_ID, action: 'REPLAY_SYNC', archive: ARCHIVE_ID })
    ).resolves.toBe(1);
  });

  it('rejects REPLAY_SYNC by a MODERATOR with 23514', async () => {
    expect(
      await captureSqlCode(
        insertAction({ administratorId: MODERATOR_ID, action: 'REPLAY_SYNC', archive: ARCHIVE_ID })
      )
    ).toBe('23514');
  });

  it('rejects REPLAY_SYNC without sync_archive_id with 23514', async () => {
    expect(
      await captureSqlCode(insertAction({ administratorId: SUPER_ID, action: 'REPLAY_SYNC' }))
    ).toBe('23514');
  });

  it('rejects SUSPEND with a sync_archive_id with 23514', async () => {
    expect(await captureSqlCode(insertAction({ archive: ARCHIVE_ID }))).toBe('23514');
  });

  it('rejects the action DELETE_USER', async () => {
    const code = await captureSqlCode(insertAction({ action: 'DELETE_USER' }));
    expect(code).toBeDefined();
  });

  it('accepts every listed action that needs no archive', async () => {
    const actions = ['SUSPEND', 'REACTIVATE', 'DISMISS_REPORT', 'APPOINT_ADMIN', 'REMOVE_ADMIN'];
    for (const [index, action] of [...actions, 'RECOVER_2FA'].entries()) {
      await expect(
        insertAction({ id: `0199d002-0000-7000-8000-00000000004${index}`, action })
      ).resolves.toBe(1);
    }
  });

  it('rejects missing administrator, action or reason with 23502', async () => {
    expect(
      await captureSqlCode(prisma.$executeRaw`
        INSERT INTO admin_actions (id, action, target_person_id, reason)
        VALUES (${FIRST_ID}::uuid, 'SUSPEND', ${PERSON_ID}::uuid, 'abus')
      `)
    ).toBe('23502');
    expect(
      await captureSqlCode(prisma.$executeRaw`
        INSERT INTO admin_actions (id, administrator_id, target_person_id, reason)
        VALUES (${FIRST_ID}::uuid, ${MODERATOR_ID}::uuid, ${PERSON_ID}::uuid, 'abus')
      `)
    ).toBe('23502');
    expect(
      await captureSqlCode(prisma.$executeRaw`
        INSERT INTO admin_actions (id, administrator_id, action, target_person_id)
        VALUES (${FIRST_ID}::uuid, ${MODERATOR_ID}::uuid, 'SUSPEND', ${PERSON_ID}::uuid)
      `)
    ).toBe('23502');
  });

  it('rejects unknown administrator, person or organization with 23503', async () => {
    expect(await captureSqlCode(insertAction({ administratorId: UNKNOWN_ID }))).toBe('23503');
    expect(await captureSqlCode(insertAction({ person: UNKNOWN_ID }))).toBe('23503');
    expect(await captureSqlCode(insertAction({ person: null, organization: UNKNOWN_ID }))).toBe(
      '23503'
    );
  });
});

describe('admin_actions immutability (AC-2, AB-1, C-32, C-39)', () => {
  it('denies UPDATE, DELETE and TRUNCATE with 42501 and keeps the row unchanged', async () => {
    await insertAction();

    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        UPDATE admin_actions SET reason = 'edited' WHERE id = ${FIRST_ID}::uuid
      `)
    ).toBe('42501');
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        DELETE FROM admin_actions WHERE id = ${FIRST_ID}::uuid
      `)
    ).toBe('42501');
    expect(await captureSqlCode(appPrisma.$executeRaw`TRUNCATE TABLE admin_actions`)).toBe(
      '42501'
    );

    const rows = await prisma.$queryRaw<Array<{ reason: string }>>`
      SELECT reason FROM admin_actions WHERE id = ${FIRST_ID}::uuid
    `;
    expect(rows).toEqual([{ reason: 'abus' }]);
  });

  it('lets the application account read rows', async () => {
    await insertAction();
    const rows = await appPrisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM admin_actions`;
    expect(rows).toEqual([{ id: FIRST_ID }]);
  });
});

describe('recordAdminAction (AC-3)', () => {
  it('creates one row with a new id and a server time', async () => {
    const created = await prisma.$transaction((tx) =>
      recordAdminAction(tx, {
        administratorId: MODERATOR_ID,
        action: 'SUSPEND',
        targetPersonId: PERSON_ID,
        reason: 'abus',
      })
    );

    const rows = await prisma.$queryRaw<
      Array<{ id: string; occurred_at: Date; server_updated_at: Date; reason: string }>
    >`SELECT id, occurred_at, server_updated_at, reason FROM admin_actions`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(created.id);
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(rows[0]?.reason).toBe('abus');
    expect(Math.abs(Date.now() - (rows[0]?.occurred_at.getTime() ?? 0))).toBeLessThan(5_000);
    expect(Math.abs(Date.now() - (rows[0]?.server_updated_at.getTime() ?? 0))).toBeLessThan(
      5_000
    );
  });

  it('gives each call a distinct id', async () => {
    const input = {
      administratorId: MODERATOR_ID,
      action: 'SUSPEND' as const,
      targetPersonId: PERSON_ID,
      reason: 'abus',
    };
    const [a, b] = await prisma.$transaction(async (tx) => [
      await recordAdminAction(tx, input),
      await recordAdminAction(tx, input),
    ]);
    expect(a?.id).not.toBe(b?.id);
  });

  it('rolls back the whole transaction when a rule is violated', async () => {
    const code = await captureSqlCode(
      prisma.$transaction(async (tx) => {
        await recordAdminAction(tx, {
          administratorId: MODERATOR_ID,
          action: 'SUSPEND',
          targetPersonId: PERSON_ID,
          reason: 'abus',
        });
        await recordAdminAction(tx, {
          administratorId: MODERATOR_ID,
          action: 'SUSPEND',
          reason: 'abus',
        });
      })
    );
    expect(code).toBe('23514');
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM admin_actions`;
    expect(rows).toEqual([]);
  });
});
