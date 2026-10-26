import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { upsertCustomerPrice } from '../../../src/modules/catalog/catalog.repository';

const ORG_A = '0199c015-0000-7000-8000-000000000001';
const ORG_B = '0199c015-0000-7000-8000-000000000002';
const OWNER = '0199c015-0000-7000-8000-000000000011';
const CUSTOMER = '0199c015-0000-7000-8000-000000000012';
const REL_A = '0199c015-0000-7000-8000-000000000021';
const REL_PERSON = '0199c015-0000-7000-8000-000000000022';
const PRODUCT = '0199c015-0000-7000-8000-000000000031';
const PRODUCT_NO_VARIANT = '0199c015-0000-7000-8000-000000000032';
const PRODUCT_B = '0199c015-0000-7000-8000-000000000033';
const VARIANT = PRODUCT; // CAT-013: the first variant has the id of its product
const VARIANT_2 = '0199c015-0000-7000-8000-000000000041';
const VARIANT_B = PRODUCT_B;
const PRICE_1 = '0199c015-0000-7000-8000-000000000051';
const PRICE_2 = '0199c015-0000-7000-8000-000000000052';
const PRICE_3 = '0199c015-0000-7000-8000-000000000053';
const UNKNOWN_ID = '0199c015-0000-7000-8000-0000000009ff';

const MIGRATION = join(
  __dirname,
  '../../../prisma/migrations/20261019050000_cat_015_customer_price_variant/migration.sql'
);

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

