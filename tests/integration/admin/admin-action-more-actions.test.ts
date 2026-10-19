import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';
import { bodyOf } from '../../helpers/body';

const { app } = await import('../../../src/app.js');
const { createTotpSecret, encryptSecret } = await import('../../../src/lib/totp.js');
const { signAdminToken } = await import('../../../src/lib/jwt.js');

const appPrisma = getAppRolePrisma();

const PERSON_ID = '0199d016-0000-7000-8000-000000000001';
const SUPER_PERSON_ID = '0199d016-0000-7000-8000-000000000002';
const MODERATOR_PERSON_ID = '0199d016-0000-7000-8000-000000000003';
const ORG_ID = '0199d016-0000-7000-8000-000000000004';
const SUPER_ID = '0199d016-0000-7000-8000-000000000011';
const MODERATOR_ID = '0199d016-0000-7000-8000-000000000012';
const ARCHIVE_ID = '0199d016-0000-7000-8000-000000000031';
const DEVICE_ID = '0199d016-0000-7000-8000-000000000041';
const FIRST_ID = '0199d016-0000-7000-8000-000000000021';

const BUSINESS_ACTIONS = ['GIFT_DAYS', 'RECORD_PAYMENT', 'REFUND_PAYMENT'];
const PERSON_ACTIONS = ['RELEASE_PHONE', 'RESTORE_ACCESS'];
const NEW_ACTIONS = [...BUSINESS_ACTIONS, ...PERSON_ACTIONS];
const TWELVE_ACTIONS = [
  'SUSPEND',
  'REACTIVATE',
  'DISMISS_REPORT',
  'APPOINT_ADMIN',
  'REMOVE_ADMIN',
  'REPLAY_SYNC',
  'RECOVER_2FA',
  ...NEW_ACTIONS,
];

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
  id: string;
  administratorId: string;
  action: string;
  kind: 'person' | 'organization';
  archive?: string | null;
};

/** Inserts a journal row as the application account, with a person or a business target. */
function insertAction(row: Row): Promise<number> {
  const person = row.kind === 'person' ? PERSON_ID : null;
  const organization = row.kind === 'organization' ? ORG_ID : null;
  return appPrisma.$executeRaw`
    INSERT INTO admin_actions (
      id, administrator_id, action, target_person_id, target_organization_id,
      sync_archive_id, reason
    ) VALUES (
      ${row.id}::uuid, ${row.administratorId}::uuid,
      ${row.action}::text::public."AdminActionType",
      ${person}::uuid, ${organization}::uuid, ${row.archive ?? null}::uuid, 'motif'
    )
  `;
}

const rightKind = (action: string): 'person' | 'organization' =>
  BUSINESS_ACTIONS.includes(action) ? 'organization' : 'person';

const idFor = (index: number): string =>
  `0199d016-0000-7000-8000-0000000001${String(index).padStart(2, '0')}`;

