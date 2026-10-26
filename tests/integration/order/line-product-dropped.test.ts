import { beforeEach, describe, expect, it } from 'vitest';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup';

const SUPPLIER_ID = '0199c034-0000-7000-8000-000000000001';
const OTHER_SUPPLIER_ID = '0199c034-0000-7000-8000-000000000002';
const OWNER_ID = '0199c034-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c034-0000-7000-8000-000000000012';
const REL_ID = '0199c034-0000-7000-8000-000000000021';
const ORDER_ID = '0199c034-0000-7000-8000-000000000031';
const PRODUCT_ID = '0199c034-0000-7000-8000-000000000041';
const OTHER_PRODUCT_ID = '0199c034-0000-7000-8000-000000000042';
const UNKNOWN_ID = '0199c034-0000-7000-8000-000000000049';
const LINE_ID = '0199c034-0000-7000-8000-000000000051';
const AT = new Date('2026-01-02T00:00:00.000Z');

/** Inserts a 5 x 3000 line (and its order total, atomically) naming the given variant, or none. */
function insertLine(variantId: string | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO order_lines (
        id, order_id, product_variant_id, label_applied, quantity,
        reference_price, unit_price_applied, amount
      ) VALUES (
        ${LINE_ID}::uuid, ${ORDER_ID}::uuid, ${variantId}::uuid,
        'Fixture Rice', 5, 3000, 3000, 15000
      )
    `;
    await tx.$executeRaw`UPDATE orders SET total_amount = 15000 WHERE id = ${ORDER_ID}::uuid`;
  });
}

/** Checks the SQLSTATE and that nothing was kept, not just that some error occurred. */
async function expectRefused(operation: Promise<unknown>, code: string) {
  await expect(operation).rejects.toMatchObject({
    meta: { driverAdapterError: { cause: { originalCode: code } } },
  });
  expect(await prisma.orderLine.count({ where: { id: LINE_ID } })).toBe(0);
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700003411', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700003412',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${SUPPLIER_ID}::uuid, 'Fixture Supplier'), (${OTHER_SUPPLIER_ID}::uuid, 'Fixture Other')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${SUPPLIER_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await seedProduct(prisma, {
    id: PRODUCT_ID,
    organizationId: SUPPLIER_ID,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: OTHER_PRODUCT_ID,
    organizationId: OTHER_SUPPLIER_ID,
    name: 'Fixture Beans',
    unit: 'sack',
    price: 3000n,
  });
  await prisma.$executeRaw`
    INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
    VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'CUSTOMER'::public."OrderParty",
      ${OWNER_ID}::uuid, 0)
  `;
});

describe('the product column is gone (AC-1)', () => {
  it('has no product_id column, index or key, and requires product_variant_id', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_lines'
    `;
    expect(columns.map((c) => c.column_name)).not.toContain('product_id');
    expect(columns.find((c) => c.column_name === 'product_variant_id')?.is_nullable).toBe('NO');

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'order_lines'
    `;
    expect(indexes.map((i) => i.indexname)).not.toContain('order_lines_product_id_idx');
    const keys = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conrelid = 'public.order_lines'::regclass
    `;
    expect(keys.map((k) => k.conname)).not.toContain('order_lines_product_id_fkey');
  });

  it('has no trigger that fills the variant', async () => {
    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'public.order_lines'::regclass AND NOT tgisinternal
    `;
    expect(triggers.map((t) => t.tgname)).not.toContain('order_lines_a_fill_variant');
    const functions = await prisma.$queryRaw<Array<{ proname: string }>>`
      SELECT proname FROM pg_proc WHERE proname = 'order_lines_fill_variant'
    `;
    expect(functions).toEqual([]);
  });
});

describe('nothing fills the variant (AC-2, v5.0.0-2.2.1)', () => {
  it('refuses a line without product_variant_id with 23502', async () => {
    await expectRefused(insertLine(null), '23502');
  });
});

describe('the rules still hold (AC-3, C-15)', () => {
  it('accepts an ACTIVE variant of the supplier', async () => {
    await insertLine(PRODUCT_ID);
    expect(await prisma.orderLine.count({ where: { id: LINE_ID } })).toBe(1);
  });

  it('refuses a variant of another business with 23514', async () => {
    await expectRefused(insertLine(OTHER_PRODUCT_ID), '23514');
  });

  it('refuses an unknown variant id with 23503', async () => {
    await expectRefused(insertLine(UNKNOWN_ID), '23503');
  });

  it('refuses a paused product with 23514', async () => {
    await prisma.$executeRaw`UPDATE products SET paused_at = now() WHERE id = ${PRODUCT_ID}::uuid`;
    await expectRefused(insertLine(PRODUCT_ID), '23514');
  });
});

describe('an old-style insert after the drop (AB-1, CWE-20)', () => {
  it('is refused with 42703 and leaves no line', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO order_lines (
          id, order_id, product_id, product_variant_id, label_applied, quantity,
          reference_price, unit_price_applied, amount
        ) VALUES (
          ${LINE_ID}::uuid, ${ORDER_ID}::uuid, ${PRODUCT_ID}::uuid, ${PRODUCT_ID}::uuid,
          'Fixture Rice', 5, 3000, 3000, 15000
        )
      `
    ).rejects.toMatchObject({
      meta: { driverAdapterError: { cause: { originalCode: '42703' } } },
    });
    expect(await prisma.orderLine.count({ where: { id: LINE_ID } })).toBe(0);
  });
});
