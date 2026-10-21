import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { expectColumnType } from '../../helpers/db-schema';

const SUPPLIER_ORG_ID = '0199c006-0000-7000-8000-000000000001';
const OWNER_ID = '0199c006-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c006-0000-7000-8000-000000000012';
const GUEST_ID = '0199c006-0000-7000-8000-000000000013';
const REL_ID = '0199c006-0000-7000-8000-000000000021';
const ORDER_ID = '0199c006-0000-7000-8000-000000000031';
const PRODUCT_ID = '0199c006-0000-7000-8000-000000000041';
const LINE_ID = '0199c006-0000-7000-8000-000000000051';
const UNKNOWN_ID = '0199c006-0000-7000-8000-0000000009ff';
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
  productId?: string;
  label?: string | null;
  quantity?: string;
  delivered?: string | null;
  reference?: bigint;
  applied?: bigint;
  amount?: bigint;
  authorId?: string | null;
  authoredAt?: Date | null;
};

/**
 * Inserts an order line and raises its order's total by the same amount in one
 * statement (ORD-006), so line and total agree at commit and a commit-time
 * refusal keeps its own SQLSTATE; defaults make a valid 2.5 x 3000 line with no
 * price gap.
 */
function insertLine(row: Line = {}): Promise<number> {
  const quantity = row.quantity ?? '2.5';
  const delivered = 'delivered' in row ? row.delivered : null;
  const reference = row.reference ?? 3000n;
  const applied = row.applied ?? reference;
  const amount = row.amount ?? 7500n;
  const label = 'label' in row ? row.label : 'Fixture Rice';
  const orderId = row.orderId ?? ORDER_ID;
  return prisma.$executeRaw`
    WITH inserted AS (
      INSERT INTO order_lines (
        id, order_id, product_id, label_applied, quantity, delivered_quantity,
        reference_price, unit_price_applied, amount, price_set_by_id, price_set_at
      )
      VALUES (
        ${row.id ?? LINE_ID}::uuid, ${orderId}::uuid,
        ${row.productId ?? PRODUCT_ID}::uuid, ${label}::text, ${quantity}::numeric,
        ${delivered}::numeric, ${reference}::bigint, ${applied}::bigint, ${amount}::bigint,
        ${row.authorId ?? null}::uuid, ${row.authoredAt ?? null}::timestamptz
      )
      RETURNING id
    )
    UPDATE orders SET total_amount = total_amount + ${amount}::bigint WHERE id = ${orderId}::uuid
  `;
}

async function insertOrder(placedBy: 'CUSTOMER' | 'SUPPLIER', id = ORDER_ID): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
    VALUES (${id}::uuid, ${REL_ID}::uuid, ${placedBy}::text::public."OrderParty",
      ${OWNER_ID}::uuid, 0)
  `;
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
      { id: GUEST_ID, phoneNumber: '+2250700006013' },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await seedProduct(prisma, {
    id: PRODUCT_ID,
    organizationId: SUPPLIER_ORG_ID,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3000n,
  });
  await insertOrder('SUPPLIER');
});

describe('order line amount rule (AC-1, C-20, CM-14, C-01, C-35)', () => {
  const rows: Array<[string, string | null, bigint, bigint, boolean]> = [
    ['2.5', null, 333n, 833n, true],
    ['2.5', null, 333n, 832n, false],
    ['10', '8', 3000n, 24000n, true],
    ['10', '8', 3000n, 30000n, false],
    ['0.001', null, 500n, 1n, true],
    ['0.001', null, 499n, 0n, true],
  ];

  it.each(rows)('q=%s d=%s p=%s a=%s accepted=%s', async (q, d, p, a, accepted) => {
    const code = await captureSqlCode(
      insertLine({ quantity: q, delivered: d, reference: p, amount: a })
    );
    expect(code).toBe(accepted ? undefined : '23514');
  });

  it('uses the expected column types, defaults and server_updated_at', async () => {
    await insertLine({ quantity: '2.5', reference: 333n, amount: 833n });
    const read = () =>
      prisma.$queryRaw<Array<{ server_updated_at: Date; deleted_at: Date | null }>>`
        SELECT server_updated_at, deleted_at FROM order_lines WHERE id = ${LINE_ID}::uuid
      `;
    const [before] = await read();
    expect(before.deleted_at).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await prisma.$executeRaw`
      UPDATE order_lines SET label_applied = 'Renamed' WHERE id = ${LINE_ID}::uuid
    `;
    const [after] = await read();
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());

    for (const column of ['id', 'order_id', 'product_id', 'price_set_by_id']) {
      await expectColumnType('order_lines', column, 'uuid');
    }
    const [productColumn] = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_lines' AND column_name = 'product_id'
    `;
    expect(productColumn.is_nullable).toBe('YES');
    for (const column of ['reference_price', 'unit_price_applied', 'amount']) {
      await expectColumnType('order_lines', column, 'bigint');
    }
    for (const column of ['quantity', 'delivered_quantity']) {
      await expectColumnType('order_lines', column, 'numeric', [12, 3]);
    }
    for (const column of ['price_set_at', 'server_updated_at', 'deleted_at']) {
      await expectColumnType('order_lines', column, 'timestamptz');
    }
  });

  it('has indexes on order_id and product_id', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'order_lines'
    `;
    for (const columns of ['(order_id)', '(product_id)']) {
      expect(
        rows.some((r) => r.indexdef.includes(columns)),
        columns
      ).toBe(true);
    }
  });

  it('rejects an amount that no longer matches after an update', async () => {
    await insertLine();
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE order_lines SET quantity = 3 WHERE id = ${LINE_ID}::uuid`
    );
    expect(code).toBe('23514');
  });
});

