import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { expectColumnType } from '../../helpers/db-schema';

const SUPPLIER_ORG_ID = '0199c005-0000-7000-8000-000000000001';
const OWNER_ID = '0199c005-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c005-0000-7000-8000-000000000012';
const GUEST_ID = '0199c005-0000-7000-8000-000000000013';
const REL_ID = '0199c005-0000-7000-8000-000000000021';
const ORDER_ID = '0199c005-0000-7000-8000-000000000031';
const OTHER_ORDER_ID = '0199c005-0000-7000-8000-000000000032';
const UNKNOWN_ID = '0199c005-0000-7000-8000-0000000009ff';

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

type Row = {
  id?: string;
  customerRelationshipId?: string;
  placedByParty?: string | null;
  enteredById?: string | null;
  totalAmount?: bigint | null;
  status?: string | null;
  cancelledByParty?: string | null;
  deliveredById?: string | null;
  cancelledById?: string | null;
  parentOrderId?: string | null;
  deliveredAt?: Date | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
};

/** Inserts an order; omitted status and cancelled_by_party use the column defaults or null. */
function insertOrder(row: Row = {}): Promise<number> {
  const placedBy = 'placedByParty' in row ? row.placedByParty : 'SUPPLIER';
  const enteredBy = 'enteredById' in row ? row.enteredById : OWNER_ID;
  const total = 'totalAmount' in row ? row.totalAmount : 0n;
  return prisma.$executeRaw`
    INSERT INTO orders (
      id, customer_relationship_id, placed_by_party, entered_by_id, total_amount,
      status, cancelled_by_party, delivered_by_id, cancelled_by_id, parent_order_id,
      delivered_at, cancelled_at, cancellation_reason
    )
    VALUES (
      ${row.id ?? ORDER_ID}::uuid, ${row.customerRelationshipId ?? REL_ID}::uuid,
      ${placedBy}::text::public."OrderParty", ${enteredBy}::uuid, ${total}::bigint,
      COALESCE(${row.status ?? null}::text, 'CONFIRMED')::public."OrderStatus",
      ${row.cancelledByParty ?? null}::text::public."OrderParty",
      ${row.deliveredById ?? null}::uuid, ${row.cancelledById ?? null}::uuid,
      ${row.parentOrderId ?? null}::uuid,
      ${row.deliveredAt ?? null}::timestamptz, ${row.cancelledAt ?? null}::timestamptz,
      ${row.cancellationReason ?? null}::text
    )
  `;
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700005011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700005012',
        ...registered,
      },
      { id: GUEST_ID, phoneNumber: '+2250700005013' },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
});

describe('orders defaults and types (AC-1, C-01, C-35)', () => {
  it('applies defaults and uses the expected column types', async () => {
    expect(await insertOrder()).toBe(1);

    const [row] = await prisma.$queryRaw<
      Array<{
        delivery_cost: bigint;
        status: string;
        created_at: Date;
        server_updated_at: Date;
        deleted_at: Date | null;
        delivered_at: Date | null;
        parent_order_id: string | null;
      }>
    >`
      SELECT delivery_cost, status::text AS status, created_at, server_updated_at, deleted_at,
             delivered_at, parent_order_id
      FROM orders WHERE id = ${ORDER_ID}::uuid
    `;
    expect(row.delivery_cost).toBe(0n);
    expect(row.status).toBe('CONFIRMED');
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.server_updated_at).toBeInstanceOf(Date);
    expect(row.deleted_at).toBeNull();
    expect(row.delivered_at).toBeNull();
    expect(row.parent_order_id).toBeNull();

    for (const column of [
      'id',
      'customer_relationship_id',
      'entered_by_id',
      'delivered_by_id',
      'cancelled_by_id',
      'parent_order_id',
    ]) {
      await expectColumnType('orders', column, 'uuid');
    }
    for (const column of ['total_amount', 'delivery_cost']) {
      await expectColumnType('orders', column, 'bigint');
    }
    for (const column of [
      'delivered_at',
      'created_at',
      'cancelled_at',
      'server_updated_at',
      'deleted_at',
    ]) {
      await expectColumnType('orders', column, 'timestamptz');
    }
    await expectColumnType('orders', 'desired_delivery_date', 'date');
  });

  it('moves server_updated_at forward on update', async () => {
    await insertOrder();
    const read = () =>
      prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
        SELECT server_updated_at FROM orders WHERE id = ${ORDER_ID}::uuid
      `;
    const [before] = await read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await prisma.$executeRaw`UPDATE orders SET total_amount = 5 WHERE id = ${ORDER_ID}::uuid`;
    const [after] = await read();
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
  });

  it('has indexes on relationship, status and delivery', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'orders'
    `;
    for (const columns of [
      '(customer_relationship_id)',
      '(status)',
      '(delivered_by_id, delivered_at)',
    ]) {
      expect(
        rows.some((r) => r.indexdef.includes(columns)),
        columns
      ).toBe(true);
    }
  });
});

