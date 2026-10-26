import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { seedProduct } from '../../helpers/catalog-fixtures';
import { upsertCustomerPrice } from '../../../src/modules/catalog/catalog.repository';

const ORG_A = '0199c043-0000-7000-8000-000000000001';
const ORG_B = '0199c043-0000-7000-8000-000000000002';
const OWNER = '0199c043-0000-7000-8000-000000000011';
const CUSTOMER = '0199c043-0000-7000-8000-000000000012';
const REL_A = '0199c043-0000-7000-8000-000000000021';
const REL_PERSON = '0199c043-0000-7000-8000-000000000022';
const PRODUCT_A = '0199c043-0000-7000-8000-000000000031';
const PRODUCT_B = '0199c043-0000-7000-8000-000000000032';
const VARIANT_A = PRODUCT_A;
const VARIANT_A2 = '0199c043-0000-7000-8000-000000000041';
const VARIANT_B = PRODUCT_B;
const PRICE_1 = '0199c043-0000-7000-8000-000000000051';
const PRICE_2 = '0199c043-0000-7000-8000-000000000052';

const MIGRATION_DIR = join(__dirname, '../../../prisma/migrations');
const ROLLBACK = 'rollback sentinel';

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
    return sqlCode(error) ?? 'UNKNOWN';
  }
  return undefined;
}

/** The lines of the CAT-043 migration between `-- guard start` and `-- guard end`. */
function guardSql(): string {
  const found = readdirSync(MIGRATION_DIR).filter((name) =>
    name.endsWith('_cat_043_drop_price_product_id')
  );
  expect(found).toHaveLength(1);
  const sql = readFileSync(join(MIGRATION_DIR, found[0], 'migration.sql'), 'utf8');
  const start = sql.indexOf('-- guard start');
  const end = sql.indexOf('-- guard end');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start + '-- guard start'.length, end);
}

function insertPrice(id: string, variant: string, relationship = REL_A, deletedAt: Date | null = null) {
  return prisma.$executeRaw`
    INSERT INTO customer_prices (
      id, customer_relationship_id, product_variant_id, price, set_by_id, deleted_at
    )
    VALUES (${id}::uuid, ${relationship}::uuid, ${variant}::uuid, 2500::bigint, ${OWNER}::uuid,
            ${deletedAt}::timestamptz)
  `;
}

/**
 * Runs the guard on a table state where the variant is allowed to be empty, as it was before the
 * migration. Everything is rolled back, the NOT NULL included.
 */
