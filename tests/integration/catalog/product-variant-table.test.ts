import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const ORG_A = '0199c012-0000-7000-8000-0000000000a1';
const ORG_B = '0199c012-0000-7000-8000-0000000000a2';
const PRODUCT_A = '0199c012-0000-7000-8000-0000000000b1';
const PRODUCT_B = '0199c012-0000-7000-8000-0000000000b2';
const VARIANT_ID = '0199c012-0000-7000-8000-0000000000c1';
const OTHER_VARIANT_ID = '0199c012-0000-7000-8000-0000000000c2';
const UNKNOWN_ID = '0199c012-0000-7000-8000-0000000000ff';

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

async function cleanUp() {
  await prisma.$executeRaw`
    DELETE FROM product_variants WHERE id IN (${VARIANT_ID}::uuid, ${OTHER_VARIANT_ID}::uuid)
  `;
  await prisma.$executeRaw`
    DELETE FROM products WHERE id IN (${PRODUCT_A}::uuid, ${PRODUCT_B}::uuid)
  `;
  await prisma.$executeRaw`
    DELETE FROM organizations WHERE id IN (${ORG_A}::uuid, ${ORG_B}::uuid)
  `;
}

function insertVariant(
  price: number | bigint = 3000,
  minOrderQuantity: string | null = null,
  imageKeys: string[] = []
) {
  return prisma.$executeRaw`
    INSERT INTO product_variants
      (id, product_id, organization_id, unit, price, min_order_quantity, image_keys)
    VALUES (${VARIANT_ID}::uuid, ${PRODUCT_A}::uuid, ${ORG_A}::uuid, 'sack', ${price}::bigint,
      ${minOrderQuantity}::numeric, ${imageKeys}::text[])
  `;
}

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_A}::uuid, 'Fixture Business A')
  `;
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_B}::uuid, 'Fixture Business B')
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name)
    VALUES (${PRODUCT_A}::uuid, ${ORG_A}::uuid, 'Fixture Rice')
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name)
    VALUES (${PRODUCT_B}::uuid, ${ORG_B}::uuid, 'Fixture Oil')
  `;
});

afterAll(cleanUp);

