import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const ORG_ID = '0199c014-0000-7000-8000-0000000000a1';
const NEW_STYLE = '0199c014-0000-7000-8000-0000000000b1';
const OLD_STYLE = '0199c014-0000-7000-8000-0000000000b2';
const OTHER_VARIANT = '0199c014-0000-7000-8000-0000000000c1';
const PRODUCT_IDS = [NEW_STYLE, OLD_STYLE];

const MIGRATION_DIR = join(__dirname, '../../../prisma/migrations');

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
    return sqlCode(error);
  }
  return undefined;
}

/** The statements of the CAT-014 migration between `-- touch start` and `-- touch end`. */
function touchStatements(): string[] {
  const dir = readdirSyncCat014();
  const sql = readFileSync(join(MIGRATION_DIR, dir, 'migration.sql'), 'utf8');
  const start = sql.indexOf('-- touch start');
  const end = sql.indexOf('-- touch end');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql
    .slice(start + '-- touch start'.length, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function readdirSyncCat014(): string {
  const found = readdirSync(MIGRATION_DIR).filter((name) => name.endsWith('_cat_014_product_photos_pause_mirror'));
  expect(found).toHaveLength(1);
  return found[0];
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
  server_updated_at: Date;
};

function variantsOf(productId: string) {
  return prisma.$queryRaw<VariantRow[]>`
    SELECT id::text, product_id::text, organization_id::text, name, unit, price,
           price_updated_at, min_order_quantity::text AS min_order_quantity,
           status::text AS status, server_updated_at
    FROM product_variants WHERE product_id = ${productId}::uuid ORDER BY id
  `;
}

async function cleanUp() {
  await prisma.$executeRaw`DELETE FROM product_variants WHERE organization_id = ${ORG_ID}::uuid`;
  await prisma.$executeRaw`DELETE FROM products WHERE organization_id = ${ORG_ID}::uuid`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`;
}

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')`;
});

afterAll(cleanUp);

describe('product new columns', () => {
  it('new-style row: defaults apply and no variant is created', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name) VALUES (${NEW_STYLE}::uuid, ${ORG_ID}::uuid, 'Rice')
    `;

    const [row] = await prisma.$queryRaw<
      Array<{ image_keys: string[]; paused_at: Date | null; unit: string; price: bigint; status: string }>
    >`
      SELECT image_keys, paused_at, unit, price, status::text AS status
      FROM products WHERE id = ${NEW_STYLE}::uuid
    `;
    expect(row).toEqual({ image_keys: [], paused_at: null, unit: '', price: 1n, status: 'ACTIVE' });
    expect(await variantsOf(NEW_STYLE)).toHaveLength(0);
  });

  it.each([
    ['5 image keys', 5, undefined],
    ['6 image keys', 6, '23514'],
  ])('photo limit: %s', async (_label, count, expected) => {
    const keys = Array.from({ length: count }, (_, i) => `k-${i}`);
    const code = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO products (id, organization_id, name, image_keys)
        VALUES (${NEW_STYLE}::uuid, ${ORG_ID}::uuid, 'Rice', ${keys}::text[])
      `
    );
    expect(code).toBe(expected);
  });

  it('photo limit: image_keys null is refused with 23502', async () => {
    const code = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO products (id, organization_id, name, image_keys)
        VALUES (${NEW_STYLE}::uuid, ${ORG_ID}::uuid, 'Rice', NULL)
      `
    );
    expect(code).toBe('23502');
  });

  it('old insert: one variant with the same id and the old values', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name, unit, price, min_order_quantity)
      VALUES (${OLD_STYLE}::uuid, ${ORG_ID}::uuid, 'Rice', 'sac', 3000, 2.5)
    `;

    const variants = await variantsOf(OLD_STYLE);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      id: OLD_STYLE,
      product_id: OLD_STYLE,
      organization_id: ORG_ID,
      name: null,
      unit: 'sac',
      price: 3000n,
      min_order_quantity: '2.500',
      status: 'ACTIVE',
    });
  });

  it('old update: a new price reaches the variant with a later price date', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name, unit, price)
      VALUES (${OLD_STYLE}::uuid, ${ORG_ID}::uuid, 'Rice', 'sac', 3000)
    `;
    const [before] = await variantsOf(OLD_STYLE);

    await prisma.$executeRaw`UPDATE products SET price = 3500 WHERE id = ${OLD_STYLE}::uuid`;

    const [after] = await variantsOf(OLD_STYLE);
    expect(after.price).toBe(3500n);
    expect(after.price_updated_at.getTime()).toBeGreaterThan(before.price_updated_at.getTime());
  });

  it('old update: a new status reaches the variant', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name, unit, price)
      VALUES (${OLD_STYLE}::uuid, ${ORG_ID}::uuid, 'Rice', 'sac', 3000)
    `;

    await prisma.$executeRaw`UPDATE products SET status = 'INACTIVE' WHERE id = ${OLD_STYLE}::uuid`;

    const [after] = await variantsOf(OLD_STYLE);
    expect(after.status).toBe('INACTIVE');
  });

  it('old update: a change of another column leaves the variant untouched', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name, unit, price)
      VALUES (${OLD_STYLE}::uuid, ${ORG_ID}::uuid, 'Rice', 'sac', 3000)
    `;
    const [before] = await variantsOf(OLD_STYLE);

    await prisma.$executeRaw`UPDATE products SET name = 'Long rice' WHERE id = ${OLD_STYLE}::uuid`;

    const [after] = await variantsOf(OLD_STYLE);
    expect(after.server_updated_at.getTime()).toBe(before.server_updated_at.getTime());
  });

  it('new-style product: a rename creates no variant with the id of the product', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name) VALUES (${NEW_STYLE}::uuid, ${ORG_ID}::uuid, 'Rice')
    `;
    await prisma.$executeRaw`
      INSERT INTO product_variants (id, product_id, organization_id, unit, price)
      VALUES (${OTHER_VARIANT}::uuid, ${NEW_STYLE}::uuid, ${ORG_ID}::uuid, 'sack', 4000)
    `;

    await prisma.$executeRaw`UPDATE products SET name = 'Long rice' WHERE id = ${NEW_STYLE}::uuid`;

    const variants = await variantsOf(NEW_STYLE);
    expect(variants.map((v) => v.id)).toEqual([OTHER_VARIANT]);
    expect(variants[0]).toMatchObject({ unit: 'sack', price: 4000n });
  });

  it('touch: every server date moves later', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name) VALUES (${NEW_STYLE}::uuid, ${ORG_ID}::uuid, 'Rice')
    `;
    await prisma.$executeRaw`ALTER TABLE products DISABLE TRIGGER USER`;
    await prisma.$executeRaw`
      UPDATE products SET server_updated_at = now() - interval '1 day' WHERE id = ${NEW_STYLE}::uuid
    `;
    await prisma.$executeRaw`ALTER TABLE products ENABLE TRIGGER USER`;
    const [before] = await prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
      SELECT server_updated_at FROM products WHERE id = ${NEW_STYLE}::uuid
    `;

    const statements = touchStatements();
    expect(statements.length).toBeGreaterThan(0);
    await prisma.$transaction(async (tx) => {
      for (const statement of statements) {
        await tx.$executeRawUnsafe(statement);
      }
    });

    const [after] = await prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
      SELECT server_updated_at FROM products WHERE id = ${NEW_STYLE}::uuid
    `;
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
  });
});

describe('product new columns, security', () => {
  it('thousand photos: a raw update with 1000 keys is refused with 23514', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name) VALUES (${NEW_STYLE}::uuid, ${ORG_ID}::uuid, 'Rice')
    `;
    const keys = Array.from({ length: 1000 }, (_, i) => `k-${i}`);

    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE products SET image_keys = ${keys}::text[] WHERE id = ${NEW_STYLE}::uuid`
    );

    expect(code).toBe('23514');
    const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT cardinality(image_keys)::int AS n FROM products WHERE id = ${NEW_STYLE}::uuid
    `;
    expect(row.n).toBe(0);
  });

  it('two businesses: the mirrored variant takes the business of its product', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name, unit, price)
      VALUES (${OLD_STYLE}::uuid, ${ORG_ID}::uuid, 'Rice', 'sac', 3000)
    `;
    const rows = await prisma.$queryRaw<Array<{ v: string; p: string }>>`
      SELECT v.organization_id::text AS v, p.organization_id::text AS p
      FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE p.id = ANY(${PRODUCT_IDS}::uuid[])
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].v).toBe(rows[0].p);
  });
});
