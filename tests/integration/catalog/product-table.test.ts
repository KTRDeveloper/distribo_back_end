import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const ORG_ID = '0199c001-0000-7000-8000-0000000000a1';
const PRODUCT_ID = '0199c001-0000-7000-8000-0000000000b1';
const UNKNOWN_ORG_ID = '0199c001-0000-7000-8000-0000000000ff';

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
  await prisma.$executeRaw`DELETE FROM products WHERE id = ${PRODUCT_ID}::uuid`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`;
}

function insertProduct(price: number | bigint, minOrderQuantity: string | null = null) {
  return prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price, min_order_quantity)
    VALUES (${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Fixture Rice', 'sack', ${price}::bigint,
      ${minOrderQuantity}::numeric)
  `;
}

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
  `;
});

afterAll(cleanUp);

describe('products table', () => {
  it('applies defaults and uses the expected column types', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name, unit, price)
      VALUES (${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Fixture Rice', 'sack', 3000)
    `;
    const [row] = await prisma.$queryRaw<
      Array<{
        status: string;
        price_updated_at: Date;
        created_at: Date;
        server_updated_at: Date;
        deleted_at: Date | null;
        min_order_quantity: string | null;
        description: string | null;
        category: string | null;
      }>
    >`
      SELECT status::text AS status, price_updated_at, created_at, server_updated_at,
        deleted_at, min_order_quantity::text AS min_order_quantity, description, category
      FROM products WHERE id = ${PRODUCT_ID}::uuid
    `;
    expect(row).toMatchObject({
      status: 'ACTIVE',
      deleted_at: null,
      min_order_quantity: null,
      description: null,
      category: null,
    });
    expect(row.price_updated_at).toBeInstanceOf(Date);
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.server_updated_at).toBeInstanceOf(Date);

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
      WHERE table_schema = 'public' AND table_name = 'products'
    `;
    const byName = Object.fromEntries(columns.map((column) => [column.column_name, column]));
    expect(byName.id?.data_type).toBe('uuid');
    expect(byName.organization_id?.data_type).toBe('uuid');
    expect(byName.price?.data_type).toBe('bigint');
    expect(byName.min_order_quantity?.data_type).toBe('numeric');
    expect(byName.min_order_quantity?.numeric_precision).toBe(12);
    expect(byName.min_order_quantity?.numeric_scale).toBe(3);
    for (const name of ['price_updated_at', 'created_at', 'server_updated_at', 'deleted_at']) {
      expect(byName[name]?.data_type).toBe('timestamp with time zone');
    }
    for (const name of [
      'organization_id',
      'name',
      'unit',
      'price',
      'price_updated_at',
      'status',
      'created_at',
    ]) {
      expect(byName[name]?.is_nullable).toBe('NO');
    }
    for (const name of ['min_order_quantity', 'description', 'category', 'deleted_at']) {
      expect(byName[name]?.is_nullable).toBe('YES');
    }
  });

  describe('price rules', () => {
    it('accepts price 1', async () => {
      await expect(insertProduct(1)).resolves.toBe(1);
    });

    it.each([0, -5])('rejects price %s with 23514', async (price) => {
      expect(await captureSqlCode(insertProduct(price))).toBe('23514');
    });

    it('accepts min_order_quantity 0.001', async () => {
      await expect(insertProduct(3000, '0.001')).resolves.toBe(1);
    });

    it('rejects min_order_quantity 0 with 23514', async () => {
      expect(await captureSqlCode(insertProduct(3000, '0'))).toBe('23514');
    });

    it('rounds min_order_quantity 1.0005 to 3 decimals', async () => {
      await insertProduct(3000, '1.0005');
      const [row] = await prisma.$queryRaw<Array<{ quantity: string }>>`
        SELECT min_order_quantity::text AS quantity FROM products WHERE id = ${PRODUCT_ID}::uuid
      `;
      expect(row.quantity).toBe('1.001');
    });

    it('rejects a min_order_quantity that rounds to 0 with 23514', async () => {
      expect(await captureSqlCode(insertProduct(3000, '0.0004'))).toBe('23514');
    });

    it('rejects an update to a price of 0 with 23514', async () => {
      await insertProduct(3000);
      const code = await captureSqlCode(
        prisma.$executeRaw`UPDATE products SET price = 0 WHERE id = ${PRODUCT_ID}::uuid`
      );
      expect(code).toBe('23514');
    });

    it('accepts status INACTIVE', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO products (id, organization_id, name, unit, price, status)
          VALUES (${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Fixture Rice', 'sack', 3000,
            'INACTIVE'::text::public."ProductStatus")
        `
      ).resolves.toBe(1);
    });

    it('rejects status DELETED with 22P02', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO products (id, organization_id, name, unit, price, status)
          VALUES (${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Fixture Rice', 'sack', 3000,
            'DELETED'::text::public."ProductStatus")
        `
      );
      expect(code).toBe('22P02');
    });
  });

  describe('price date', () => {
    const readRow = async () => {
      const [row] = await prisma.$queryRaw<
        Array<{ price_updated_at: Date; server_updated_at: Date }>
      >`
        SELECT price_updated_at, server_updated_at FROM products WHERE id = ${PRODUCT_ID}::uuid
      `;
      return row;
    };
    const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

    it('moves price_updated_at only when the price changes', async () => {
      await insertProduct(3000);
      const initial = await readRow();

      await pause();
      await prisma.$executeRaw`UPDATE products SET price = 3500 WHERE id = ${PRODUCT_ID}::uuid`;
      const afterPrice = await readRow();
      expect(afterPrice.price_updated_at.getTime()).toBeGreaterThan(
        initial.price_updated_at.getTime()
      );

      await pause();
      await prisma.$executeRaw`UPDATE products SET name = 'Renamed' WHERE id = ${PRODUCT_ID}::uuid`;
      const afterName = await readRow();
      expect(afterName.price_updated_at.getTime()).toBe(afterPrice.price_updated_at.getTime());
      expect(afterName.server_updated_at.getTime()).toBeGreaterThan(
        afterPrice.server_updated_at.getTime()
      );
    });

    it('does not move price_updated_at when the same price is written again', async () => {
      await insertProduct(3000);
      const initial = await readRow();
      await pause();
      await prisma.$executeRaw`UPDATE products SET price = 3000 WHERE id = ${PRODUCT_ID}::uuid`;
      const after = await readRow();
      expect(after.price_updated_at.getTime()).toBe(initial.price_updated_at.getTime());
    });

    it('ignores a price_updated_at supplied by the client on insert or update', async () => {
      await prisma.$executeRaw`
        INSERT INTO products (id, organization_id, name, unit, price, price_updated_at)
        VALUES (${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Fixture Rice', 'sack', 3000,
          '2000-01-01T00:00:00Z'::timestamptz)
      `;
      const inserted = await readRow();
      expect(inserted.price_updated_at.getUTCFullYear()).toBeGreaterThan(2000);

      await pause();
      await prisma.$executeRaw`
        UPDATE products SET price = 4000, price_updated_at = '2000-01-01T00:00:00Z'::timestamptz
        WHERE id = ${PRODUCT_ID}::uuid
      `;
      const updated = await readRow();
      expect(updated.price_updated_at.getTime()).toBeGreaterThan(
        inserted.price_updated_at.getTime()
      );
    });
  });

  describe('required columns and key', () => {
    it.each(['name', 'unit', 'price'])('rejects a null %s with 23502', async (column) => {
      const values = { name: 'Fixture Rice', unit: 'sack', price: 3000, [column]: null } as {
        name: string | null;
        unit: string | null;
        price: number | null;
      };
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO products (id, organization_id, name, unit, price)
          VALUES (${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, ${values.name}, ${values.unit},
            ${values.price}::bigint)
        `
      );
      expect(code).toBe('23502');
    });

    it('rejects an unknown organization with 23503', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO products (id, organization_id, name, unit, price)
          VALUES (${PRODUCT_ID}::uuid, ${UNKNOWN_ORG_ID}::uuid, 'Fixture Rice', 'sack', 3000)
        `
      );
      expect(code).toBe('23503');
    });
  });
});
