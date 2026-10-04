import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const ORG_ID = '0199c006-0000-7000-8000-000000000001';
const OWNER_ID = '0199c006-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c006-0000-7000-8000-000000000012';
const GUEST_ID = '0199c006-0000-7000-8000-000000000013';
const REL_ID = '0199c006-0000-7000-8000-000000000021';
const UNKNOWN_REL_ID = '0199c006-0000-7000-8000-0000000009ff';
const CHANGE_ID = '0199c006-0000-7000-8000-000000000031';

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

/** Inserts a journal row as the application account; null leaves a limit empty. */
function insertChange(
  row: {
    relationshipId?: string;
    previous?: number | null;
    next?: number | null;
    setById?: string;
  } = {}
): Promise<number> {
  const previous = 'previous' in row ? row.previous : 0;
  const next = 'next' in row ? row.next : 50000;
  return appPrisma.$executeRaw`
    INSERT INTO credit_limit_changes (
      id, customer_relationship_id, previous_limit, new_limit, set_by_id, set_at
    ) VALUES (
      ${CHANGE_ID}::uuid, ${row.relationshipId ?? REL_ID}::uuid,
      ${previous}::bigint, ${next}::bigint, ${row.setById ?? OWNER_ID}::uuid, now()
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700006011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700006012',
        ...registered,
      },
      { id: GUEST_ID, phoneNumber: '+2250700006013' },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Supplier')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_person_id, created_by_id
    ) VALUES (${REL_ID}::uuid, ${ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('credit_limit_changes add and read (AC-1, C-35)', () => {
  it('lets the application account insert and read a row with server time', async () => {
    await expect(insertChange()).resolves.toBe(1);

    const rows = await appPrisma.$queryRaw<
      Array<{
        customer_relationship_id: string;
        previous_limit: bigint | null;
        new_limit: bigint | null;
        set_by_id: string;
        server_updated_at: Date;
      }>
    >`
      SELECT customer_relationship_id, previous_limit, new_limit, set_by_id, server_updated_at
      FROM credit_limit_changes WHERE id = ${CHANGE_ID}::uuid
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customer_relationship_id: REL_ID,
      previous_limit: 0n,
      new_limit: 50000n,
      set_by_id: OWNER_ID,
    });
    expect(Math.abs(Date.now() - rows[0].server_updated_at.getTime())).toBeLessThan(5_000);
  });

  it('rejects a row without set_by_id, set_at or relationship with 23502', async () => {
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO credit_limit_changes (id, customer_relationship_id, set_at)
        VALUES (${CHANGE_ID}::uuid, ${REL_ID}::uuid, now())
      `)
    ).toBe('23502');
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO credit_limit_changes (id, set_by_id, set_at)
        VALUES (${CHANGE_ID}::uuid, ${OWNER_ID}::uuid, now())
      `)
    ).toBe('23502');
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO credit_limit_changes (id, customer_relationship_id, set_by_id, set_at)
        VALUES (${CHANGE_ID}::uuid, ${REL_ID}::uuid, ${OWNER_ID}::uuid, NULL)
      `)
    ).toBe('23502');
  });
});

describe('credit_limit_changes immutability (AC-2, AB-1, C-32, C-39)', () => {
  it('denies UPDATE, DELETE and TRUNCATE with 42501 and keeps the row unchanged', async () => {
    await insertChange();

    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        UPDATE credit_limit_changes SET new_limit = 999999 WHERE id = ${CHANGE_ID}::uuid
      `)
    ).toBe('42501');
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        DELETE FROM credit_limit_changes WHERE id = ${CHANGE_ID}::uuid
      `)
    ).toBe('42501');
    expect(await captureSqlCode(appPrisma.$executeRaw`TRUNCATE TABLE credit_limit_changes`)).toBe(
      '42501'
    );

    const rows = await prisma.$queryRaw<Array<{ new_limit: bigint }>>`
      SELECT new_limit FROM credit_limit_changes WHERE id = ${CHANGE_ID}::uuid
    `;
    expect(rows).toEqual([{ new_limit: 50000n }]);
  });
});

describe('credit_limit_changes empty limits (AC-3)', () => {
  it.each([
    [0, 50000],
    [50000, null],
    [null, 100000],
  ])('accepts previous %s and new %s', async (previous, next) => {
    await expect(insertChange({ previous, next })).resolves.toBe(1);

    const rows = await prisma.$queryRaw<
      Array<{ previous_limit: bigint | null; new_limit: bigint | null }>
    >`
      SELECT previous_limit, new_limit FROM credit_limit_changes WHERE id = ${CHANGE_ID}::uuid
    `;
    expect(rows).toEqual([
      {
        previous_limit: previous === null ? null : BigInt(previous),
        new_limit: next === null ? null : BigInt(next),
      },
    ]);
  });
});

describe('credit_limit_changes author and relationship (AC-4, C-04)', () => {
  it('rejects a guest as set_by_id with 23514', async () => {
    expect(await captureSqlCode(insertChange({ setById: GUEST_ID }))).toBe('23514');
  });

  it('rejects an unknown relationship with 23503', async () => {
    expect(await captureSqlCode(insertChange({ relationshipId: UNKNOWN_REL_ID }))).toBe('23503');
  });
});