async function countRows(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM admin_actions
  `;
  return Number(rows[0]?.n ?? 0);
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
      { id: PERSON_ID, fullName: 'Fixture Target', phoneNumber: '+2250700016001', ...registered },
      {
        id: SUPER_PERSON_ID,
        fullName: 'Fixture Super',
        phoneNumber: '+2250700016002',
        ...registered,
      },
      {
        id: MODERATOR_PERSON_ID,
        fullName: 'Fixture Moderator',
        phoneNumber: '+2250700016003',
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

describe('five actions (AC-1, AdminAction.action:enum)', () => {
  it('lets a SUPER_ADMIN record the five with the right kind of target', async () => {
    for (const [index, action] of NEW_ACTIONS.entries()) {
      await expect(
        insertAction({
          id: idFor(index),
          administratorId: SUPER_ID,
          action,
          kind: rightKind(action),
        })
      ).resolves.toBe(1);
    }
    expect(await countRows()).toBe(5);
  });
});

describe('reserved to SUPER_ADMIN (AC-2, C-29)', () => {
  it('refuses each of the six reserved actions from a MODERATOR with 23514', async () => {
    const reserved = ['REPLAY_SYNC', ...NEW_ACTIONS];
    for (const [index, action] of reserved.entries()) {
      const code = await captureSqlCode(
        insertAction({
          id: idFor(index),
          administratorId: MODERATOR_ID,
          action,
          kind: action === 'REPLAY_SYNC' ? 'person' : rightKind(action),
          archive: action === 'REPLAY_SYNC' ? ARCHIVE_ID : null,
        })
      );
      expect(code, action).toBe('23514');
    }
    expect(await countRows()).toBe(0);
  });
});

describe('right kind of target (AC-3)', () => {
  it('refuses a person for the business actions and a business for the person actions', async () => {
    for (const [index, action] of NEW_ACTIONS.entries()) {
      const wrong = rightKind(action) === 'person' ? 'organization' : 'person';
      const code = await captureSqlCode(
        insertAction({ id: idFor(index), administratorId: SUPER_ID, action, kind: wrong })
      );
      expect(code, action).toBe('23514');
    }
    expect(await countRows()).toBe(0);
  });
});

describe('earlier actions and rows are unchanged (AC-4)', () => {
  it('still accepts SUSPEND from a MODERATOR and REPLAY_SYNC from a SUPER_ADMIN', async () => {
    await expect(
      insertAction({
        id: idFor(1),
        administratorId: MODERATOR_ID,
        action: 'SUSPEND',
        kind: 'person',
      })
    ).resolves.toBe(1);
    await expect(
      insertAction({
        id: idFor(2),
        administratorId: SUPER_ID,
        action: 'REPLAY_SYNC',
        kind: 'person',
        archive: ARCHIVE_ID,
      })
    ).resolves.toBe(1);
  });

  it('still refuses an unknown action', async () => {
    const code = await captureSqlCode(
      insertAction({
        id: idFor(3),
        administratorId: SUPER_ID,
        action: 'DELETE_USER',
        kind: 'person',
      })
    );
    expect(code).toBeDefined();
    expect(await countRows()).toBe(0);
  });

  it('keeps the earlier rows readable and a business target allowed for them', async () => {
    await insertAction({
      id: idFor(4),
      administratorId: MODERATOR_ID,
      action: 'SUSPEND',
      kind: 'organization',
    });
    const rows = await appPrisma.$queryRaw<Array<{ action: string }>>`
      SELECT action::text AS action FROM admin_actions WHERE id = ${idFor(4)}::uuid
    `;
    expect(rows).toEqual([{ action: 'SUSPEND' }]);
  });
});

describe('the code lists the twelve actions (AC-5)', () => {
  it('answers 200 to the RESTORE_ACCESS filter and documents twelve values', async () => {
    const token = signAdminToken({
      personId: SUPER_PERSON_ID,
      administratorId: SUPER_ID,
      role: 'SUPER_ADMIN',
    });
    await prisma.administrator.update({
      where: { id: SUPER_ID },
      data: { totpSecret: encryptSecret(createTotpSecret().secret) },
    });
    await insertAction({
      id: idFor(5),
      administratorId: SUPER_ID,
      action: 'RESTORE_ACCESS',
      kind: 'person',
    });

    const res = await request(app)
      .get('/api/v1/admin/actions?action=RESTORE_ACCESS')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = bodyOf<{ items: Array<{ id: string; action: string }> }>(res);
    expect(body.items.map((i) => i.action)).toEqual(['RESTORE_ACCESS']);

    const docs = await request(app).get('/api/v1/docs/openapi.json');
    const operation = (
      bodyOf<{
        paths: Record<
          string,
          { get?: { parameters?: Array<{ name: string; schema?: { enum?: string[] } }> } }
        >;
      }>(docs).paths['/api/v1/admin/actions'] ?? {}
    ).get;
    const filter = operation?.parameters?.find((p) => p.name === 'action');
    expect([...(filter?.schema?.enum ?? [])].sort()).toEqual([...TWELVE_ACTIONS].sort());
    const text = JSON.stringify(docs.body);
    const answerEnum = text.match(/"action":\{"type":"string","enum":(\[[^\]]*\])\}/)?.[1];
    expect((JSON.parse(answerEnum ?? '[]') as string[]).sort()).toEqual([...TWELVE_ACTIONS].sort());
  });
});

describe('moderator bypass (AB-1, CWE-269)', () => {
  it('refuses RELEASE_PHONE and RESTORE_ACCESS from a MODERATOR with direct SQL', async () => {
    for (const [index, action] of PERSON_ACTIONS.entries()) {
      const code = await captureSqlCode(
        insertAction({ id: idFor(index), administratorId: MODERATOR_ID, action, kind: 'person' })
      );
      expect(code, action).toBe('23514');
    }
    expect(await countRows()).toBe(0);
  });
});

describe('append only (AB-2, CWE-284)', () => {
  it('denies UPDATE and DELETE of a new action row with 42501', async () => {
    await insertAction({
      id: FIRST_ID,
      administratorId: SUPER_ID,
      action: 'GIFT_DAYS',
      kind: 'organization',
    });
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
    const rows = await prisma.$queryRaw<Array<{ reason: string }>>`
      SELECT reason FROM admin_actions WHERE id = ${FIRST_ID}::uuid
    `;
    expect(rows).toEqual([{ reason: 'motif' }]);
  });
});
