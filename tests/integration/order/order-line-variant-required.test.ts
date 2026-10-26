import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { seedProduct } from '../../helpers/catalog-fixtures';

const SUPPLIER_ORG_ID = '0199c025-0000-7000-8000-000000000001';
const OWNER_ID = '0199c025-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c025-0000-7000-8000-000000000012';
const REL_ID = '0199c025-0000-7000-8000-000000000021';
const ORDER_ID = '0199c025-0000-7000-8000-000000000031';
const OLD_PRODUCT_ID = '0199c025-0000-7000-8000-000000000041';
const NEW_PRODUCT_ID = '0199c025-0000-7000-8000-000000000042';
const LINE_ID = '0199c025-0000-7000-8000-000000000061';
const LINE_2_ID = '0199c025-0000-7000-8000-000000000062';
const AT = new Date('2026-01-02T00:00:00.000Z');
const OLD_DATE = '2026-01-02T00:00:00.000Z';

const MIGRATION = join(
  __dirname,
  '../../../prisma/migrations/20261019150000_ord_025_order_line_variant_required/migration.sql'
);

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

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

/** The database's own error message, without the SQL text Prisma may add. */
function databaseMessage(error: unknown): string {
  const candidate = error as SqlError;
  return candidate.meta?.driverAdapterError?.cause?.message ?? candidate.message ?? '';
}

async function captureError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  return undefined;
}

/** The lines of the migration between `-- <name> start` and `-- <name> end`, comments removed. */
function block(name: string): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf(`-- ${name} start`);
  const end = sql.indexOf(`-- ${name} end`);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql
    .slice(start + `-- ${name} start`.length, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();
}

/** Inserts a 2 x 3000 line and raises the order total by the same amount in one statement. */
function insertLine(tx: Tx | typeof prisma, id: string, product: string): Promise<number> {
  return tx.$executeRaw`
    WITH inserted AS (
      INSERT INTO order_lines (
        id, order_id, product_id, label_applied, quantity,
        reference_price, unit_price_applied, amount
      )
      VALUES (${id}::uuid, ${ORDER_ID}::uuid, ${product}::uuid, 'Fixture Label', 2,
        3000, 3000, 6000)
      RETURNING id
    )
    UPDATE orders SET total_amount = total_amount + 6000 WHERE id = ${ORDER_ID}::uuid
  `;
}

class Rollback extends Error {}

/**
 * Runs `body` against the state before the migration: the variant column accepts
 * empty values and the insert trigger does not fill them, as for lines saved before
 * ORD-024. Always rolled back, so the schema change never leaves the transaction.
 */
