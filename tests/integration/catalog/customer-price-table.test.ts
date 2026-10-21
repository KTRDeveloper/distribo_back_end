import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { expectColumnType } from '../../helpers/db-schema';
import { seedProduct } from '../../helpers/catalog-fixtures.js';

const SUPPLIER_ORG_ID = '0199c002-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199c002-0000-7000-8000-000000000002';
const OWNER_ID = '0199c002-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c002-0000-7000-8000-000000000012';
const GUEST_ID = '0199c002-0000-7000-8000-000000000013';
const SUPPLIER_PERSON_ID = '0199c002-0000-7000-8000-000000000014';
const REL_ID = '0199c002-0000-7000-8000-000000000021';
const PERSON_SUPPLIER_REL_ID = '0199c002-0000-7000-8000-000000000022';
const PRODUCT_ID = '0199c002-0000-7000-8000-000000000031';
const FOREIGN_PRODUCT_ID = '0199c002-0000-7000-8000-000000000032';
const PRICE_ID = '0199c002-0000-7000-8000-000000000041';
const OTHER_PRICE_ID = '0199c002-0000-7000-8000-000000000042';
const UNKNOWN_ID = '0199c002-0000-7000-8000-0000000009ff';

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
  relationshipId?: string | null;
  productId?: string | null;
  price?: bigint | number | null;
  setById?: string | null;
  deletedAt?: Date | null;
};

/** Inserts a customer price; omitted fields take the valid fixture values. */
function insertPrice(row: Row = {}): Promise<number> {
  const relationship = 'relationshipId' in row ? row.relationshipId : REL_ID;
  const product = 'productId' in row ? row.productId : PRODUCT_ID;
  const price = 'price' in row ? row.price : 2500;
  const setBy = 'setById' in row ? row.setById : OWNER_ID;
  return prisma.$executeRaw`
    INSERT INTO customer_prices (
      id, customer_relationship_id, product_id, price, set_by_id, deleted_at
    )
    VALUES (
      ${row.id ?? PRICE_ID}::uuid, ${relationship}::uuid, ${product}::uuid,
      ${price}::bigint, ${setBy}::uuid, ${row.deletedAt ?? null}::timestamptz
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700002011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700002012',
        ...registered,
      },
      {
        id: SUPPLIER_PERSON_ID,
        fullName: 'Fixture Person Supplier',
        phoneNumber: '+2250700002014',
        ...registered,
      },
      { id: GUEST_ID, phoneNumber: '+2250700002013' },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier'), (${OTHER_ORG_ID}::uuid, 'Fixture Other Business')
  `;
  await seedProduct(prisma, {
    id: PRODUCT_ID,
    organizationId: SUPPLIER_ORG_ID,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: FOREIGN_PRODUCT_ID,
    organizationId: OTHER_ORG_ID,
    name: 'Fixture Oil',
    unit: 'can',
    price: 1500n,
  });
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_person_id, customer_person_id, created_by_id, status
    )
    VALUES (
      ${PERSON_SUPPLIER_REL_ID}::uuid, ${SUPPLIER_PERSON_ID}::uuid, ${CUSTOMER_ID}::uuid,
      ${CUSTOMER_ID}::uuid, 'PENDING'
    )
  `;
});

describe('customer_prices row (AC-1, C-01, C-35)', () => {
  it('stores set_at and server_updated_at with the expected column types', async () => {
    expect(await insertPrice()).toBe(1);

    const [row] = await prisma.$queryRaw<
      Array<{
        price: bigint;
        set_at: Date;
        server_updated_at: Date;
        deleted_at: Date | null;
      }>
    >`
      SELECT price, set_at, server_updated_at, deleted_at
      FROM customer_prices WHERE id = ${PRICE_ID}::uuid
    `;
    expect(row.price).toBe(2500n);
    expect(row.set_at).toBeInstanceOf(Date);
    expect(row.server_updated_at).toBeInstanceOf(Date);
    expect(row.deleted_at).toBeNull();

    for (const column of ['id', 'customer_relationship_id', 'product_id', 'set_by_id']) {
      await expectColumnType('customer_prices', column, 'uuid');
    }
    await expectColumnType('customer_prices', 'price', 'bigint');
    for (const column of ['set_at', 'server_updated_at', 'deleted_at']) {
      await expectColumnType('customer_prices', column, 'timestamptz');
    }
  });

  it('moves server_updated_at forward on update', async () => {
    await insertPrice();
    const read = () =>
      prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
        SELECT server_updated_at FROM customer_prices WHERE id = ${PRICE_ID}::uuid
      `;
    const [before] = await read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await prisma.$executeRaw`UPDATE customer_prices SET price = 2600 WHERE id = ${PRICE_ID}::uuid`;
    const [after] = await read();
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
  });
});

describe('customer_prices uniqueness (AC-2, C-11)', () => {
  it('rejects a second live price for the same relationship and product with 23505', async () => {
    await insertPrice();
    expect(await captureSqlCode(insertPrice({ id: OTHER_PRICE_ID }))).toBe('23505');
  });

  it('accepts a second price when the first is deleted', async () => {
    await insertPrice({ deletedAt: new Date('2026-02-01T00:00:00.000Z') });
    await expect(insertPrice({ id: OTHER_PRICE_ID })).resolves.toBe(1);
  });

  it('rejects restoring a deleted price while a live one exists with 23505', async () => {
    await insertPrice({ deletedAt: new Date('2026-02-01T00:00:00.000Z') });
    await insertPrice({ id: OTHER_PRICE_ID });
    expect(
      await captureSqlCode(
        prisma.$executeRaw`UPDATE customer_prices SET deleted_at = NULL WHERE id = ${PRICE_ID}::uuid`
      )
    ).toBe('23505');
  });
});

describe('customer_prices product ownership (AC-3, AB-1, C-11)', () => {
  it('rejects a product of another organization with 23514', async () => {
    expect(await captureSqlCode(insertPrice({ productId: FOREIGN_PRODUCT_ID }))).toBe('23514');
  });

  it('rejects a relationship whose supplier is a person with 23514', async () => {
    expect(await captureSqlCode(insertPrice({ relationshipId: PERSON_SUPPLIER_REL_ID }))).toBe(
      '23514'
    );
  });

  it('rejects moving an existing price to a foreign product with 23514', async () => {
    await insertPrice();
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          UPDATE customer_prices SET product_id = ${FOREIGN_PRODUCT_ID}::uuid
          WHERE id = ${PRICE_ID}::uuid
        `
      )
    ).toBe('23514');
  });
});

describe('customer_prices author and keys (AC-4, C-04)', () => {
  it('rejects set_by_id of a guest with 23514', async () => {
    expect(await captureSqlCode(insertPrice({ setById: GUEST_ID }))).toBe('23514');
  });

  it('rejects an unknown relationship, product or author with 23503', async () => {
    expect(await captureSqlCode(insertPrice({ relationshipId: UNKNOWN_ID }))).toBe('23503');
    expect(await captureSqlCode(insertPrice({ productId: UNKNOWN_ID }))).toBe('23503');
    expect(await captureSqlCode(insertPrice({ setById: UNKNOWN_ID }))).toBe('23503');
  });

  it('rejects a null relationship, product, price or author with 23502', async () => {
    expect(await captureSqlCode(insertPrice({ relationshipId: null }))).toBe('23502');
    expect(await captureSqlCode(insertPrice({ productId: null }))).toBe('23502');
    expect(await captureSqlCode(insertPrice({ price: null }))).toBe('23502');
    expect(await captureSqlCode(insertPrice({ setById: null }))).toBe('23502');
  });
});
