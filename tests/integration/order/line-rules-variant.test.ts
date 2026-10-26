import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { seedProduct } from '../../helpers/catalog-fixtures';

const SUPPLIER_ORG_ID = '0199c026-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199c026-0000-7000-8000-000000000002';
const OWNER_ID = '0199c026-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c026-0000-7000-8000-000000000012';
const REL_ID = '0199c026-0000-7000-8000-000000000021';
const CUSTOMER_ORDER_ID = '0199c026-0000-7000-8000-000000000031';
const SUPPLIER_ORDER_ID = '0199c026-0000-7000-8000-000000000032';
// New-style product of the supplier and its variant (minimum 5).
const PRODUCT_ID = '0199c026-0000-7000-8000-000000000041';
const VARIANT_ID = '0199c026-0000-7000-8000-000000000051';
// A second product of the supplier, for a variant that sits under another product.
const SIBLING_PRODUCT_ID = '0199c026-0000-7000-8000-000000000042';
const SIBLING_VARIANT_ID = '0199c026-0000-7000-8000-000000000052';
// Product and variant of another business.
const FOREIGN_PRODUCT_ID = '0199c026-0000-7000-8000-000000000043';
const FOREIGN_VARIANT_ID = '0199c026-0000-7000-8000-000000000053';
// Old-style product: its variant has the same id.
const OLD_PRODUCT_ID = '0199c026-0000-7000-8000-000000000044';
const UNKNOWN_ID = '0199c026-0000-7000-8000-0000000009ff';
const LINE_ID = '0199c026-0000-7000-8000-000000000061';
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
  orderId?: string;
  productId?: string;
  variantId?: string;
  quantity?: string;
  amount?: bigint;
  /** Runs the insert with the retired-variant setting on for the transaction (SYNC-012). */
  allowRetired?: boolean;
};

/**
 * Inserts a line at the reference price 3000 and raises its order total by the
 * same amount in one transaction (ORD-006). Defaults: 5 on the customer order.
 */
function insertLine(row: Line = {}): Promise<unknown> {
  const quantity = row.quantity ?? '5';
  const amount = row.amount ?? 15000n;
  const orderId = row.orderId ?? CUSTOMER_ORDER_ID;
  const insert = (tx: Pick<typeof prisma, '$executeRaw'>) =>
    tx.$executeRaw`
      WITH inserted AS (
        INSERT INTO order_lines (
          id, order_id, product_id, product_variant_id, label_applied, quantity,
          reference_price, unit_price_applied, amount
        )
        VALUES (${LINE_ID}::uuid, ${orderId}::uuid, ${row.productId ?? PRODUCT_ID}::uuid,
          ${row.variantId ?? VARIANT_ID}::uuid, 'Fixture Rice', ${quantity}::numeric,
          3000, 3000, ${amount}::bigint)
        RETURNING id
      )
      UPDATE orders SET total_amount = total_amount + ${amount}::bigint WHERE id = ${orderId}::uuid
    `;
  if (!row.allowRetired) return insert(prisma);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('distribo.allow_retired_product', 'on', true)`;
    return insert(tx);
  });
}

/** A product without variant when `unit` is empty, else a product with a variant of its own id. */
async function insertProduct(id: string, orgId: string, unit: string): Promise<void> {
  if (unit === '') {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name)
      VALUES (${id}::uuid, ${orgId}::uuid, 'Fixture Product')
    `;
    return;
  }
  await seedProduct(prisma, { id, organizationId: orgId, name: 'Fixture Product', unit, price: 3000n });
}

