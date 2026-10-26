import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { seedProduct } from '../../helpers/catalog-fixtures';

const ORG_ID = '0199c041-0000-7000-8000-0000000000a1';
const PRODUCT_ID = '0199c041-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT_ID = '0199c041-0000-7000-8000-0000000000b2';

const MIGRATION_DIR = join(__dirname, '../../../prisma/migrations');

type SqlError = {
  code?: string;
  message?: string;
  meta?: {
    code?: string;
    driverAdapterError?: { cause?: { code?: string; originalCode?: string; message?: string } };
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

/** The lines of the CAT-041 migration between `-- guard start` and `-- guard end`. */
function guardSql(): string {
  const found = readdirSync(MIGRATION_DIR).filter((name) =>
    name.endsWith('_cat_041_drop_product_price_columns')
  );
  expect(found).toHaveLength(1);
  const sql = readFileSync(join(MIGRATION_DIR, found[0], 'migration.sql'), 'utf8');
  const start = sql.indexOf('-- guard start');
  const end = sql.indexOf('-- guard end');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start + '-- guard start'.length, end);
}

async function columnsOfProducts(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
  `;
  return rows.map((row) => row.column_name);
}

beforeEach(async () => {
  await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')`;
});

describe('product columns dropped', () => {
  it('columns: the five old columns are gone, the four kept are present (AC-1)', async () => {
    const columns = await columnsOfProducts();
    for (const gone of ['unit', 'price', 'price_updated_at', 'min_order_quantity', 'status']) {
      expect(columns).not.toContain(gone);
    }
    for (const kept of ['name', 'image_keys', 'paused_at', 'deleted_at']) {
      expect(columns).toContain(kept);
    }
  });

  it('triggers: only the server-date trigger is left, and both dates move (AC-2)', async () => {
    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.products'::regclass AND NOT tgisinternal
    `;
    expect(triggers.map((trigger) => trigger.tgname)).toEqual(['products_set_server_updated_at']);

    const functions = await prisma.$queryRaw<Array<{ proname: string }>>`
      SELECT proname FROM pg_proc
      WHERE proname IN ('mirror_product_insert_to_variant', 'mirror_product_update_to_variant')
    `;
    expect(functions).toEqual([]);

    await seedProduct(prisma, { id: PRODUCT_ID, organizationId: ORG_ID });
    const before = await prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_ID } });
    const variantBefore = await prisma.productVariant.findUniqueOrThrow({ where: { id: PRODUCT_ID } });

    await prisma.product.update({ where: { id: PRODUCT_ID }, data: { name: 'Renamed' } });
    await prisma.productVariant.update({ where: { id: PRODUCT_ID }, data: { price: 2000n } });

    const after = await prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_ID } });
    const variantAfter = await prisma.productVariant.findUniqueOrThrow({ where: { id: PRODUCT_ID } });
    expect(after.serverUpdatedAt.getTime()).toBeGreaterThan(before.serverUpdatedAt.getTime());
    expect(variantAfter.priceUpdatedAt.getTime()).toBeGreaterThan(variantBefore.priceUpdatedAt.getTime());
  });

  it('guard: refuses a live product without a live variant (AC-3)', async () => {
    await prisma.product.create({
      data: { id: PRODUCT_ID, organizationId: ORG_ID, name: 'No variant' },
    });
    const code = await captureSqlCode(prisma.$executeRawUnsafe(guardSql()));
    expect(code).toBe('P0001');
  });

  it('guard: refuses a live product whose only variant is deleted (AC-3)', async () => {
    await seedProduct(prisma, { id: PRODUCT_ID, organizationId: ORG_ID });
    await prisma.productVariant.update({
      where: { id: PRODUCT_ID },
      data: { deletedAt: new Date() },
    });
    const code = await captureSqlCode(prisma.$executeRawUnsafe(guardSql()));
    expect(code).toBe('P0001');
  });

  it('guard: passes with a live variant, or for a deleted product (AC-3)', async () => {
    await seedProduct(prisma, { id: PRODUCT_ID, organizationId: ORG_ID });
    await prisma.product.create({
      data: {
        id: OTHER_PRODUCT_ID,
        organizationId: ORG_ID,
        name: 'Deleted',
        deletedAt: new Date(),
      },
    });
    await expect(prisma.$executeRawUnsafe(guardSql())).resolves.toBeDefined();
  });

  it('stale write: a raw insert with unit and price is refused with 42703 (AB-1)', async () => {
    const code = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO products (id, organization_id, name, unit, price)
        VALUES (${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Rice', 'kg', 1000)
      `
    );
    expect(code).toBe('42703');
    expect(await prisma.product.count({ where: { id: PRODUCT_ID } })).toBe(0);
  });
});