async function runGuard(withEmptyVariant: boolean): Promise<string | undefined> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE "customer_prices" ALTER COLUMN "product_variant_id" DROP NOT NULL'
      );
      if (withEmptyVariant) {
        await tx.$executeRaw`
          INSERT INTO customer_prices (id, customer_relationship_id, price, set_by_id)
          VALUES (${PRICE_1}::uuid, ${REL_A}::uuid, 2500::bigint, ${OWNER}::uuid)
        `;
      }
      await tx.$executeRawUnsafe(guardSql());
      throw new Error(ROLLBACK);
    });
  } catch (error) {
    if (error instanceof Error && error.message === ROLLBACK) return undefined;
    return sqlCode(error) ?? 'UNKNOWN';
  }
  return undefined;
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
      { id: OWNER, fullName: 'Fixture Owner', phoneNumber: '+2250700043011', ...registered },
      { id: CUSTOMER, fullName: 'Fixture Customer', phoneNumber: '+2250700043012', ...registered },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${ORG_A}::uuid, 'Fixture Business A'), (${ORG_B}::uuid, 'Fixture Business B')
  `;
  await seedProduct(prisma, { id: PRODUCT_A, organizationId: ORG_A, name: 'Fixture Rice' });
  await seedProduct(prisma, { id: PRODUCT_B, organizationId: ORG_B, name: 'Fixture Oil' });
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price)
    VALUES (${VARIANT_A2}::uuid, ${PRODUCT_A}::uuid, ${ORG_A}::uuid, 'Small', 'bag', 800)
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

describe('negotiated prices lose their product column', () => {
  it('columns: product_id, its index and key are gone, the variant is required (AC-1)', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customer_prices'
    `;
    expect(columns.map((column) => column.column_name)).not.toContain('product_id');
    expect(columns.find((column) => column.column_name === 'product_variant_id')?.is_nullable).toBe(
      'NO'
    );

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'customer_prices'
    `;
    expect(indexes.map((index) => index.indexname)).not.toContain('customer_prices_product_id_idx');
    const keys = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conrelid = 'public.customer_prices'::regclass
    `;
    expect(keys.map((key) => key.conname)).not.toContain('customer_prices_product_id_fkey');

    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.customer_prices'::regclass AND NOT tgisinternal
    `;
    const names = triggers.map((trigger) => trigger.tgname);
    expect(names).toContain('customer_prices_require_supplier_variant');
    expect(names).not.toContain('customer_prices_fill_variant');
    expect(names).not.toContain('customer_prices_require_supplier_product');
    const functions = await prisma.$queryRaw<Array<{ proname: string }>>`
      SELECT proname FROM pg_proc
      WHERE proname IN ('customer_prices_fill_variant', 'customer_prices_require_supplier_product')
    `;
    expect(functions).toEqual([]);
  });

  it('rules: another business variant gives 23514, a live duplicate pair 23505 (AC-2, C-11)', async () => {
    expect(await captureSqlCode(insertPrice(PRICE_1, VARIANT_B))).toBe('23514');
    await insertPrice(PRICE_1, VARIANT_A);
    expect(await captureSqlCode(insertPrice(PRICE_2, VARIANT_A))).toBe('23505');
  });

  it('rules: a deleted price frees its pair, another variant of the product is allowed (C-11)', async () => {
    await insertPrice(PRICE_1, VARIANT_A, REL_A, new Date('2026-02-01T00:00:00Z'));
    await expect(insertPrice(PRICE_2, VARIANT_A)).resolves.toBe(1);
    await expect(
      insertPrice('0199c043-0000-7000-8000-000000000053', VARIANT_A2)
    ).resolves.toBe(1);
  });

  it('rules: an empty variant is refused (23502)', async () => {
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO customer_prices (id, customer_relationship_id, price, set_by_id)
          VALUES (${PRICE_1}::uuid, ${REL_A}::uuid, 2500::bigint, ${OWNER}::uuid)
        `
      )
    ).toBe('23502');
  });

  it('guard: raises when a row has no variant, passes otherwise (AC-3)', async () => {
    expect(await runGuard(true)).toBe('P0001');
    expect(await runGuard(false)).toBeUndefined();
    // The rollback restored the NOT NULL.
    expect(await captureSqlCode(insertPriceWithoutVariant())).toBe('23502');
  });

  it('writer: sets a price for a variant and a relationship, then replaces it (AC-4)', async () => {
    await prisma.$transaction((tx) =>
      upsertCustomerPrice(tx, {
        id: PRICE_1,
        relationshipId: REL_A,
        variantId: VARIANT_A,
        price: 2800,
        setById: OWNER,
        now: new Date('2026-03-01T00:00:00Z'),
      })
    );
    await prisma.$transaction((tx) =>
      upsertCustomerPrice(tx, {
        id: PRICE_2,
        relationshipId: REL_A,
        variantId: VARIANT_A,
        price: 3200,
        setById: OWNER,
        now: new Date('2026-03-02T00:00:00Z'),
      })
    );

    const rows = await prisma.customerPrice.findMany({
      where: { customerRelationshipId: REL_A },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: PRICE_1,
      productVariantId: VARIANT_A,
      customerRelationshipId: REL_A,
      price: 3200n,
      setById: OWNER,
    });
  });
});

describe('negotiated prices lose their product column, security', () => {
  it('AB-1 other supplier: a raw insert for another business variant is refused (23514)', async () => {
    expect(await captureSqlCode(insertPrice(PRICE_1, VARIANT_B))).toBe('23514');
    expect(await prisma.customerPrice.count()).toBe(0);
  });

  it('crafted write: moving a price to another business variant is refused (23514)', async () => {
    await insertPrice(PRICE_1, VARIANT_A);
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          UPDATE customer_prices SET product_variant_id = ${VARIANT_B}::uuid
          WHERE id = ${PRICE_1}::uuid
        `
      )
    ).toBe('23514');
  });

  it('crafted write: a relationship supplied by a person holds no price (23514)', async () => {
    expect(await captureSqlCode(insertPrice(PRICE_1, VARIANT_A, REL_PERSON))).toBe('23514');
  });
});

function insertPriceWithoutVariant() {
  return prisma.$executeRaw`
    INSERT INTO customer_prices (id, customer_relationship_id, price, set_by_id)
    VALUES (${PRICE_1}::uuid, ${REL_A}::uuid, 2500::bigint, ${OWNER}::uuid)
  `;
}
