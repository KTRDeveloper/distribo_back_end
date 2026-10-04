import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { expectColumnType } from '../../helpers/db-schema';

const SUPPLIER_ORG_ID = '0199c004-0000-7000-8000-000000000001';
const CUSTOMER_ORG_ID = '0199c004-0000-7000-8000-000000000002';
const OWNER_ID = '0199c004-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c004-0000-7000-8000-000000000012';
const GUEST_ID = '0199c004-0000-7000-8000-000000000013';
const REL_ID = '0199c004-0000-7000-8000-000000000021';
const OTHER_REL_ID = '0199c004-0000-7000-8000-000000000022';
const UNKNOWN_ID = '0199c004-0000-7000-8000-0000000009ff';

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
  supplierOrganizationId?: string | null;
  customerPersonId?: string | null;
  status?: string | null;
  endedByParty?: string | null;
  createdById?: string | null;
  creditLimitSetById?: string | null;
  mergedIntoId?: string | null;
};

/** Inserts a relationship; omitted status and ended_by_party use the column defaults. */
function insertRelationship(row: Row = {}): Promise<number> {
  const supplier = 'supplierOrganizationId' in row ? row.supplierOrganizationId : SUPPLIER_ORG_ID;
  const customer = 'customerPersonId' in row ? row.customerPersonId : CUSTOMER_ID;
  const createdBy = 'createdById' in row ? row.createdById : OWNER_ID;
  return prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_person_id, created_by_id,
      status, ended_by_party, credit_limit_set_by_id, merged_into_id
    )
    VALUES (
      ${row.id ?? REL_ID}::uuid, ${supplier}::uuid, ${customer}::uuid, ${createdBy}::uuid,
      COALESCE(${row.status ?? null}::text, 'ACTIVE')::public."RelationshipStatus",
      ${row.endedByParty ?? null}::text::public."RelationshipParty",
      ${row.creditLimitSetById ?? null}::uuid, ${row.mergedIntoId ?? null}::uuid
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700004011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700004012',
        ...registered,
      },
      { id: GUEST_ID, phoneNumber: '+2250700004013' },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier'), (${CUSTOMER_ORG_ID}::uuid, 'Fixture Customer Business')
  `;
});

describe('customer_relationships defaults and types (AC-1, C-01, C-35)', () => {
  it('applies defaults and uses the expected column types', async () => {
    expect(await insertRelationship()).toBe(1);

    const [row] = await prisma.$queryRaw<
      Array<{
        status: string;
        balance: bigint;
        created_at: Date;
        server_updated_at: Date;
        deleted_at: Date | null;
        credit_limit: bigint | null;
        merged_into_id: string | null;
      }>
    >`
      SELECT status::text AS status, balance, created_at, server_updated_at, deleted_at,
             credit_limit, merged_into_id
      FROM customer_relationships WHERE id = ${REL_ID}::uuid
    `;
    expect(row.status).toBe('ACTIVE');
    expect(row.balance).toBe(0n);
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.server_updated_at).toBeInstanceOf(Date);
    expect(row.deleted_at).toBeNull();
    expect(row.credit_limit).toBeNull();
    expect(row.merged_into_id).toBeNull();

    for (const column of [
      'id',
      'supplier_organization_id',
      'supplier_person_id',
      'customer_person_id',
      'customer_organization_id',
      'credit_limit_set_by_id',
      'created_by_id',
      'merged_into_id',
    ]) {
      await expectColumnType('customer_relationships', column, 'uuid');
    }
    for (const column of ['balance', 'credit_limit']) {
      await expectColumnType('customer_relationships', column, 'bigint');
    }
    for (const column of ['credit_limit_set_at', 'created_at', 'server_updated_at', 'deleted_at']) {
      await expectColumnType('customer_relationships', column, 'timestamptz');
    }
  });

  it('moves server_updated_at forward on update', async () => {
    await insertRelationship();
    const read = () =>
      prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
        SELECT server_updated_at FROM customer_relationships WHERE id = ${REL_ID}::uuid
      `;
    const [before] = await read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await prisma.$executeRaw`UPDATE customer_relationships SET balance = 5 WHERE id = ${REL_ID}::uuid`;
    const [after] = await read();
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
  });

  it('has an index on each party column', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'customer_relationships'
    `;
    for (const column of [
      'supplier_organization_id',
      'supplier_person_id',
      'customer_person_id',
      'customer_organization_id',
    ]) {
      expect(
        rows.some((r) => r.indexdef.includes(`(${column})`)),
        column
      ).toBe(true);
    }
  });
});

describe('customer_relationships enums and keys (AC-2)', () => {
  it('accepts status ENDED with ended_by_party CUSTOMER', async () => {
    await expect(insertRelationship({ status: 'ENDED', endedByParty: 'CUSTOMER' })).resolves.toBe(
      1
    );
  });

  it('rejects status "BLOCKED" with 22P02', async () => {
    expect(await captureSqlCode(insertRelationship({ status: 'BLOCKED' }))).toBe('22P02');
  });

  it('rejects ended_by_party "PLATFORM" with 22P02', async () => {
    expect(await captureSqlCode(insertRelationship({ endedByParty: 'PLATFORM' }))).toBe('22P02');
  });

  it('rejects an unknown supplier organization with 23503', async () => {
    expect(await captureSqlCode(insertRelationship({ supplierOrganizationId: UNKNOWN_ID }))).toBe(
      '23503'
    );
  });

  it('rejects an unknown customer person with 23503', async () => {
    expect(await captureSqlCode(insertRelationship({ customerPersonId: UNKNOWN_ID }))).toBe(
      '23503'
    );
  });

  it('rejects an unknown merged_into_id with 23503 and accepts an existing one', async () => {
    expect(await captureSqlCode(insertRelationship({ mergedIntoId: UNKNOWN_ID }))).toBe('23503');
    await insertRelationship();
    await expect(
      insertRelationship({ id: OTHER_REL_ID, customerPersonId: null, mergedIntoId: REL_ID })
    ).resolves.toBe(1);
  });

  it('rejects created_by_id of a guest with 23514', async () => {
    expect(await captureSqlCode(insertRelationship({ createdById: GUEST_ID }))).toBe('23514');
  });

  it('rejects credit_limit_set_by_id of a guest with 23514', async () => {
    expect(await captureSqlCode(insertRelationship({ creditLimitSetById: GUEST_ID }))).toBe(
      '23514'
    );
  });

  it('accepts credit_limit_set_by_id of a registered person', async () => {
    await expect(insertRelationship({ creditLimitSetById: OWNER_ID })).resolves.toBe(1);
  });
});

describe('customer_relationships required columns (AC-3)', () => {
  it('rejects a null created_by_id with 23502', async () => {
    expect(await captureSqlCode(insertRelationship({ createdById: null }))).toBe('23502');
  });

  it('rejects a null status and a null balance with 23502', async () => {
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO customer_relationships (id, supplier_organization_id, created_by_id, status)
          VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${OWNER_ID}::uuid, NULL)
        `
      )
    ).toBe('23502');
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO customer_relationships (id, supplier_organization_id, created_by_id, balance)
          VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${OWNER_ID}::uuid, NULL)
        `
      )
    ).toBe('23502');
  });
});
