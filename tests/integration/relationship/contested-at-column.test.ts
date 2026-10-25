import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const ORG_ID = '0199c027-0000-7000-8000-000000000001';
const CUSTOMER_ORG_ID = '0199c027-0000-7000-8000-000000000002';
const OWNER_ID = '0199c027-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c027-0000-7000-8000-000000000012';
const OTHER_ID = '0199c027-0000-7000-8000-000000000013';
const PERSON_REL_ID = '0199c027-0000-7000-8000-000000000021';
const ORG_REL_ID = '0199c027-0000-7000-8000-000000000022';
const COUNTER_ID = '0199c027-0000-7000-8000-000000000023';
const FIRST_ID = '0199c027-0000-7000-8000-000000000031';
const SECOND_ID = '0199c027-0000-7000-8000-000000000032';

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

function insertEntry(id: string, by: string): Promise<number> {
  return appPrisma.$executeRaw`
    INSERT INTO customer_relationship_reassignments (
      id, customer_relationship_id, previous_person_id, new_person_id,
      reassigned_by_id, reassigned_at
    ) VALUES (
      ${id}::uuid, ${PERSON_REL_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OTHER_ID}::uuid,
      ${by}::uuid, now()
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700027011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700027012',
        ...registered,
      },
      { id: OTHER_ID, fullName: 'Fixture Other', phoneNumber: '+2250700027013', ...registered },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${ORG_ID}::uuid, 'Fixture Supplier'), (${CUSTOMER_ORG_ID}::uuid, 'Fixture Customer Org')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_person_id, created_by_id
    ) VALUES (${PERSON_REL_ID}::uuid, ${ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_organization_id, created_by_id
    ) VALUES (${ORG_REL_ID}::uuid, ${ORG_ID}::uuid, ${CUSTOMER_ORG_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_label, created_by_id
    ) VALUES (${COUNTER_ID}::uuid, ${ORG_ID}::uuid, 'Client de passage', ${OWNER_ID}::uuid)
  `;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('customer_relationships.contested_at column (AC-1, C-57)', () => {
  it('is a nullable timestamptz and existing rows have it NULL', async () => {
    const columns = await prisma.$queryRaw<Array<{ data_type: string; is_nullable: string }>>`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'customer_relationships' AND column_name = 'contested_at'
    `;
    expect(columns).toEqual([{ data_type: 'timestamp with time zone', is_nullable: 'YES' }]);

    const marked = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM customer_relationships WHERE contested_at IS NOT NULL
    `;
    expect(marked[0].count).toBe(0n);
  });
});

describe('contested_at on a counter (AC-2, C-57)', () => {
  it('refuses the mark with 23514 and leaves the row unmarked', async () => {
    expect(
      await captureSqlCode(prisma.$executeRaw`
        UPDATE customer_relationships SET contested_at = now() WHERE id = ${COUNTER_ID}::uuid
      `)
    ).toBe('23514');

    const rows = await prisma.$queryRaw<Array<{ contested_at: Date | null }>>`
      SELECT contested_at FROM customer_relationships WHERE id = ${COUNTER_ID}::uuid
    `;
    expect(rows).toEqual([{ contested_at: null }]);
  });

  it('refuses a counter inserted already marked with 23514', async () => {
    expect(
      await captureSqlCode(prisma.$executeRaw`
        INSERT INTO customer_relationships (
          id, supplier_organization_id, customer_label, created_by_id, contested_at
        ) VALUES (
          ${SECOND_ID}::uuid, ${ORG_ID}::uuid, 'Autre', ${OWNER_ID}::uuid, now()
        )
      `)
    ).toBe('23514');
  });
});

describe('contested_at on a customer (AC-3)', () => {
  it('can be set and cleared on a relationship with a customer person', async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE customer_relationships SET contested_at = now() WHERE id = ${PERSON_REL_ID}::uuid
      `
    ).resolves.toBe(1);
    const marked = await prisma.$queryRaw<Array<{ contested_at: Date | null }>>`
      SELECT contested_at FROM customer_relationships WHERE id = ${PERSON_REL_ID}::uuid
    `;
    expect(marked[0].contested_at).toBeInstanceOf(Date);

    await expect(
      prisma.$executeRaw`
        UPDATE customer_relationships SET contested_at = NULL WHERE id = ${PERSON_REL_ID}::uuid
      `
    ).resolves.toBe(1);
  });

  it('can be set on a relationship with a customer organization', async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE customer_relationships SET contested_at = now() WHERE id = ${ORG_REL_ID}::uuid
      `
    ).resolves.toBe(1);
  });
});

describe('journal self-authored entries (AC-4, C-12)', () => {
  it('accepts two entries authored by the previous person for the same relationship', async () => {
    await expect(insertEntry(FIRST_ID, CUSTOMER_ID)).resolves.toBe(1);
    await expect(insertEntry(SECOND_ID, CUSTOMER_ID)).resolves.toBe(1);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE indexname = 'customer_relationship_reassignments_one_contestation_key'
    `;
    expect(indexes).toEqual([]);
  });
});

describe('journal stays immutable (AB-1, CWE-284)', () => {
  it('denies UPDATE and DELETE to the application account with 42501', async () => {
    await insertEntry(FIRST_ID, CUSTOMER_ID);

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
  });
});
