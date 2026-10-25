import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const ORG_ID = '0199f004-0000-7000-8000-000000000001';
const PERSON_ID = '0199f004-0000-7000-8000-000000000011';
const ADMIN_PERSON_ID = '0199f004-0000-7000-8000-000000000012';
const ADMIN_ID = '0199f004-0000-7000-8000-000000000021';
const ACTION_ID = '0199f004-0000-7000-8000-000000000031';
const PAYMENT_ID = '0199f004-0000-7000-8000-000000000041';
const SUBSCRIPTION_ID = '0199f004-0000-7000-8000-000000000051';
const UNKNOWN_ID = '0199f004-0000-7000-8000-0000000000ff';

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
  kind?: string;
  actor: string;
  person?: string | null;
  administrator?: string | null;
  action?: string | null;
  subscription?: string | null;
  payment?: string | null;
  details?: string;
};

let sequence = 0;
/** A fresh UUID for each event row of a test. */
function eventId(): string {
  sequence += 1;
  return `0199f004-0000-7000-8000-${String(100 + sequence).padStart(12, '0')}`;
}

/** Inserts an event as the application account; links default to none. */
function insertEvent(row: Row): Promise<number> {
  return appPrisma.$executeRaw`
    INSERT INTO subscription_events (
      id, organization_id, kind, actor, person_id, administrator_id, admin_action_id,
      subscription_id, payment_id, details
    ) VALUES (
      ${row.id}::uuid, ${ORG_ID}::uuid, ${row.kind ?? 'PAYMENT'}::text::public."SubscriptionEventKind",
      ${row.actor}::text::public."SubscriptionEventActor", ${row.person ?? null}::uuid,
      ${row.administrator ?? null}::uuid, ${row.action ?? null}::uuid,
      ${row.subscription ?? null}::uuid, ${row.payment ?? null}::uuid,
      ${row.details ?? '{}'}::jsonb
    )
  `;
}

async function count(): Promise<bigint> {
  const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM subscription_events
  `;
  return row.count;
}

beforeEach(async () => {
  sequence = 0;
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
  `;
  const registered = {
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: PERSON_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700018001', ...registered },
      {
        id: ADMIN_PERSON_ID,
        fullName: 'Fixture Admin',
        phoneNumber: '+2250700018002',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO administrators (id, person_id, role, totp_secret)
    VALUES (${ADMIN_ID}::uuid, ${ADMIN_PERSON_ID}::uuid, 'SUPER_ADMIN', 'encrypted-secret')
  `;
  await prisma.$executeRaw`
    INSERT INTO admin_actions (id, administrator_id, action, target_organization_id, reason)
    VALUES (${ACTION_ID}::uuid, ${ADMIN_ID}::uuid, 'SUSPEND', ${ORG_ID}::uuid, 'motif')
  `;
  await prisma.$executeRaw`
    INSERT INTO subscription_payments (
      id, organization_id, plan, months, amount, operator, payer_phone_number,
      provider_reference, status, terms_version, confirmed_at
    ) VALUES (
      ${PAYMENT_ID}::uuid, ${ORG_ID}::uuid, 'ESSENTIAL', 3, 5000, 'MTN_MOMO', '+2250700018003',
      'REF-1', 'SUCCEEDED', '2026-10', now()
    )
  `;
  await prisma.$executeRaw`
    INSERT INTO subscriptions (
      id, organization_id, plan, price, origin, status, starts_at, ends_at
    ) VALUES (
      ${SUBSCRIPTION_ID}::uuid, ${ORG_ID}::uuid, 'ESSENTIAL', 0, 'GIFT', 'ACTIVE',
      now(), now() + interval '30 days'
    )
  `;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('events', () => {
  it.each([
    ['PAYMENT', 'PAYER', { payment: PAYMENT_ID }],
    ['KEEP_CHOICE', 'OWNER', { person: PERSON_ID }],
    ['PLAN_CHANGED', 'ADMINISTRATOR', { administrator: ADMIN_ID, action: ACTION_ID }],
    ['REMINDER', 'SYSTEM', {}],
  ])('stores kind %s with actor %s', async (kind, actor, links) => {
    const id = eventId();
    await insertEvent({ id, kind, actor, ...links });
    const [row] = await prisma.$queryRaw<
      Array<{ kind: string; actor: string; details: unknown; occurred_at: Date }>
    >`SELECT kind::text AS kind, actor::text AS actor, details, occurred_at
      FROM subscription_events WHERE id = ${id}::uuid`;
    expect(row.kind).toBe(kind);
    expect(row.actor).toBe(actor);
    expect(row.details).toEqual({});
    expect(row.occurred_at).toBeInstanceOf(Date);
  });

  it('stores every kind and links a subscription', async () => {
    const kinds = [
      'PAYMENT',
      'FORFAIT_ADDED',
      'FORFAIT_ENDED',
      'PLAN_CHANGED',
      'REMINDER',
      'KEEP_CHOICE',
      'PAUSED',
      'RESUMED',
    ];
    for (const kind of kinds) {
      await insertEvent({ id: eventId(), kind, actor: 'SYSTEM', subscription: SUBSCRIPTION_ID });
    }
    expect(await count()).toBe(8n);
  });

  it('refuses a person that does not exist with 23503', async () => {
    expect(
      await captureSqlCode(insertEvent({ id: eventId(), actor: 'OWNER', person: UNKNOWN_ID }))
    ).toBe('23503');
  });

  it('refuses a missing organization with 23502', async () => {
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO subscription_events (id, kind, actor)
        VALUES (${eventId()}::uuid, 'REMINDER', 'SYSTEM')
      `)
    ).toBe('23502');
  });
});