async function insertVariant(
  id: string,
  productId: string,
  orgId: string,
  minQuantity: string | null
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, min_order_quantity)
    VALUES (${id}::uuid, ${productId}::uuid, ${orgId}::uuid, 'Fixture Variant', 'sack', 3000,
      ${minQuantity}::numeric)
  `;
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700026011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700026012',
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
  await insertProduct(PRODUCT_ID, SUPPLIER_ORG_ID, '');
  await insertVariant(VARIANT_ID, PRODUCT_ID, SUPPLIER_ORG_ID, '5');
  await insertProduct(SIBLING_PRODUCT_ID, SUPPLIER_ORG_ID, '');
  await insertVariant(SIBLING_VARIANT_ID, SIBLING_PRODUCT_ID, SUPPLIER_ORG_ID, null);
  await insertProduct(FOREIGN_PRODUCT_ID, OTHER_ORG_ID, '');
  await insertVariant(FOREIGN_VARIANT_ID, FOREIGN_PRODUCT_ID, OTHER_ORG_ID, null);
  await insertProduct(OLD_PRODUCT_ID, SUPPLIER_ORG_ID, 'sack');
  for (const [id, party] of [
    [CUSTOMER_ORDER_ID, 'CUSTOMER'],
    [SUPPLIER_ORDER_ID, 'SUPPLIER'],
  ] as const) {
    await prisma.$executeRaw`
      INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
      VALUES (${id}::uuid, ${REL_ID}::uuid, ${party}::text::public."OrderParty",
        ${OWNER_ID}::uuid, 0)
    `;
  }
});

describe('control', () => {
  it('accepts an ACTIVE variant of the supplier', async () => {
    await expect(insertLine()).resolves.toBeDefined();
    expect(await countLines()).toBe(1);
  });
});

describe('refused lines (AC-1, C-15)', () => {
  const retire: Array<[string, () => Promise<unknown>, Line]> = [
    [
      'a variant of another business',
      () => Promise.resolve(),
      { productId: FOREIGN_PRODUCT_ID, variantId: FOREIGN_VARIANT_ID },
    ],
    [
      'an INACTIVE variant',
      () =>
        prisma.$executeRaw`
          UPDATE product_variants SET status = 'INACTIVE' WHERE id = ${VARIANT_ID}::uuid
        `,
      {},
    ],
    [
      'a deleted variant',
      () =>
        prisma.$executeRaw`
          UPDATE product_variants SET deleted_at = now() WHERE id = ${VARIANT_ID}::uuid
        `,
      {},
    ],
    [
      'a variant of a deleted product',
      () =>
        prisma.$executeRaw`
          UPDATE products SET deleted_at = now() WHERE id = ${PRODUCT_ID}::uuid
        `,
      {},
    ],
    [
      'a variant of a paused product',
      () =>
        prisma.$executeRaw`
          UPDATE products SET paused_at = now() WHERE id = ${PRODUCT_ID}::uuid
        `,
      {},
    ],
    [
      "a variant that belongs to another product than the line's product_id",
      () => Promise.resolve(),
      { productId: PRODUCT_ID, variantId: SIBLING_VARIANT_ID },
    ],
  ];

  it.each(retire)('%s fails with 23514', async (_name, prepare, line) => {
    await prepare();
    expect(await captureSqlCode(insertLine(line))).toBe('23514');
    expect(await countLines()).toBe(0);
  });

  it('leaves an unknown variant to the key (23503)', async () => {
    expect(await captureSqlCode(insertLine({ variantId: UNKNOWN_ID }))).toBe('23503');
  });
});

describe('the minimum is the variant (AC-2, C-15)', () => {
  it('refuses 4.999 on a customer-placed order', async () => {
    expect(await captureSqlCode(insertLine({ quantity: '4.999', amount: 14997n }))).toBe('23514');
  });

  it('accepts 5 on a customer-placed order', async () => {
    expect(await captureSqlCode(insertLine())).toBeUndefined();
  });

  it('accepts 1 on a supplier-placed order', async () => {
    expect(
      await captureSqlCode(insertLine({ orderId: SUPPLIER_ORDER_ID, quantity: '1', amount: 3000n }))
    ).toBeUndefined();
  });
});

describe('retired variants through synchronization (AC-3)', () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    [
      'an INACTIVE variant',
      () =>
        prisma.$executeRaw`
          UPDATE product_variants SET status = 'INACTIVE' WHERE id = ${VARIANT_ID}::uuid
        `,
    ],
    [
      'a deleted variant',
      () =>
        prisma.$executeRaw`
          UPDATE product_variants SET deleted_at = now() WHERE id = ${VARIANT_ID}::uuid
        `,
    ],
    [
      'a variant of a paused product',
      () =>
        prisma.$executeRaw`
          UPDATE products SET paused_at = now() WHERE id = ${PRODUCT_ID}::uuid
        `,
    ],
    [
      'a variant of a deleted product',
      () =>
        prisma.$executeRaw`
          UPDATE products SET deleted_at = now() WHERE id = ${PRODUCT_ID}::uuid
        `,
    ],
  ];

  it.each(cases)('accepts %s when the setting is on', async (_name, retire) => {
    await retire();
    expect(await captureSqlCode(insertLine({ allowRetired: true }))).toBeUndefined();
    expect(await countLines()).toBe(1);
  });

  it('still refuses a variant of another business', async () => {
    expect(
      await captureSqlCode(
        insertLine({
          productId: FOREIGN_PRODUCT_ID,
          variantId: FOREIGN_VARIANT_ID,
          allowRetired: true,
        })
      )
    ).toBe('23514');
  });

  it('still refuses a variant that belongs to another product', async () => {
    expect(
      await captureSqlCode(
        insertLine({ productId: PRODUCT_ID, variantId: SIBLING_VARIANT_ID, allowRetired: true })
      )
    ).toBe('23514');
  });

  it('still applies the minimum', async () => {
    expect(
      await captureSqlCode(insertLine({ quantity: '4.999', amount: 14997n, allowRetired: true }))
    ).toBe('23514');
  });
});

describe('products whose variant has their id behave as before (AC-4)', () => {
  it('refuses a line for a variant set INACTIVE with a direct update', async () => {
    await prisma.$executeRaw`
      UPDATE product_variants SET status = 'INACTIVE' WHERE id = ${OLD_PRODUCT_ID}::uuid
    `;
    expect(
      await captureSqlCode(insertLine({ productId: OLD_PRODUCT_ID, variantId: OLD_PRODUCT_ID }))
    ).toBe('23514');
  });

  it('accepts a line for an ACTIVE old-style product', async () => {
    expect(
      await captureSqlCode(insertLine({ productId: OLD_PRODUCT_ID, variantId: OLD_PRODUCT_ID }))
    ).toBeUndefined();
  });
});

describe('a variant of another business with the setting on (AB-1, CWE-639)', () => {
  it('is refused with 23514 on both kinds of order', async () => {
    for (const orderId of [CUSTOMER_ORDER_ID, SUPPLIER_ORDER_ID]) {
      expect(
        await captureSqlCode(
          insertLine({
            orderId,
            productId: FOREIGN_PRODUCT_ID,
            variantId: FOREIGN_VARIANT_ID,
            quantity: '5',
            allowRetired: true,
          })
        )
      ).toBe('23514');
    }
    expect(await countLines()).toBe(0);
  });
});
