import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const SUPPLIER_ORG_ID = '0199d002-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199d002-0000-7000-8000-000000000002';
const OWNER_ID = '0199d002-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199d002-0000-7000-8000-000000000012';
const DRIVER_ID = '0199d002-0000-7000-8000-000000000013';
const SELLER_ID = '0199d002-0000-7000-8000-000000000014';
const REVOKED_ID = '0199d002-0000-7000-8000-000000000015';
const INVITED_ID = '0199d002-0000-7000-8000-000000000016';
const OUTSIDER_ID = '0199d002-0000-7000-8000-000000000017';
const REL_ID = '0199d002-0000-7000-8000-000000000021';
const ORDER_ID = '0199d002-0000-7000-8000-000000000031';
const FIRST_ID = '0199d002-0000-7000-8000-000000000041';
const SECOND_ID = '0199d002-0000-7000-8000-000000000042';

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
  assignedToId?: string;
  arrivedAt?: Date | null;
  failedAt?: Date | null;
  failureReason?: string | null;
};

const WHEN = new Date('2026-02-01T10:00:00.000Z');

/** Inserts a delivery of the fixture order; the driver defaults to the ACTIVE DRIVER. */
function insertDelivery(row: Row = {}): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO deliveries (id, order_id, assigned_to_id, arrived_at, failed_at, failure_reason)
    VALUES (
      ${row.id ?? FIRST_ID}::uuid, ${ORDER_ID}::uuid, ${row.assignedToId ?? DRIVER_ID}::uuid,
      ${row.arrivedAt ?? null}::timestamptz, ${row.failedAt ?? null}::timestamptz,
      ${row.failureReason ?? null}::text
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
  const people: Array<[string, string]> = [
    [OWNER_ID, '+2250700006021'],
    [CUSTOMER_ID, '+2250700006022'],
    [DRIVER_ID, '+2250700006023'],
    [SELLER_ID, '+2250700006024'],
    [REVOKED_ID, '+2250700006025'],
    [INVITED_ID, '+2250700006026'],
    [OUTSIDER_ID, '+2250700006027'],
  ];
  await prisma.person.createMany({
    data: people.map(([id, phoneNumber]) => ({
      id,
      fullName: 'Fixture Person',
      phoneNumber,
      ...registered,
    })),
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier'),
      (${OTHER_ORG_ID}::uuid, 'Fixture Other Business')
  `;
  await prisma.$executeRaw`
    INSERT INTO collaborations (id, person_id, organization_id, role, status) VALUES
      ('0199d002-0000-7000-8000-000000000051'::uuid, ${OWNER_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'OWNER', 'ACTIVE'),
      ('0199d002-0000-7000-8000-000000000052'::uuid, ${DRIVER_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'DRIVER', 'ACTIVE'),
      ('0199d002-0000-7000-8000-000000000053'::uuid, ${SELLER_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'SELLER', 'ACTIVE'),
      ('0199d002-0000-7000-8000-000000000054'::uuid, ${REVOKED_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'DRIVER', 'REVOKED'),
      ('0199d002-0000-7000-8000-000000000055'::uuid, ${INVITED_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'DRIVER', 'INVITED'),
      ('0199d002-0000-7000-8000-000000000056'::uuid, ${OUTSIDER_ID}::uuid, ${OTHER_ORG_ID}::uuid, 'OWNER', 'ACTIVE')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
    VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'SUPPLIER', ${OWNER_ID}::uuid, 0)
  `;
});

describe('state rules (AC-1, C-21)', () => {
  const examples: Array<[string, Row, string | undefined]> = [
    [
      'arrived_at and failed_at both set',
      { arrivedAt: WHEN, failedAt: WHEN, failureReason: 'x' },
      '23514',
    ],
    [
      'failed_at set, failure_reason "client absent"',
      { failedAt: WHEN, failureReason: 'client absent' },
      undefined,
    ],
    ['failed_at set, failure_reason empty', { failedAt: WHEN }, '23514'],
    ['failure_reason set, failed_at empty', { failureReason: 'client absent' }, '23514'],
    ['arrived_at set only', { arrivedAt: WHEN }, undefined],
  ];
  it.each(examples)('%s', async (_name, row, code) => {
    expect(await captureSqlCode(insertDelivery(row))).toBe(code);
  });

  it('rejects an update that sets both outcomes', async () => {
    await insertDelivery({ arrivedAt: WHEN });
    const code = await captureSqlCode(
      prisma.$executeRaw`
        UPDATE deliveries SET failed_at = now(), failure_reason = 'x' WHERE id = ${FIRST_ID}::uuid
      `
    );
    expect(code).toBe('23514');
  });
});

describe('one in progress (AC-2, C-21)', () => {
  const examples: Array<[string, Row, string | undefined]> = [
    ['in progress', {}, '23505'],
    ['failed', { failedAt: WHEN, failureReason: 'client absent' }, undefined],
    ['arrived', { arrivedAt: WHEN }, undefined],
  ];
  it.each(examples)('first delivery %s', async (_name, first, code) => {
    await insertDelivery(first);
    expect(await captureSqlCode(insertDelivery({ id: SECOND_ID }))).toBe(code);
  });

  it('first delivery deleted', async () => {
    await insertDelivery();
    await prisma.$executeRaw`UPDATE deliveries SET deleted_at = now() WHERE id = ${FIRST_ID}::uuid`;
    expect(await captureSqlCode(insertDelivery({ id: SECOND_ID }))).toBeUndefined();
  });

  it('allows an in-progress delivery on another order', async () => {
    await insertDelivery();
    const otherOrder = '0199d002-0000-7000-8000-000000000032';
    await prisma.$executeRaw`
      INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
      VALUES (${otherOrder}::uuid, ${REL_ID}::uuid, 'SUPPLIER', ${OWNER_ID}::uuid, 0)
    `;
    await expect(
      prisma.$executeRaw`
        INSERT INTO deliveries (id, order_id, assigned_to_id)
        VALUES (${SECOND_ID}::uuid, ${otherOrder}::uuid, ${DRIVER_ID}::uuid)
      `
    ).resolves.toBe(1);
  });
});

describe('membership (AC-3, C-21)', () => {
  const examples: Array<[string, string, string | undefined]> = [
    ['an ACTIVE DRIVER of the supplier', DRIVER_ID, undefined],
    ['an ACTIVE SELLER of the supplier', SELLER_ID, undefined],
    ['a REVOKED collaborator', REVOKED_ID, '23514'],
    ['an INVITED collaborator', INVITED_ID, '23514'],
    ['an ACTIVE collaborator of another business', OUTSIDER_ID, '23514'],
    ['a registered person with no collaboration', CUSTOMER_ID, '23514'],
  ];
  it.each(examples)('%s', async (_name, assignedToId, code) => {
    expect(await captureSqlCode(insertDelivery({ assignedToId }))).toBe(code);
  });

  it('rejects a collaborator whose membership is deleted', async () => {
    await prisma.$executeRaw`
      UPDATE collaborations SET deleted_at = now()
      WHERE person_id = ${DRIVER_ID}::uuid AND organization_id = ${SUPPLIER_ORG_ID}::uuid
    `;
    expect(await captureSqlCode(insertDelivery())).toBe('23514');
  });
});

describe('second delivery (AB-1, CWE-362)', () => {
  it('refuses a second in-progress delivery, even for another driver', async () => {
    await insertDelivery();
    expect(await captureSqlCode(insertDelivery({ id: SECOND_ID, assignedToId: SELLER_ID }))).toBe(
      '23505'
    );
  });

  it('lets only one of two concurrent inserts through', async () => {
    const results = await Promise.all([
      captureSqlCode(insertDelivery()),
      captureSqlCode(insertDelivery({ id: SECOND_ID, assignedToId: SELLER_ID })),
    ]);
    expect(results.filter((code) => code === undefined)).toHaveLength(1);
    expect(results.filter((code) => code === '23505')).toHaveLength(1);
  });
});
