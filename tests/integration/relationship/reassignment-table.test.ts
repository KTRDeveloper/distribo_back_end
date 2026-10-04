import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const ORG_ID = '0199c014-0000-7000-8000-000000000001';
const OWNER_ID = '0199c014-0000-7000-8000-000000000011';
const PREVIOUS_ID = '0199c014-0000-7000-8000-000000000012';
const NEW_ID = '0199c014-0000-7000-8000-000000000013';
const GUEST_ID = '0199c014-0000-7000-8000-000000000014';
const REL_ID = '0199c014-0000-7000-8000-000000000021';
const OTHER_REL_ID = '0199c014-0000-7000-8000-000000000022';
const UNKNOWN_REL_ID = '0199c014-0000-7000-8000-0000000009ff';
const FIRST_ID = '0199c014-0000-7000-8000-000000000031';
const SECOND_ID = '0199c014-0000-7000-8000-000000000032';

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

/** Inserts a journal row as the application account; defaults describe a correction by the owner. */
function insertReassignment(
  row: {
    id?: string;
    relationshipId?: string;
    previous?: string;
    next?: string | null;
    by?: string;
  } = {}
): Promise<number> {
  const next = 'next' in row ? row.next : NEW_ID;
  return appPrisma.$executeRaw`
    INSERT INTO customer_relationship_reassignments (
      id, customer_relationship_id, previous_person_id, new_person_id,
      reassigned_by_id, reason, reassigned_at
    ) VALUES (
      ${row.id ?? FIRST_ID}::uuid, ${row.relationshipId ?? REL_ID}::uuid,
      ${row.previous ?? PREVIOUS_ID}::uuid, ${next}::uuid,
      ${row.by ?? OWNER_ID}::uuid, 'fixture reason', now()
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700014011', ...registered },
      {
        id: PREVIOUS_ID,
        fullName: 'Fixture Previous',
        phoneNumber: '+2250700014012',
        ...registered,
      },
      { id: NEW_ID, fullName: 'Fixture New', phoneNumber: '+2250700014013', ...registered },
      { id: GUEST_ID, phoneNumber: '+2250700014014' },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Supplier')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_person_id, created_by_id
    ) VALUES (${REL_ID}::uuid, ${ORG_ID}::uuid, ${PREVIOUS_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_person_id, created_by_id
    ) VALUES (${OTHER_REL_ID}::uuid, ${ORG_ID}::uuid, ${NEW_ID}::uuid, ${OWNER_ID}::uuid)
  `;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('customer_relationship_reassignments add and read (AC-1, C-35)', () => {
  it('lets the application account insert and read a row with server time', async () => {
    await expect(insertReassignment()).resolves.toBe(1);

    const rows = await appPrisma.$queryRaw<
      Array<{
        customer_relationship_id: string;
        previous_person_id: string;
        new_person_id: string;
        reassigned_by_id: string;
        reason: string | null;
        server_updated_at: Date;
      }>
    >`
      SELECT customer_relationship_id, previous_person_id, new_person_id, reassigned_by_id,
             reason, server_updated_at
      FROM customer_relationship_reassignments WHERE id = ${FIRST_ID}::uuid
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customer_relationship_id: REL_ID,
      previous_person_id: PREVIOUS_ID,
      new_person_id: NEW_ID,
      reassigned_by_id: OWNER_ID,
      reason: 'fixture reason',
    });
    expect(Math.abs(Date.now() - rows[0].server_updated_at.getTime())).toBeLessThan(5_000);
  });

  it('accepts an empty reason', async () => {
    await expect(
      appPrisma.$executeRaw`
        INSERT INTO customer_relationship_reassignments (
          id, customer_relationship_id, previous_person_id, new_person_id,
          reassigned_by_id, reassigned_at
        ) VALUES (
          ${FIRST_ID}::uuid, ${REL_ID}::uuid, ${PREVIOUS_ID}::uuid, ${NEW_ID}::uuid,
          ${OWNER_ID}::uuid, now()
        )
      `
    ).resolves.toBe(1);
  });
});

describe('customer_relationship_reassignments immutability (AC-2, AB-1, C-32, C-39)', () => {
  it('denies UPDATE, DELETE and TRUNCATE with 42501 and keeps the row unchanged', async () => {
    await insertReassignment();

    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        UPDATE customer_relationship_reassignments SET reason = 'edited'
        WHERE id = ${FIRST_ID}::uuid
      `)
    ).toBe('42501');
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        DELETE FROM customer_relationship_reassignments WHERE id = ${FIRST_ID}::uuid
      `)
    ).toBe('42501');
    expect(
      await captureSqlCode(
        appPrisma.$executeRaw`TRUNCATE TABLE customer_relationship_reassignments`
      )
    ).toBe('42501');

    const rows = await prisma.$queryRaw<Array<{ reason: string }>>`
      SELECT reason FROM customer_relationship_reassignments WHERE id = ${FIRST_ID}::uuid
    `;
    expect(rows).toEqual([{ reason: 'fixture reason' }]);
  });
});

describe('customer_relationship_reassignments contestation rule (AC-3, C-12)', () => {
  it('rejects a second contestation by the same previous person with 23505', async () => {
    await insertReassignment({ by: PREVIOUS_ID });

    expect(
      await captureSqlCode(insertReassignment({ id: SECOND_ID, by: PREVIOUS_ID, next: OWNER_ID }))
    ).toBe('23505');
  });

  it('accepts a correction after a contestation', async () => {
    await insertReassignment({ by: PREVIOUS_ID });

    await expect(insertReassignment({ id: SECOND_ID, by: OWNER_ID })).resolves.toBe(1);
  });

  it('accepts several corrections for the same previous person', async () => {
    await insertReassignment({ by: OWNER_ID });

    await expect(insertReassignment({ id: SECOND_ID, by: OWNER_ID })).resolves.toBe(1);
  });

  it('accepts a contestation after a correction', async () => {
    await insertReassignment({ by: OWNER_ID });

    await expect(insertReassignment({ id: SECOND_ID, by: PREVIOUS_ID })).resolves.toBe(1);
  });

  it('allows one contestation per relationship and per previous person', async () => {
    await insertReassignment({ by: PREVIOUS_ID });

    await expect(
      insertReassignment({ id: SECOND_ID, relationshipId: OTHER_REL_ID, by: PREVIOUS_ID })
    ).resolves.toBe(1);
    await expect(
      insertReassignment({
        id: '0199c014-0000-7000-8000-000000000033',
        previous: NEW_ID,
        next: OWNER_ID,
        by: NEW_ID,
      })
    ).resolves.toBe(1);
  });
});

describe('customer_relationship_reassignments required and keys (AC-4, C-04)', () => {
  it('rejects a missing new person with 23502', async () => {
    expect(await captureSqlCode(insertReassignment({ next: null }))).toBe('23502');
  });

  it('rejects a missing previous person, author or time with 23502', async () => {
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO customer_relationship_reassignments (
          id, customer_relationship_id, new_person_id, reassigned_by_id, reassigned_at
        ) VALUES (
          ${FIRST_ID}::uuid, ${REL_ID}::uuid, ${NEW_ID}::uuid, ${OWNER_ID}::uuid, now()
        )
      `)
    ).toBe('23502');
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO customer_relationship_reassignments (
          id, customer_relationship_id, previous_person_id, new_person_id, reassigned_at
        ) VALUES (
          ${FIRST_ID}::uuid, ${REL_ID}::uuid, ${PREVIOUS_ID}::uuid, ${NEW_ID}::uuid, now()
        )
      `)
    ).toBe('23502');
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO customer_relationship_reassignments (
          id, customer_relationship_id, previous_person_id, new_person_id,
          reassigned_by_id, reassigned_at
        ) VALUES (
          ${FIRST_ID}::uuid, ${REL_ID}::uuid, ${PREVIOUS_ID}::uuid, ${NEW_ID}::uuid,
          ${OWNER_ID}::uuid, NULL
        )
      `)
    ).toBe('23502');
  });

  it('rejects an unknown relationship with 23503', async () => {
    expect(await captureSqlCode(insertReassignment({ relationshipId: UNKNOWN_REL_ID }))).toBe(
      '23503'
    );
  });

  it('rejects a guest as reassigned_by_id with 23514', async () => {
    expect(await captureSqlCode(insertReassignment({ by: GUEST_ID }))).toBe('23514');
  });
});
