import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const SUPPLIER_ORG_ID = '0199c006-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199c006-0000-7000-8000-000000000002';
const OWNER_ID = '0199c006-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c006-0000-7000-8000-000000000012';
const REL_ID = '0199c006-0000-7000-8000-000000000021';
const PERSON_REL_ID = '0199c006-0000-7000-8000-000000000022';
const SUPPLIER_ORDER_ID = '0199c006-0000-7000-8000-000000000031';
const CUSTOMER_ORDER_ID = '0199c006-0000-7000-8000-000000000032';
const PERSON_ORDER_ID = '0199c006-0000-7000-8000-000000000033';
const PRODUCT_ID = '0199c006-0000-7000-8000-000000000041';
const OTHER_PRODUCT_ID = '0199c006-0000-7000-8000-000000000042';
const LINE_ID = '0199c006-0000-7000-8000-000000000051';
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

type Line = {
  id?: string;
  orderId?: string;
  variantId?: string;
  quantity?: string;
  reference?: bigint;
  applied?: bigint;
  amount?: bigint;
  authorId?: string | null;
  authoredAt?: Date | null;
};

/** Moves an order's total by a line amount change, so line and total agree at commit (ORD-006). */
function moveTotal(orderId: string, delta: bigint) {
  return prisma.$executeRaw`
    UPDATE orders SET total_amount = total_amount + ${delta}::bigint WHERE id = ${orderId}::uuid
  `;
}

/**
 * Inserts a line and raises its order's total by the same amount in one
 * transaction (ORD-006); defaults make a valid 5 x 3000 line at the reference price.
 */
async function insertLine(row: Line = {}): Promise<number> {
  const reference = row.reference ?? 3000n;
  const applied = row.applied ?? reference;
  const quantity = row.quantity ?? '5';
  const amount = row.amount ?? 15000n;
  const [inserted] = await prisma.$transaction([
    prisma.$executeRaw`
    INSERT INTO order_lines (
      id, order_id, product_variant_id, label_applied, quantity,
      reference_price, unit_price_applied, amount, price_set_by_id, price_set_at
    )
    VALUES (
      ${row.id ?? LINE_ID}::uuid, ${row.orderId ?? CUSTOMER_ORDER_ID}::uuid,
      ${row.variantId ?? PRODUCT_ID}::uuid, 'Fixture Rice', ${quantity}::numeric,
      ${reference}::bigint, ${applied}::bigint, ${amount}::bigint,
      ${row.authorId ?? null}::uuid, ${row.authoredAt ?? null}::timestamptz
    )
  `,
    moveTotal(row.orderId ?? CUSTOMER_ORDER_ID, amount),
  ]);
  return inserted;
}

