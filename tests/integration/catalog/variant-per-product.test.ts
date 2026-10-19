import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const ORG_A = '0199c013-0000-7000-8000-0000000000a1';
const ORG_B = '0199c013-0000-7000-8000-0000000000a2';
const PRODUCT_PRICED = '0199c013-0000-7000-8000-0000000000b1';
const PRODUCT_DELETED = '0199c013-0000-7000-8000-0000000000b2';
const PRODUCT_OTHER_BUSINESS = '0199c013-0000-7000-8000-0000000000b3';
const PRODUCT_WITH_VARIANT = '0199c013-0000-7000-8000-0000000000b4';
const EXISTING_VARIANT = '0199c013-0000-7000-8000-0000000000c4';
const PRODUCT_IDS = [PRODUCT_PRICED, PRODUCT_DELETED, PRODUCT_OTHER_BUSINESS, PRODUCT_WITH_VARIANT];

const MIGRATION = join(
  __dirname,
  '../../../prisma/migrations/20261019040000_cat_013_variant_per_product/migration.sql'
);

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

type VariantRow = {
  id: string;
  product_id: string;
  organization_id: string;
  name: string | null;
  unit: string;
  price: bigint;
  price_updated_at: Date;
  min_order_quantity: string | null;
  status: string;
  deleted_at: Date | null;
  created_at: Date;
  server_updated_at: Date;
};

function variantsOf(productId: string) {
  return prisma.$queryRaw<VariantRow[]>`
    SELECT id::text, product_id::text, organization_id::text, name, unit, price,
           price_updated_at, min_order_quantity::text AS min_order_quantity,
           status::text AS status, deleted_at, created_at, server_updated_at
    FROM product_variants WHERE product_id = ${productId}::uuid ORDER BY id
  `;
}