/** The statements of the migration between the `-- copy start` and `-- copy end` lines. */
function copyStatements(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('-- copy start');
  const end = sql.indexOf('-- copy end');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql
    .slice(start + '-- copy start'.length, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Replays the copy in one transaction, as the migration does. */
async function runCopy() {
  const statements = copyStatements();
  await prisma.$transaction(async (tx) => {
    for (const statement of statements) {
      await tx.$executeRawUnsafe(statement);
    }
  });
}

type PriceRow = { id: string; product_id: string; product_variant_id: string | null };

/** Inserts a price; `variant` is left out of the statement when it is `undefined`. */
function insertPrice(
  id: string,
  options: {
    product?: string;
    variant?: string | null;
    relationship?: string;
    deletedAt?: Date | null;
    price?: number;
  } = {}
): Promise<number> {
  const product = options.product ?? PRODUCT;
  const relationship = options.relationship ?? REL_A;
  const price = options.price ?? 2500;
  const deletedAt = options.deletedAt ?? null;
  if (options.variant === undefined) {
    return prisma.$executeRaw`
      INSERT INTO customer_prices (id, customer_relationship_id, product_id, price, set_by_id, deleted_at)
      VALUES (${id}::uuid, ${relationship}::uuid, ${product}::uuid, ${price}::bigint,
              ${OWNER}::uuid, ${deletedAt}::timestamptz)
    `;
  }
  return prisma.$executeRaw`
    INSERT INTO customer_prices (
      id, customer_relationship_id, product_id, product_variant_id, price, set_by_id, deleted_at
    )
    VALUES (${id}::uuid, ${relationship}::uuid, ${product}::uuid, ${options.variant}::uuid,
            ${price}::bigint, ${OWNER}::uuid, ${deletedAt}::timestamptz)
  `;
}

function readPrice(id: string) {
  return prisma.$queryRaw<Array<PriceRow & { server_updated_at: Date; price: bigint }>>`
    SELECT id::text, product_id::text, product_variant_id::text, price, server_updated_at
    FROM customer_prices WHERE id = ${id}::uuid
  `.then((rows) => rows[0]);
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
      { id: OWNER, fullName: 'Fixture Owner', phoneNumber: '+2250700015011', ...registered },
      { id: CUSTOMER, fullName: 'Fixture Customer', phoneNumber: '+2250700015012', ...registered },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${ORG_A}::uuid, 'Fixture Business A'), (${ORG_B}::uuid, 'Fixture Business B')
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name)
    VALUES
      (${PRODUCT}::uuid, ${ORG_A}::uuid, 'Fixture Rice'),
      (${PRODUCT_NO_VARIANT}::uuid, ${ORG_A}::uuid, 'Fixture Flour'),
      (${PRODUCT_B}::uuid, ${ORG_B}::uuid, 'Fixture Oil')
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price)
    VALUES
      (${VARIANT}::uuid, ${PRODUCT}::uuid, ${ORG_A}::uuid, NULL, 'sack', 3000),
      (${VARIANT_2}::uuid, ${PRODUCT}::uuid, ${ORG_A}::uuid, 'Small', 'bag', 800),
      (${VARIANT_B}::uuid, ${PRODUCT_B}::uuid, ${ORG_B}::uuid, NULL, 'can', 1500)
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_A}::uuid, ${ORG_A}::uuid, ${CUSTOMER}::uuid, ${OWNER}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_person_id, customer_person_id, created_by_id, status
    )
    VALUES (${REL_PERSON}::uuid, ${OWNER}::uuid, ${CUSTOMER}::uuid, ${CUSTOMER}::uuid, 'PENDING')
  `;
});

describe('customer price variant', () => {
  it('AC-1 copy: gives each price the variant of its product and moves server_updated_at', async () => {
    // A price of a product that had no variant when it was written stays empty.
    await insertPrice(PRICE_1, { product: PRODUCT_NO_VARIANT });
    expect((await readPrice(PRICE_1)).product_variant_id).toBeNull();
    await prisma.$executeRaw`
      INSERT INTO product_variants (id, product_id, organization_id, unit, price)
      VALUES (${PRODUCT_NO_VARIANT}::uuid, ${PRODUCT_NO_VARIANT}::uuid, ${ORG_A}::uuid, 'bag', 500)
    `;
    const before = await readPrice(PRICE_1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await runCopy();

    const after = await readPrice(PRICE_1);
    expect(after.product_variant_id).toBe(PRODUCT_NO_VARIANT);
    expect(after.product_variant_id).toBe(after.product_id);
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
  });

  it('copy: a second run changes nothing and a price without a variant stays empty', async () => {
    await insertPrice(PRICE_1, { product: PRODUCT_NO_VARIANT });
    await runCopy();
    expect((await readPrice(PRICE_1)).product_variant_id).toBeNull();

    await insertPrice(PRICE_2);
    const before = await readPrice(PRICE_2);
    await runCopy();
    const after = await readPrice(PRICE_2);
    expect(after.server_updated_at.getTime()).toBe(before.server_updated_at.getTime());
  });

  it('AC-2 old insert: product_id only gets the variant that has its id', async () => {
    expect(await insertPrice(PRICE_1)).toBe(1);

    const row = await readPrice(PRICE_1);
    expect(row.product_variant_id).toBe(PRODUCT);
    expect(row.product_variant_id).toBe(row.product_id);
  });

  it('old insert: a given variant is kept', async () => {
    await insertPrice(PRICE_1, { variant: VARIANT_2 });

    expect((await readPrice(PRICE_1)).product_variant_id).toBe(VARIANT_2);
  });

  describe('AC-3 one live price per customer and variant', () => {
    it('rejects the same variant while the first price is live (23505)', async () => {
      await insertPrice(PRICE_1, { variant: VARIANT });
      expect(await captureSqlCode(insertPrice(PRICE_2, { variant: VARIANT }))).toBe('23505');
    });

    it('accepts the same variant when the first price is deleted', async () => {
      await insertPrice(PRICE_1, { variant: VARIANT, deletedAt: new Date('2026-02-01T00:00:00Z') });
      await expect(insertPrice(PRICE_2, { variant: VARIANT })).resolves.toBe(1);
    });

    it('accepts another variant of the same product while the first price is live', async () => {
      await insertPrice(PRICE_1, { variant: VARIANT });
      await expect(insertPrice(PRICE_2, { variant: VARIANT_2 })).resolves.toBe(1);
    });

    it('rejects an old-style repeat for the same product (23505)', async () => {
      await insertPrice(PRICE_1);
      expect(await captureSqlCode(insertPrice(PRICE_2))).toBe('23505');
    });
  });

  it('AC-4 replace: upserting the same pair twice keeps one row with the new price', async () => {
    await prisma.$transaction((tx) =>
      upsertCustomerPrice(tx, {
        id: PRICE_1,
        relationshipId: REL_A,
        productId: PRODUCT,
        price: 2800n,
        setById: OWNER,
      })
    );
    const result = await prisma.$transaction((tx) =>
      upsertCustomerPrice(tx, {
        id: PRICE_2,
        relationshipId: REL_A,
        productId: PRODUCT,
        price: 3200n,
        setById: OWNER,
      })
    );

    expect(result).toMatchObject({ productId: PRODUCT, price: 3200n, setById: OWNER });
    const rows = await prisma.$queryRaw<Array<{ id: string; price: bigint }>>`
      SELECT id::text, price FROM customer_prices
      WHERE customer_relationship_id = ${REL_A}::uuid AND deleted_at IS NULL
    `;
    expect(rows).toEqual([{ id: PRICE_1, price: 3200n }]);
  });

  it('replace: a product without a variant still keeps one live row', async () => {
    for (const [id, price] of [
      [PRICE_1, 100n],
      [PRICE_2, 200n],
    ] as const) {
      await prisma.$transaction((tx) =>
        upsertCustomerPrice(tx, {
          id,
          relationshipId: REL_A,
          productId: PRODUCT_NO_VARIANT,
          price,
          setById: OWNER,
        })
      );
    }

    const rows = await prisma.$queryRaw<Array<{ id: string; price: bigint }>>`
      SELECT id::text, price FROM customer_prices
      WHERE customer_relationship_id = ${REL_A}::uuid AND deleted_at IS NULL
    `;
    expect(rows).toEqual([{ id: PRICE_1, price: 200n }]);
  });

  it('AC-5 keys: an unknown variant is rejected (23503)', async () => {
    expect(await captureSqlCode(insertPrice(PRICE_1, { variant: UNKNOWN_ID }))).toBe('23503');
  });
});

describe('customer price variant, security', () => {
  it('AB-1 crafted write: a variant of another business is rejected (23514)', async () => {
    expect(await captureSqlCode(insertPrice(PRICE_1, { variant: VARIANT_B }))).toBe('23514');
  });

  it('crafted write: moving a price to another business variant is rejected (23514)', async () => {
    await insertPrice(PRICE_1, { variant: VARIANT });
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          UPDATE customer_prices SET product_variant_id = ${VARIANT_B}::uuid WHERE id = ${PRICE_1}::uuid
        `
      )
    ).toBe('23514');
  });

  it('crafted write: a relationship supplied by a person holds no variant price (23514)', async () => {
    expect(
      await captureSqlCode(insertPrice(PRICE_3, { variant: VARIANT, relationship: REL_PERSON }))
    ).toBe('23514');
  });
});
