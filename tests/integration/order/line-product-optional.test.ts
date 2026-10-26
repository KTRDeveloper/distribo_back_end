import { beforeEach, describe, expect, it } from 'vitest';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup';

const SUPPLIER_ID = '0199c032-0000-7000-8000-000000000001';
const OTHER_SUPPLIER_ID = '0199c032-0000-7000-8000-000000000002';
const OWNER_ID = '0199c032-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c032-0000-7000-8000-000000000012';
const REL_ID = '0199c032-0000-7000-8000-000000000021';
const ORDER_ID = '0199c032-0000-7000-8000-000000000031';
const PRODUCT_ID = '0199c032-0000-7000-8000-000000000041';
const OTHER_PRODUCT_ID = '0199c032-0000-7000-8000-000000000042';
const VARIANT_ID = '0199c032-0000-7000-8000-000000000043';
const UNKNOWN_ID = '0199c032-0000-7000-8000-000000000044';
const LINE_ID = '0199c032-0000-7000-8000-000000000051';
const AT = new Date('2026-01-02T00:00:00.000Z');

/** Inserts the line and its matching total atomically, preserving the deferred total rule. */
function insertLine(variantId = VARIANT_ID, quantity = '5') {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO order_lines (
        id, order_id, product_variant_id, label_applied, quantity,
        reference_price, unit_price_applied, amount
      ) VALUES (
        ${LINE_ID}::uuid, ${ORDER_ID}::uuid, ${variantId}::uuid,
        'Fixture Rice', ${quantity}::numeric, 3000, 3000,
        round(${quantity}::numeric * 3000)::bigint
      )
    `;
    await tx.$executeRaw`
      UPDATE orders SET total_amount = round(${quantity}::numeric * 3000)::bigint
      WHERE id = ${ORDER_ID}::uuid
    `;
  });
}

/** Checks SQLSTATE and rollback, rather than accepting any database exception. */
async function expectRejected(operation: Promise<unknown>, code: string) {
  await expect(operation).rejects.toMatchObject({
    meta: { driverAdapterError: { cause: { originalCode: code } } },
  });
  expect(await prisma.orderLine.count({ where: { id: LINE_ID } })).toBe(0);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
  expect(order.totalAmount).toBe(0n);
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700003211', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700003212',
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
    name: 'Fixture Other Rice',
    unit: 'sack',
    price: 3000n,
  });
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, min_order_quantity)
    VALUES (${VARIANT_ID}::uuid, ${PRODUCT_ID}::uuid, ${SUPPLIER_ID}::uuid,
      'Fixture Small', 'bag', 3000, 5)
  `;
  await prisma.$executeRaw`
    INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
    VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'CUSTOMER', ${OWNER_ID}::uuid, 0)
  `;
});

describe('optional order-line product (ORD-032)', () => {
  it('saves a line with its variant and no product (AC-1)', async () => {
    await insertLine();
    const [line] = await prisma.$queryRaw<Array<{ product_variant_id: string }>>`
      SELECT product_variant_id FROM order_lines WHERE id = ${LINE_ID}::uuid
    `;
    expect(line).toEqual({ product_variant_id: VARIANT_ID });
  });

  it('accepts an ACTIVE variant of the supplier with the product column omitted (AC-2)', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO order_lines (
          id, order_id, product_variant_id, label_applied, quantity,
          reference_price, unit_price_applied, amount
        ) VALUES (${LINE_ID}::uuid, ${ORDER_ID}::uuid, ${VARIANT_ID}::uuid,
          'Fixture Rice', 5, 3000, 3000, 15000)
      `;
      await tx.$executeRaw`UPDATE orders SET total_amount = 15000 WHERE id = ${ORDER_ID}::uuid`;
    });
    expect(await prisma.orderLine.count({ where: { id: LINE_ID } })).toBe(1);
  });

  it('rejects another business variant without a product and leaves no line (AC-2, AB-1)', async () => {
    await expectRejected(insertLine(OTHER_PRODUCT_ID), '23514');
  });

  it('rejects an INACTIVE variant without a product (AC-2)', async () => {
    await prisma.$executeRaw`UPDATE product_variants SET status = 'INACTIVE' WHERE id = ${VARIANT_ID}::uuid`;
    await expectRejected(insertLine(), '23514');
  });

  it('rejects an unknown variant with 23503 (AC-2)', async () => {
    await expectRejected(insertLine(UNKNOWN_ID), '23503');
  });

  it.each(['deleted variant', 'deleted product', 'paused product'])(
    'rejects a %s without a product id (C-15)',
    async (state) => {
      if (state === 'deleted variant') {
        await prisma.$executeRaw`UPDATE product_variants SET deleted_at = now() WHERE id = ${VARIANT_ID}::uuid`;
      } else if (state === 'deleted product') {
        await prisma.$executeRaw`UPDATE products SET deleted_at = now() WHERE id = ${PRODUCT_ID}::uuid`;
      } else {
        await prisma.$executeRaw`UPDATE products SET paused_at = now() WHERE id = ${PRODUCT_ID}::uuid`;
      }
      await expectRejected(insertLine(), '23514');
    }
  );

  it('rejects quantity just below the variant minimum without a product (C-15)', async () => {
    await expectRejected(insertLine(VARIANT_ID, '4.999'), '23514');
  });
});