describe('product_variants table', () => {
  it('applies defaults and sets the dates from the database clock', async () => {
    await prisma.$executeRaw`
      INSERT INTO product_variants
        (id, product_id, organization_id, unit, price, price_updated_at, created_at,
         server_updated_at)
      VALUES (${VARIANT_ID}::uuid, ${PRODUCT_A}::uuid, ${ORG_A}::uuid, 'sack', 3000,
        '2020-01-01T00:00:00Z'::timestamptz, '2020-01-01T00:00:00Z'::timestamptz,
        '2020-01-01T00:00:00Z'::timestamptz)
    `;
    const [row] = await prisma.$queryRaw<
      Array<{
        name: string | null;
        min_order_quantity: string | null;
        status: string;
        image_keys: string[];
        deleted_at: Date | null;
        merged_into_id: string | null;
        price_updated_at: Date;
        created_at: Date;
        server_updated_at: Date;
        now: Date;
      }>
    >`
      SELECT name, min_order_quantity::text AS min_order_quantity, status::text AS status,
        image_keys, deleted_at, merged_into_id, price_updated_at, created_at,
        server_updated_at, now() AS now
      FROM product_variants WHERE id = ${VARIANT_ID}::uuid
    `;
    expect(row).toMatchObject({
      name: null,
      min_order_quantity: null,
      status: 'ACTIVE',
      image_keys: [],
      deleted_at: null,
      merged_into_id: null,
    });
    // Inside the same transaction clock, all dates equal the database time.
    expect(row.price_updated_at.getUTCFullYear()).toBeGreaterThan(2020);
    expect(row.server_updated_at.getUTCFullYear()).toBeGreaterThan(2020);
    expect(Math.abs(row.price_updated_at.getTime() - row.now.getTime())).toBeLessThan(60_000);
    expect(Math.abs(row.server_updated_at.getTime() - row.now.getTime())).toBeLessThan(60_000);
    expect(row.created_at).toBeInstanceOf(Date);

    const columns = await prisma.$queryRaw<
      Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        numeric_precision: number | null;
        numeric_scale: number | null;
      }>
    >`
      SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'product_variants'
    `;
    const byName = Object.fromEntries(columns.map((column) => [column.column_name, column]));
    expect(byName.price?.data_type).toBe('bigint');
    expect(byName.min_order_quantity?.numeric_precision).toBe(12);
    expect(byName.min_order_quantity?.numeric_scale).toBe(3);
    for (const name of ['price_updated_at', 'created_at', 'server_updated_at', 'deleted_at']) {
      expect(byName[name]?.data_type).toBe('timestamp with time zone');
    }
    for (const name of ['name', 'min_order_quantity', 'merged_into_id', 'deleted_at']) {
      expect(byName[name]?.is_nullable).toBe('YES');
    }
  });

  describe('value rules', () => {
    it('rejects price 0 with 23514', async () => {
      expect(await captureSqlCode(insertVariant(0))).toBe('23514');
    });

    it('rejects min_order_quantity 0 with 23514', async () => {
      expect(await captureSqlCode(insertVariant(3000, '0'))).toBe('23514');
    });

    it('accepts min_order_quantity 0.001', async () => {
      await expect(insertVariant(3000, '0.001')).resolves.toBe(1);
    });

    it('accepts 5 image keys', async () => {
      const keys = Array.from({ length: 5 }, (_, i) => `products/fixture-${i}.jpg`);
      await expect(insertVariant(3000, null, keys)).resolves.toBe(1);
    });

    it('rejects 6 image keys with 23514', async () => {
      const keys = Array.from({ length: 6 }, (_, i) => `products/fixture-${i}.jpg`);
      expect(await captureSqlCode(insertVariant(3000, null, keys))).toBe('23514');
    });

    it('rejects an update to 6 image keys with 23514', async () => {
      await insertVariant();
      const keys = Array.from({ length: 6 }, (_, i) => `products/fixture-${i}.jpg`);
      const code = await captureSqlCode(
        prisma.$executeRaw`
          UPDATE product_variants SET image_keys = ${keys}::text[] WHERE id = ${VARIANT_ID}::uuid
        `
      );
      expect(code).toBe('23514');
    });

    it('has a GIN index on image_keys', async () => {
      const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'product_variants' AND indexdef ILIKE '%gin%image_keys%'
      `;
      expect(rows).toHaveLength(1);
    });
  });

  describe('price date', () => {
    const readRow = async () => {
      const [row] = await prisma.$queryRaw<
        Array<{ price_updated_at: Date; server_updated_at: Date }>
      >`
        SELECT price_updated_at, server_updated_at
        FROM product_variants WHERE id = ${VARIANT_ID}::uuid
      `;
      return row;
    };
    const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

    it('moves price_updated_at with the price only', async () => {
      await insertVariant();
      const initial = await readRow();

      await pause();
      await prisma.$executeRaw`
        UPDATE product_variants SET price = 3500 WHERE id = ${VARIANT_ID}::uuid
      `;
      const afterPrice = await readRow();
      expect(afterPrice.price_updated_at.getTime()).toBeGreaterThan(
        initial.price_updated_at.getTime()
      );

      await pause();
      await prisma.$executeRaw`
        UPDATE product_variants SET unit = 'bag' WHERE id = ${VARIANT_ID}::uuid
      `;
      const afterUnit = await readRow();
      expect(afterUnit.price_updated_at.getTime()).toBe(afterPrice.price_updated_at.getTime());
      expect(afterUnit.server_updated_at.getTime()).toBeGreaterThan(
        afterPrice.server_updated_at.getTime()
      );
    });

    it('ignores a price_updated_at supplied on update', async () => {
      await insertVariant();
      const initial = await readRow();
      await pause();
      await prisma.$executeRaw`
        UPDATE product_variants
        SET unit = 'bag', price_updated_at = '2000-01-01T00:00:00Z'::timestamptz
        WHERE id = ${VARIANT_ID}::uuid
      `;
      const after = await readRow();
      expect(after.price_updated_at.getTime()).toBe(initial.price_updated_at.getTime());
    });
  });

  describe('required values and keys', () => {
    it.each(['product_id', 'unit', 'price'])('rejects a null %s with 23502', async (column) => {
      const values = {
        product_id: PRODUCT_A as string | null,
        unit: 'sack' as string | null,
        price: 3000 as number | null,
        [column]: null,
      };
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO product_variants (id, product_id, organization_id, unit, price)
          VALUES (${VARIANT_ID}::uuid, ${values.product_id}::uuid, ${ORG_A}::uuid, ${values.unit},
            ${values.price}::bigint)
        `
      );
      expect(code).toBe('23502');
    });

    it('rejects an unknown product with 23503', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO product_variants (id, product_id, organization_id, unit, price)
          VALUES (${VARIANT_ID}::uuid, ${UNKNOWN_ID}::uuid, ${ORG_A}::uuid, 'sack', 3000)
        `
      );
      expect(code).toBe('23503');
    });

    it('rejects an unknown merged_into_id with 23503', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO product_variants
            (id, product_id, organization_id, unit, price, merged_into_id, deleted_at)
          VALUES (${VARIANT_ID}::uuid, ${PRODUCT_A}::uuid, ${ORG_A}::uuid, 'sack', 3000,
            ${UNKNOWN_ID}::uuid, now())
        `
      );
      expect(code).toBe('23503');
    });

    it('accepts a merged_into_id naming another variant', async () => {
      await insertVariant();
      await expect(
        prisma.$executeRaw`
          INSERT INTO product_variants
            (id, product_id, organization_id, unit, price, merged_into_id, deleted_at)
          VALUES (${OTHER_VARIANT_ID}::uuid, ${PRODUCT_A}::uuid, ${ORG_A}::uuid, 'bag', 2000,
            ${VARIANT_ID}::uuid, now())
        `
      ).resolves.toBe(1);
    });

    it('rejects a status other than ACTIVE or INACTIVE with 22P02', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO product_variants (id, product_id, organization_id, unit, price, status)
          VALUES (${VARIANT_ID}::uuid, ${PRODUCT_A}::uuid, ${ORG_A}::uuid, 'sack', 3000,
            'DELETED'::text::public."ProductStatus")
        `
      );
      expect(code).toBe('22P02');
    });
  });

  describe('crafted write', () => {
    it('rejects a variant of business A under a product of business B with 23503', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO product_variants (id, product_id, organization_id, unit, price)
          VALUES (${VARIANT_ID}::uuid, ${PRODUCT_B}::uuid, ${ORG_A}::uuid, 'sack', 3000)
        `
      );
      expect(code).toBe('23503');
    });

    it('rejects moving a variant under a product of another business with 23503', async () => {
      await insertVariant();
      const code = await captureSqlCode(
        prisma.$executeRaw`
          UPDATE product_variants SET product_id = ${PRODUCT_B}::uuid
          WHERE id = ${VARIANT_ID}::uuid
        `
      );
      expect(code).toBe('23503');
    });
  });
});