async function countVariants(): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM product_variants WHERE organization_id IN (${ORG_A}::uuid, ${ORG_B}::uuid)
  `;
  return row.n;
}

async function cleanUp() {
  await prisma.$executeRaw`
    DELETE FROM product_variants WHERE organization_id IN (${ORG_A}::uuid, ${ORG_B}::uuid)
  `;
  await prisma.$executeRaw`
    DELETE FROM products WHERE organization_id IN (${ORG_A}::uuid, ${ORG_B}::uuid)
  `;
  await prisma.$executeRaw`
    DELETE FROM organizations WHERE id IN (${ORG_A}::uuid, ${ORG_B}::uuid)
  `;
}

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_A}::uuid, 'Fixture Business A')`;
  await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_B}::uuid, 'Fixture Business B')`;
  // Old-shaped rows: the products carry their own unit, price and minimum.
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price, min_order_quantity, status)
    VALUES (${PRODUCT_PRICED}::uuid, ${ORG_A}::uuid, 'Rice', 'sack', 3000, 2.5, 'INACTIVE')
  `;
  // The trigger ignores a given price date, so set the 2024 date with a trigger-free update.
  await prisma.$executeRaw`ALTER TABLE products DISABLE TRIGGER USER`;
  await prisma.$executeRaw`
    UPDATE products SET price_updated_at = '2024-03-01T10:00:00Z', created_at = '2024-01-01T08:00:00Z'
    WHERE id = ${PRODUCT_PRICED}::uuid
  `;
  await prisma.$executeRaw`ALTER TABLE products ENABLE TRIGGER USER`;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price, deleted_at)
    VALUES (${PRODUCT_DELETED}::uuid, ${ORG_A}::uuid, 'Old oil', 'litre', 900, '2025-02-02T00:00:00Z')
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price)
    VALUES (${PRODUCT_OTHER_BUSINESS}::uuid, ${ORG_B}::uuid, 'Sugar', 'kg', 700)
  `;
});

afterAll(cleanUp);

describe('variant per product', () => {
  it('copy: gives each product one variant with the same id and values', async () => {
    await runCopy();

    const [priced] = await variantsOf(PRODUCT_PRICED);
    expect(await variantsOf(PRODUCT_PRICED)).toHaveLength(1);
    expect(priced).toMatchObject({
      id: PRODUCT_PRICED,
      organization_id: ORG_A,
      name: null,
      unit: 'sack',
      price: 3000n,
      min_order_quantity: '2.500',
      status: 'INACTIVE',
      deleted_at: null,
    });
    expect(priced.created_at.toISOString()).toBe('2024-01-01T08:00:00.000Z');

    const deleted = await variantsOf(PRODUCT_DELETED);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({
      id: PRODUCT_DELETED,
      organization_id: ORG_A,
      name: null,
      unit: 'litre',
      price: 900n,
      min_order_quantity: null,
      status: 'ACTIVE',
    });
    expect(deleted[0].deleted_at?.toISOString()).toBe('2025-02-02T00:00:00.000Z');
  });

  it('dates: keeps the price date and sets a later server date', async () => {
    const [product] = await prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
      SELECT server_updated_at FROM products WHERE id = ${PRODUCT_PRICED}::uuid
    `;
    await runCopy();

    const [variant] = await variantsOf(PRODUCT_PRICED);
    expect(variant.price_updated_at.toISOString()).toBe('2024-03-01T10:00:00.000Z');
    expect(variant.server_updated_at.getTime()).toBeGreaterThan(product.server_updated_at.getTime());
  });

  it('twice: a second run adds nothing and keeps a changed price', async () => {
    await runCopy();
    const before = await countVariants();
    await prisma.$executeRaw`UPDATE product_variants SET price = 3500 WHERE id = ${PRODUCT_PRICED}::uuid`;

    await runCopy();

    expect(await countVariants()).toBe(before);
    const [variant] = await variantsOf(PRODUCT_PRICED);
    expect(variant.price).toBe(3500n);
  });

  it('skip: a product with a variant under another id gets no second one', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name, unit, price)
      VALUES (${PRODUCT_WITH_VARIANT}::uuid, ${ORG_A}::uuid, 'Flour', 'bag', 500)
    `;
    await prisma.$executeRaw`
      INSERT INTO product_variants (id, product_id, organization_id, unit, price)
      VALUES (${EXISTING_VARIANT}::uuid, ${PRODUCT_WITH_VARIANT}::uuid, ${ORG_A}::uuid, 'sack', 4000)
    `;

    await runCopy();

    const variants = await variantsOf(PRODUCT_WITH_VARIANT);
    expect(variants.map((v) => v.id)).toEqual([EXISTING_VARIANT]);
  });

  it('trigger: the price-date trigger is back on after the copy', async () => {
    await runCopy();

    const [enabled] = await prisma.$queryRaw<Array<{ tgenabled: string }>>`
      SELECT tgenabled::text AS tgenabled FROM pg_trigger
      WHERE tgname = 'product_variants_set_price_updated_at'
    `;
    expect(enabled.tgenabled).toBe('O');

    const [before] = await variantsOf(PRODUCT_PRICED);
    await prisma.$executeRaw`UPDATE product_variants SET price = 3200 WHERE id = ${PRODUCT_PRICED}::uuid`;
    const [afterPrice] = await variantsOf(PRODUCT_PRICED);
    expect(afterPrice.price_updated_at.getTime()).toBeGreaterThan(before.price_updated_at.getTime());

    await prisma.$executeRaw`UPDATE product_variants SET unit = 'bag' WHERE id = ${PRODUCT_PRICED}::uuid`;
    const [afterUnit] = await variantsOf(PRODUCT_PRICED);
    expect(afterUnit.price_updated_at.getTime()).toBe(afterPrice.price_updated_at.getTime());
  });
});

describe('variant per product, security', () => {
  it('two businesses: each variant has the business of its own product', async () => {
    await runCopy();

    const rows = await prisma.$queryRaw<Array<{ id: string; variant_org: string; product_org: string }>>`
      SELECT v.id::text, v.organization_id::text AS variant_org, p.organization_id::text AS product_org
      FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE p.id = ANY(${PRODUCT_IDS}::uuid[])
    `;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.variant_org).toBe(row.product_org);
    }
    const [other] = await variantsOf(PRODUCT_OTHER_BUSINESS);
    expect(other.organization_id).toBe(ORG_B);
  });
});