describe('wrong rows', () => {
  it.each([
    ['actor OWNER and no person_id', { actor: 'OWNER' }],
    ['actor SYSTEM and a person_id', { actor: 'SYSTEM', person: PERSON_ID }],
    ['actor ADMINISTRATOR without an action', { actor: 'ADMINISTRATOR', administrator: ADMIN_ID }],
    ['actor ADMINISTRATOR without an administrator', { actor: 'ADMINISTRATOR', action: ACTION_ID }],
    [
      'actor OWNER with an administrator',
      { actor: 'OWNER', person: PERSON_ID, administrator: ADMIN_ID, action: ACTION_ID },
    ],
    ['actor PAYER and no payment_id', { actor: 'PAYER' }],
    ['details set to a list', { actor: 'SYSTEM', details: '[]' }],
    ['details set to null JSON', { actor: 'SYSTEM', details: 'null' }],
  ] as Array<[string, Omit<Row, 'id'>]>)('refuses %s with 23514', async (_problem, row) => {
    expect(await captureSqlCode(insertEvent({ id: eventId(), ...row }))).toBe('23514');
    expect(await count()).toBe(0n);
  });

  it('refuses kind REFUND with 22P02', async () => {
    expect(
      await captureSqlCode(insertEvent({ id: eventId(), kind: 'REFUND', actor: 'SYSTEM' }))
    ).toBe('22P02');
  });
});

describe('immutable', () => {
  beforeEach(async () => {
    await insertEvent({ id: eventId(), actor: 'SYSTEM', kind: 'REMINDER' });
  });

  it('lets the application account read events', async () => {
    const rows = await appPrisma.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM subscription_events`;
    expect(rows).toHaveLength(1);
  });

  it('refuses UPDATE with 42501', async () => {
    expect(
      await captureSqlCode(
        appPrisma.$executeRaw`UPDATE subscription_events SET details = '{}'::jsonb`
      )
    ).toBe('42501');
  });

  it('refuses DELETE with 42501', async () => {
    expect(await captureSqlCode(appPrisma.$executeRaw`DELETE FROM subscription_events`)).toBe(
      '42501'
    );
  });

  it('refuses TRUNCATE with 42501', async () => {
    expect(
      await captureSqlCode(appPrisma.$executeRawUnsafe('TRUNCATE TABLE subscription_events'))
    ).toBe('42501');
    expect(await count()).toBe(1n);
  });
});

describe('rewrite', () => {
  it('refuses to change kind and details of a stored event with 42501 and leaves the row unchanged', async () => {
    const id = eventId();
    await insertEvent({ id, kind: 'REMINDER', actor: 'SYSTEM', details: '{"days":3}' });
    const result = await captureSqlCode(
      appPrisma.$executeRaw`
        UPDATE subscription_events SET kind = 'PAUSED', details = '{"days":0}'::jsonb
        WHERE id = ${id}::uuid
      `
    );
    expect(result).toBe('42501');
    const [row] = await prisma.$queryRaw<Array<{ kind: string; details: unknown }>>`
      SELECT kind::text AS kind, details FROM subscription_events WHERE id = ${id}::uuid
    `;
    expect(row.kind).toBe('REMINDER');
    expect(row.details).toEqual({ days: 3 });
  });
});