describe('order line quantities (AC-2)', () => {
  it('rejects quantity 0 with 23514', async () => {
    expect(await captureSqlCode(insertLine({ quantity: '0', amount: 0n }))).toBe('23514');
  });

  it('rejects delivered_quantity above quantity with 23514', async () => {
    expect(
      await captureSqlCode(insertLine({ quantity: '10', delivered: '11', amount: 33000n }))
    ).toBe('23514');
  });

  it('rejects a negative delivered_quantity with 23514', async () => {
    expect(await captureSqlCode(insertLine({ quantity: '10', delivered: '-1', amount: 0n }))).toBe(
      '23514'
    );
  });

  it('accepts delivered_quantity 0', async () => {
    await expect(insertLine({ quantity: '10', delivered: '0', amount: 0n })).resolves.toBe(1);
  });
});

describe('order line price gap (AC-3, C-20, C-04)', () => {
  const gap = { reference: 3000n, applied: 2800n, amount: 7000n };

  it('accepts a gap with author and time', async () => {
    await expect(insertLine({ ...gap, authorId: OWNER_ID, authoredAt: AT })).resolves.toBe(1);
  });

  it('rejects a gap without author with 23514', async () => {
    expect(await captureSqlCode(insertLine(gap))).toBe('23514');
  });

  it('rejects a gap with an author but no time, or a time but no author', async () => {
    expect(await captureSqlCode(insertLine({ ...gap, authorId: OWNER_ID }))).toBe('23514');
    expect(await captureSqlCode(insertLine({ ...gap, authoredAt: AT }))).toBe('23514');
  });

  it('rejects an author on an equal price with 23514', async () => {
    expect(await captureSqlCode(insertLine({ authorId: OWNER_ID, authoredAt: AT }))).toBe('23514');
    expect(await captureSqlCode(insertLine({ authorId: OWNER_ID }))).toBe('23514');
  });

  it('accepts an equal price with no author', async () => {
    await expect(insertLine()).resolves.toBe(1);
  });

  it('rejects negative prices with 23514', async () => {
    expect(await captureSqlCode(insertLine({ reference: -1n, applied: -1n, amount: 0n }))).toBe(
      '23514'
    );
    expect(
      await captureSqlCode(
        insertLine({
          reference: 3000n,
          applied: -1n,
          amount: 0n,
          authorId: OWNER_ID,
          authoredAt: AT,
        })
      )
    ).toBe('23514');
  });

  it('rejects a guest as the price author with 23514 (C-04)', async () => {
    expect(await captureSqlCode(insertLine({ ...gap, authorId: GUEST_ID, authoredAt: AT }))).toBe(
      '23514'
    );
  });
});

describe('customer-placed orders (AC-4, C-20)', () => {
  const CUSTOMER_ORDER_ID = '0199c006-0000-7000-8000-000000000032';

  beforeEach(async () => {
    await insertOrder('CUSTOMER', CUSTOMER_ORDER_ID);
  });

  it('accepts a line at the reference price and rejects any gap without an author', async () => {
    await expect(insertLine({ orderId: CUSTOMER_ORDER_ID })).resolves.toBe(1);
    expect(
      await captureSqlCode(
        insertLine({
          id: '0199c006-0000-7000-8000-000000000052',
          orderId: CUSTOMER_ORDER_ID,
          reference: 3000n,
          applied: 3500n,
          amount: 8750n,
        })
      )
    ).toBe('23514');
    expect(
      await captureSqlCode(
        insertLine({
          id: '0199c006-0000-7000-8000-000000000053',
          orderId: CUSTOMER_ORDER_ID,
          reference: 3000n,
          applied: 2800n,
          amount: 7000n,
        })
      )
    ).toBe('23514');
  });
});

describe('order line keys and required columns (AC-4)', () => {
  it('rejects an unknown order or product with 23503', async () => {
    expect(await captureSqlCode(insertLine({ orderId: UNKNOWN_ID }))).toBe('23503');
    expect(await captureSqlCode(insertLine({ productId: UNKNOWN_ID }))).toBe('23503');
  });

  it('rejects an unknown price author with 23503', async () => {
    expect(
      await captureSqlCode(
        insertLine({
          reference: 3000n,
          applied: 2800n,
          amount: 7000n,
          authorId: UNKNOWN_ID,
          authoredAt: AT,
        })
      )
    ).toBe('23503');
  });

  it('rejects a null label_applied with 23502', async () => {
    expect(await captureSqlCode(insertLine({ label: null }))).toBe('23502');
  });
});

describe('price gap without an author (AB-1, CWE-778)', () => {
  it('is refused by PostgreSQL with 23514', async () => {
    expect(await captureSqlCode(insertLine({ reference: 3000n, applied: 1n, amount: 3n }))).toBe(
      '23514'
    );
  });
});