async function beforeMigration(body: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE order_lines ALTER COLUMN product_variant_id DROP NOT NULL'
      );
      await tx.$executeRawUnsafe(
        'ALTER TABLE order_lines DISABLE TRIGGER order_lines_a_fill_variant'
      );
      await body(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** Inserts a line without a variant, dated long ago so a later move is visible. */
async function insertOldLine(tx: Tx, id: string, product: string): Promise<void> {
  await tx.$executeRawUnsafe(
    'ALTER TABLE order_lines DISABLE TRIGGER order_lines_set_server_updated_at'
  );
  await insertLine(tx, id, product);
  await tx.$executeRaw`
    UPDATE order_lines SET server_updated_at = ${OLD_DATE}::timestamptz WHERE id = ${id}::uuid
  `;
  // Pending deferred checks (ORD-006) would block the ALTER TABLE below.
  await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
  await tx.$executeRawUnsafe(
    'ALTER TABLE order_lines ENABLE TRIGGER order_lines_set_server_updated_at'
  );
}

type LineRow = { product_variant_id: string | null; server_updated_at: Date };

async function readLine(tx: Tx, id: string): Promise<LineRow> {
  const [row] = await tx.$queryRaw<LineRow[]>`
    SELECT product_variant_id::text, server_updated_at FROM order_lines WHERE id = ${id}::uuid
  `;
  return row;
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700025011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700025012',
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
  // Old-style product: it has a variant with its own id.
  await seedProduct(prisma, {
    id: OLD_PRODUCT_ID,
    organizationId: SUPPLIER_ORG_ID,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3000n,
  });
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name)
    VALUES (${NEW_PRODUCT_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'Fixture Oil')
  `;
  await prisma.$executeRaw`
    INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
    VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'SUPPLIER'::public."OrderParty",
      ${OWNER_ID}::uuid, 0)
  `;
});

describe('order line variant required', () => {
  it('AC-1 copy: fills the variant from the product and moves server_updated_at, once', async () => {
    const copy = block('copy');
    await beforeMigration(async (tx) => {
      await insertOldLine(tx, LINE_ID, OLD_PRODUCT_ID);
      const before = await readLine(tx, LINE_ID);
      expect(before.product_variant_id).toBeNull();

      expect(await tx.$executeRawUnsafe(copy)).toBe(1);
      const filled = await readLine(tx, LINE_ID);
      expect(filled.product_variant_id).toBe(OLD_PRODUCT_ID);
      expect(filled.server_updated_at.getTime()).toBeGreaterThan(
        before.server_updated_at.getTime()
      );

      // A second run touches no row, so the date stays where the first run put it.
      expect(await tx.$executeRawUnsafe(copy)).toBe(0);
      const again = await readLine(tx, LINE_ID);
      expect(again.product_variant_id).toBe(OLD_PRODUCT_ID);
      expect(again.server_updated_at.getTime()).toBe(filled.server_updated_at.getTime());
    });
  });

  it('AB-1 audit: stops on a line with no variant to take, naming its id only, and fills nothing', async () => {
    const audit = block('audit');
    await beforeMigration(async (tx) => {
      await insertOldLine(tx, LINE_ID, NEW_PRODUCT_ID);
      await insertOldLine(tx, LINE_2_ID, OLD_PRODUCT_ID);
      await tx.$executeRawUnsafe('SAVEPOINT before_audit');

      const error = await captureError(tx.$executeRawUnsafe(audit));
      expect(error).toBeDefined();
      const message = databaseMessage(error);
      expect(message).toContain(LINE_ID);
      expect(message).not.toContain(LINE_2_ID);
      expect(message).not.toContain('Fixture');
      expect(message).not.toContain('6000');
      expect(message).not.toContain('3000');

      // The migration stops here, before any copy: no line gets a variant.
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT before_audit');
      expect((await readLine(tx, LINE_ID)).product_variant_id).toBeNull();
      expect((await readLine(tx, LINE_2_ID)).product_variant_id).toBeNull();
    });
  });

  it('audit: passes when every empty line has a variant of its product', async () => {
    const audit = block('audit');
    await beforeMigration(async (tx) => {
      await insertOldLine(tx, LINE_ID, OLD_PRODUCT_ID);
      await expect(tx.$executeRawUnsafe(audit)).resolves.toBeDefined();
    });
  });

  it('AC-2 required: the column is NOT NULL and an update to empty fails with 23502', async () => {
    await insertLine(prisma, LINE_ID, OLD_PRODUCT_ID);
    const error = await captureError(
      prisma.$executeRaw`UPDATE order_lines SET product_variant_id = NULL WHERE id = ${LINE_ID}::uuid`
    );
    expect(sqlCode(error)).toBe('23502');
    const [column] = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_lines'
        AND column_name = 'product_variant_id'
    `;
    expect(column.is_nullable).toBe('NO');
  });

  it('AC-2 required: a line inserted without a variant gets one from its product', async () => {
    await insertLine(prisma, LINE_ID, OLD_PRODUCT_ID);
    const [row] = await prisma.$queryRaw<Array<{ product_variant_id: string }>>`
      SELECT product_variant_id::text FROM order_lines WHERE id = ${LINE_ID}::uuid
    `;
    expect(row.product_variant_id).toBe(OLD_PRODUCT_ID);
  });

  it('AC-2 required: a create through the client may leave the variant out', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE orders SET total_amount = 6000 WHERE id = ${ORDER_ID}::uuid`;
      await tx.orderLine.create({
        data: {
          id: LINE_ID,
          orderId: ORDER_ID,
          productId: OLD_PRODUCT_ID,
          labelApplied: 'Fixture Label',
          quantity: 2,
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 6000n,
        },
      });
    });
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE_ID } });
    const productVariantId: string = line.productVariantId;
    expect(productVariantId).toBe(OLD_PRODUCT_ID);
  });
});
