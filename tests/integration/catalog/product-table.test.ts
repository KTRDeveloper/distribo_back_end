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
      INSERT INTO products (id, organization_id, name)
      VALUES (${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Fixture Rice')
    `;
    const [row] = await prisma.$queryRaw<
      Array<{
        created_at: Date;
        server_updated_at: Date;
        deleted_at: Date | null;
        description: string | null;
        category: string | null;
      }>
    >`
      SELECT created_at, server_updated_at, deleted_at, description, category
      FROM products WHERE id = ${PRODUCT_ID}::uuid
    `;
    expect(row).toMatchObject({
      deleted_at: null,
      description: null,
      category: null,
    });
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
    for (const name of ['created_at', 'server_updated_at', 'deleted_at']) {
      expect(byName[name]?.data_type).toBe('timestamp with time zone');
    }
    for (const name of ['organization_id', 'name', 'created_at']) {
      expect(byName[name]?.is_nullable).toBe('NO');
    }
    for (const name of ['description', 'category', 'deleted_at']) {
      expect(byName[name]?.is_nullable).toBe('YES');
    }
  });

  describe('server date', () => {
    it('moves server_updated_at on every change', async () => {
      await prisma.$executeRaw`
        INSERT INTO products (id, organization_id, name)
        VALUES (${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Fixture Rice')
      `;
      const [before] = await prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
        SELECT server_updated_at FROM products WHERE id = ${PRODUCT_ID}::uuid
      `;
      await new Promise((resolve) => setTimeout(resolve, 20));
      await prisma.$executeRaw`UPDATE products SET name = 'Renamed' WHERE id = ${PRODUCT_ID}::uuid`;
      const [after] = await prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
        SELECT server_updated_at FROM products WHERE id = ${PRODUCT_ID}::uuid
      `;
      expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
    });
  });

  describe('required columns and key', () => {
    it('rejects a null name with 23502', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO products (id, organization_id, name)
          VALUES (${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, ${null})
        `
      );
      expect(code).toBe('23502');
    });

    it('rejects an unknown organization with 23503', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO products (id, organization_id, name)
          VALUES (${PRODUCT_ID}::uuid, ${UNKNOWN_ORG_ID}::uuid, 'Fixture Rice')
        `
      );
      expect(code).toBe('23503');
    });
  });
});