async function insertOrder(
  id: string,
  placedBy: 'CUSTOMER' | 'SUPPLIER',
  relId = REL_ID
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
    VALUES (${id}::uuid, ${relId}::uuid, ${placedBy}::text::public."OrderParty",
      ${OWNER_ID}::uuid, 0)
  `;
}

async function insertProduct(
  id: string,
  orgId: string,
  minQuantity: string | null = '5'
): Promise<void> {
  await seedProduct(prisma, {
    id,
    organizationId: orgId,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3000n,
    minOrderQuantity: minQuantity,
  });
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700006011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700006012',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier'), (${OTHER_ORG_ID}::uuid, 'Fixture Other')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await insertProduct(PRODUCT_ID, SUPPLIER_ORG_ID);
  await insertOrder(CUSTOMER_ORDER_ID, 'CUSTOMER');
  await insertOrder(SUPPLIER_ORDER_ID, 'SUPPLIER');
});

describe('product rule (AC-1, C-15, AB-1)', () => {
  it('accepts an ACTIVE product of the supplier', async () => {
    await expect(insertLine()).resolves.toBe(1);
  });

  it('rejects an INACTIVE product of the supplier with 23514', async () => {
    await prisma.$executeRaw`
      UPDATE product_variants SET status = 'INACTIVE' WHERE id = ${PRODUCT_ID}::uuid
    `;
    expect(await captureSqlCode(insertLine())).toBe('23514');
  });

  it('rejects a product of another organization with 23514 (AB-1)', async () => {
    await insertProduct(OTHER_PRODUCT_ID, OTHER_ORG_ID);
    expect(await captureSqlCode(insertLine({ variantId: OTHER_PRODUCT_ID }))).toBe('23514');
    expect(
      await captureSqlCode(insertLine({ variantId: OTHER_PRODUCT_ID, orderId: SUPPLIER_ORDER_ID }))
    ).toBe('23514');
  });

  it('rejects a deleted product with 23514', async () => {
    await prisma.$executeRaw`
      UPDATE products SET deleted_at = now() WHERE id = ${PRODUCT_ID}::uuid
    `;
    expect(await captureSqlCode(insertLine())).toBe('23514');
  });

  it('rejects any product on an order whose relationship has a person as supplier', async () => {
    await prisma.$executeRaw`
      INSERT INTO customer_relationships (
        id, supplier_person_id, customer_person_id, created_by_id, status
      )
      VALUES (${PERSON_REL_ID}::uuid, ${OWNER_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid,
        'PENDING'::public."RelationshipStatus")
    `;
    // The order guard (ORD-003) refuses orders on such a relationship, so the
    // order is added with the trigger off to reach the line rule on its own.
    await prisma.$executeRaw`ALTER TABLE orders DISABLE TRIGGER orders_creation_guard`;
    try {
      await insertOrder(PERSON_ORDER_ID, 'SUPPLIER', PERSON_REL_ID);
    } finally {
      await prisma.$executeRaw`ALTER TABLE orders ENABLE TRIGGER orders_creation_guard`;
    }
    expect(await captureSqlCode(insertLine({ orderId: PERSON_ORDER_ID }))).toBe('23514');
  });
});

describe('minimum quantity (AC-2, C-15)', () => {
  const rows: Array<[string, 'CUSTOMER' | 'SUPPLIER', string, bigint, string | undefined]> = [
    ['CUSTOMER below', 'CUSTOMER', '4.999', 14997n, '23514'],
    ['CUSTOMER at the minimum', 'CUSTOMER', '5', 15000n, undefined],
    ['SUPPLIER below', 'SUPPLIER', '1', 3000n, undefined],
  ];

  it.each(rows)('%s', async (_name, party, quantity, amount, expected) => {
    const orderId = party === 'CUSTOMER' ? CUSTOMER_ORDER_ID : SUPPLIER_ORDER_ID;
    expect(await captureSqlCode(insertLine({ orderId, quantity, amount }))).toBe(expected);
  });

  it('accepts any quantity on a product without a minimum', async () => {
    await prisma.$executeRaw`
      UPDATE product_variants SET min_order_quantity = NULL WHERE id = ${PRODUCT_ID}::uuid
    `;
    await expect(insertLine({ quantity: '0.001', amount: 3n })).resolves.toBe(1);
  });
});

describe('later changes do not block (AC-3)', () => {
  it('updates delivered_quantity after the product became INACTIVE or its minimum rose', async () => {
    await insertLine({ orderId: SUPPLIER_ORDER_ID });
    await prisma.$executeRaw`
      UPDATE product_variants SET status = 'INACTIVE', min_order_quantity = 50
      WHERE id = ${PRODUCT_ID}::uuid
    `;
    await expect(
      prisma.$transaction([
        prisma.$executeRaw`
          UPDATE order_lines SET delivered_quantity = 4, amount = 12000 WHERE id = ${LINE_ID}::uuid
        `,
        moveTotal(SUPPLIER_ORDER_ID, -3000n),
      ])
    ).resolves.toEqual([1, 1]);
  });

  it('keeps the customer-order line updatable after the product was deleted', async () => {
    await insertLine();
    await prisma.$executeRaw`
      UPDATE products SET deleted_at = now() WHERE id = ${PRODUCT_ID}::uuid
    `;
    await expect(
      prisma.$transaction([
        prisma.$executeRaw`
          UPDATE order_lines SET delivered_quantity = 4, amount = 12000 WHERE id = ${LINE_ID}::uuid
        `,
        moveTotal(CUSTOMER_ORDER_ID, -3000n),
      ])
    ).resolves.toEqual([1, 1]);
  });
});

describe('customer order prices (AC-4, C-20, CM-16)', () => {
  it('rejects a line inserted above or below the reference price with 23514', async () => {
    expect(await captureSqlCode(insertLine({ applied: 3500n, amount: 17500n }))).toBe('23514');
    expect(
      await captureSqlCode(
        insertLine({ applied: 2800n, amount: 14000n, authorId: OWNER_ID, authoredAt: AT })
      )
    ).toBe('23514');
  });

  it('accepts a supplier-order line with a price gap and its author', async () => {
    await expect(
      insertLine({
        orderId: SUPPLIER_ORDER_ID,
        applied: 3500n,
        amount: 17500n,
        authorId: OWNER_ID,
        authoredAt: AT,
      })
    ).resolves.toBe(1);
  });

  it('refuses a raise above the reference and accepts a lowering', async () => {
    await insertLine();
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          UPDATE order_lines
          SET unit_price_applied = 3500, amount = 17500,
              price_set_by_id = ${OWNER_ID}::uuid, price_set_at = now()
          WHERE id = ${LINE_ID}::uuid
        `
      )
    ).toBe('23514');
    await expect(
      prisma.$transaction([
        prisma.$executeRaw`
          UPDATE order_lines
          SET unit_price_applied = 2800, amount = 14000,
              price_set_by_id = ${OWNER_ID}::uuid, price_set_at = now()
          WHERE id = ${LINE_ID}::uuid
        `,
        moveTotal(CUSTOMER_ORDER_ID, -1000n),
      ])
    ).resolves.toEqual([1, 1]);
  });

  it('refuses raising the reference price out from under a lowered price', async () => {
    await insertLine();
    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE order_lines
        SET unit_price_applied = 2800, amount = 14000,
            price_set_by_id = ${OWNER_ID}::uuid, price_set_at = now()
        WHERE id = ${LINE_ID}::uuid
      `,
      moveTotal(CUSTOMER_ORDER_ID, -1000n),
    ]);
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          UPDATE order_lines SET reference_price = 2000 WHERE id = ${LINE_ID}::uuid
        `
      )
    ).toBe('23514');
  });
});

describe('foreign product by a crafted write (AB-1, CWE-639)', () => {
  it('is refused by PostgreSQL with 23514', async () => {
    await insertProduct(OTHER_PRODUCT_ID, OTHER_ORG_ID, null);
    expect(await captureSqlCode(insertLine({ variantId: OTHER_PRODUCT_ID }))).toBe('23514');
  });
});