describe('orders enums and keys (AC-2)', () => {
  it('rejects status "LATE" with 22P02', async () => {
    expect(await captureSqlCode(insertOrder({ status: 'LATE' }))).toBe('22P02');
  });

  it('accepts every documented status', async () => {
    const at = new Date('2026-01-02T00:00:00.000Z');
    const rows: Array<[string, Row]> = [
      ['PENDING', { placedByParty: 'CUSTOMER' }],
      ['CONFIRMED', {}],
      ['IN_DELIVERY', {}],
      ['DELIVERED', { deliveredAt: at, deliveredById: OWNER_ID }],
      ['CANCELLED', { cancelledByParty: 'CUSTOMER', cancelledById: CUSTOMER_ID, cancelledAt: at }],
    ];
    for (const [index, [status, extra]] of rows.entries()) {
      await expect(
        insertOrder({ id: `0199c005-0000-7000-8000-00000000010${index}`, status, ...extra })
      ).resolves.toBe(1);
    }
  });

  it('rejects placed_by_party "ADMIN" with 22P02', async () => {
    expect(await captureSqlCode(insertOrder({ placedByParty: 'ADMIN' }))).toBe('22P02');
  });

  it('rejects cancelled_by_party "PLATFORM" with 22P02', async () => {
    expect(await captureSqlCode(insertOrder({ cancelledByParty: 'PLATFORM' }))).toBe('22P02');
  });

  it('rejects an unknown relationship with 23503', async () => {
    expect(await captureSqlCode(insertOrder({ customerRelationshipId: UNKNOWN_ID }))).toBe('23503');
  });

  it('rejects entered_by_id of a guest with 23514', async () => {
    expect(await captureSqlCode(insertOrder({ enteredById: GUEST_ID }))).toBe('23514');
  });

  it('rejects delivered_by_id and cancelled_by_id of a guest with 23514', async () => {
    const at = new Date('2026-01-02T00:00:00.000Z');
    expect(
      await captureSqlCode(
        insertOrder({ status: 'DELIVERED', deliveredAt: at, deliveredById: GUEST_ID })
      )
    ).toBe('23514');
    expect(
      await captureSqlCode(
        insertOrder({
          status: 'CANCELLED',
          cancelledByParty: 'CUSTOMER',
          cancelledAt: at,
          cancelledById: GUEST_ID,
        })
      )
    ).toBe('23514');
  });

  it('accepts delivered_by_id and cancelled_by_id of a registered person', async () => {
    const at = new Date('2026-01-02T00:00:00.000Z');
    await expect(
      insertOrder({ status: 'DELIVERED', deliveredAt: at, deliveredById: OWNER_ID })
    ).resolves.toBe(1);
    await expect(
      insertOrder({
        id: OTHER_ORDER_ID,
        status: 'CANCELLED',
        cancelledByParty: 'CUSTOMER',
        cancelledAt: at,
        cancelledById: CUSTOMER_ID,
      })
    ).resolves.toBe(1);
  });

  it('rejects an unknown parent_order_id with 23503 and accepts an existing order', async () => {
    expect(await captureSqlCode(insertOrder({ parentOrderId: UNKNOWN_ID }))).toBe('23503');
    await insertOrder();
    await expect(insertOrder({ id: OTHER_ORDER_ID, parentOrderId: ORDER_ID })).resolves.toBe(1);
  });
});

describe('orders required columns (AC-3)', () => {
  it('rejects a null placed_by_party with 23502', async () => {
    expect(await captureSqlCode(insertOrder({ placedByParty: null }))).toBe('23502');
  });

  it('rejects a null entered_by_id with 23502', async () => {
    expect(await captureSqlCode(insertOrder({ enteredById: null }))).toBe('23502');
  });

  it('rejects a null total_amount with 23502', async () => {
    expect(await captureSqlCode(insertOrder({ totalAmount: null }))).toBe('23502');
  });

  it('rejects a null delivery_cost and a null status with 23502', async () => {
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, delivery_cost)
          VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'SUPPLIER', ${OWNER_ID}::uuid, 0, NULL)
        `
      )
    ).toBe('23502');
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, status)
          VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'SUPPLIER', ${OWNER_ID}::uuid, 0, NULL)
        `
      )
    ).toBe('23502');
  });
});
