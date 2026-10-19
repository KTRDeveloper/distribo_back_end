import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { expectColumnType } from '../../helpers/db-schema';

const SUPPLIER_ORG_ID = '0199c024-0000-7000-8000-000000000001';
const OWNER_ID = '0199c024-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c024-0000-7000-8000-000000000012';
const REL_ID = '0199c024-0000-7000-8000-000000000021';
const ORDER_ID = '0199c024-0000-7000-8000-000000000031';
const OLD_PRODUCT_ID = '0199c024-0000-7000-8000-000000000041';
const NEW_PRODUCT_ID = '0199c024-0000-7000-8000-000000000042';
const NEW_VARIANT_ID = '0199c024-0000-7000-8000-000000000051';
const LINE_ID = '0199c024-0000-7000-8000-000000000061';
const UNKNOWN_ID = '0199c024-0000-7000-8000-0000000009ff';
const AT = new Date('2026-01-02T00:00:00.000Z');

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

/**
 * Inserts a 2 x 3000 line and raises the order total by the same amount in one
 * statement (ORD-006). The variant column is left out of the statement when
 * `variant` is `undefined`.
 */
function insertLine(product: string, variant?: string): Promise<number> {
  if (variant === undefined) {
    return prisma.$executeRaw`
      WITH inserted AS (
        INSERT INTO order_lines (
          id, order_id, product_id, label_applied, quantity,
          reference_price, unit_price_applied, amount
        )
        VALUES (${LINE_ID}::uuid, ${ORDER_ID}::uuid, ${product}::uuid, 'Fixture Rice', 2,
          3000, 3000, 6000)
        RETURNING id
      )
      UPDATE orders SET total_amount = total_amount + 6000 WHERE id = ${ORDER_ID}::uuid
    `;
  }
  return prisma.$executeRaw`
    WITH inserted AS (
      INSERT INTO order_lines (
        id, order_id, product_id, product_variant_id, label_applied, quantity,
        reference_price, unit_price_applied, amount
      )
      VALUES (${LINE_ID}::uuid, ${ORDER_ID}::uuid, ${product}::uuid, ${variant}::uuid,
        'Fixture Rice', 2, 3000, 3000, 6000)
      RETURNING id
    )
    UPDATE orders SET total_amount = total_amount + 6000 WHERE id = ${ORDER_ID}::uuid
  `;
}

async function readVariant(): Promise<string | null> {
  const [row] = await prisma.$queryRaw<Array<{ product_variant_id: string | null }>>`
    SELECT product_variant_id::text FROM order_lines WHERE id = ${LINE_ID}::uuid
  `;
  return row.product_variant_id;
}

async function countLines(): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM order_lines
  `;
  return row.n;
}

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: AT,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: AT,
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700024011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700024012',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  // Old-style product: the CAT-014 trigger gives it a variant with its own id.
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price)
    VALUES (${OLD_PRODUCT_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'Fixture Rice', 'sack', 3000)
  `;
  // New-style product: empty unit, so no variant of its own id; one variant with another id.
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price)
    VALUES (${NEW_PRODUCT_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'Fixture Oil', '', 1)
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price)
    VALUES (${NEW_VARIANT_ID}::uuid, ${NEW_PRODUCT_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid,
      'Small', 'can', 3000)
  `;
  await prisma.$executeRaw`
    INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
    VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'SUPPLIER'::public."OrderParty",
      ${OWNER_ID}::uuid, 0)
  `;
});

describe('order line variant', () => {
  it('AC-1 column, key and index', async () => {
    await expectColumnType('order_lines', 'product_variant_id', 'uuid');
    const [column] = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_lines'
        AND column_name = 'product_variant_id'
    `;
    expect(column.is_nullable).toBe('YES');
    const keys = await prisma.$queryRaw<Array<{ target: string; on_delete: string }>>`
      SELECT confrelid::regclass::text AS target, confdeltype::text AS on_delete
      FROM pg_constraint
      WHERE conrelid = 'public.order_lines'::regclass AND contype = 'f'
        AND conname = 'order_lines_product_variant_id_fkey'
    `;
    expect(keys).toEqual([{ target: 'product_variants', on_delete: 'r' }]);
    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'order_lines'
    `;
    expect(indexes.some((r) => r.indexdef.includes('(product_variant_id)'))).toBe(true);
  });

  it('AC-2 a line for an old-style product gets its variant', async () => {
    await insertLine(OLD_PRODUCT_ID);
    expect(await readVariant()).toBe(OLD_PRODUCT_ID);
  });

  it('AC-3 a given variant is kept', async () => {
    await insertLine(NEW_PRODUCT_ID, NEW_VARIANT_ID);
    expect(await readVariant()).toBe(NEW_VARIANT_ID);
  });

  it('AC-4 an unknown variant fails with 23503', async () => {
    expect(await captureSqlCode(insertLine(OLD_PRODUCT_ID, UNKNOWN_ID))).toBe('23503');
    expect(await countLines()).toBe(0);
  });

  it('AB-1 a new-style product without a given variant fails with 23503 and stores nothing', async () => {
    expect(await captureSqlCode(insertLine(NEW_PRODUCT_ID))).toBe('23503');
    expect(await countLines()).toBe(0);
  });
});
