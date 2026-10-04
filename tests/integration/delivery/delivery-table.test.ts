import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { expectColumnType } from '../../helpers/db-schema';

const SUPPLIER_ORG_ID = '0199d001-0000-7000-8000-000000000001';
const OWNER_ID = '0199d001-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199d001-0000-7000-8000-000000000012';
const GUEST_ID = '0199d001-0000-7000-8000-000000000013';
const REL_ID = '0199d001-0000-7000-8000-000000000021';
const ORDER_ID = '0199d001-0000-7000-8000-000000000031';
const DELIVERY_ID = '0199d001-0000-7000-8000-000000000041';
const UNKNOWN_ID = '0199d001-0000-7000-8000-0000000009ff';

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

type Row = { id?: string; orderId?: string | null; assignedToId?: string | null };

/** Inserts a delivery; only the order and the driver are required. */
function insertDelivery(row: Row = {}): Promise<number> {
  const orderId = 'orderId' in row ? row.orderId : ORDER_ID;
  const assignedToId = 'assignedToId' in row ? row.assignedToId : OWNER_ID;
  return prisma.$executeRaw`
    INSERT INTO deliveries (id, order_id, assigned_to_id)
    VALUES (${row.id ?? DELIVERY_ID}::uuid, ${orderId}::uuid, ${assignedToId}::uuid)
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
      { id: OWNER_ID, fullName: 'Fixture Driver', phoneNumber: '+2250700006011', ...registered },
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
    INSERT INTO collaborations (id, person_id, organization_id, role, status) VALUES
      ('0199d001-0000-7000-8000-000000000051'::uuid, ${OWNER_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'OWNER', 'ACTIVE'),
      ('0199d001-0000-7000-8000-000000000052'::uuid, ${CUSTOMER_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'DRIVER', 'ACTIVE')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
    VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'SUPPLIER', ${OWNER_ID}::uuid, 0)
  `;
});

describe('deliveries row (AC-1, C-01, C-35)', () => {
  it('stores a delivery with empty attempt columns and a server time', async () => {
    expect(await insertDelivery()).toBe(1);

    const [row] = await prisma.$queryRaw<
      Array<{
        departed_at: Date | null;
        arrived_at: Date | null;
        failed_at: Date | null;
        failure_reason: string | null;
        sync_issue: string | null;
        server_updated_at: Date;
        deleted_at: Date | null;
      }>
    >`SELECT * FROM deliveries WHERE id = ${DELIVERY_ID}::uuid`;
    expect(row.departed_at).toBeNull();
    expect(row.arrived_at).toBeNull();
    expect(row.failed_at).toBeNull();
    expect(row.failure_reason).toBeNull();
    expect(row.sync_issue).toBeNull();
    expect(row.server_updated_at).toBeInstanceOf(Date);
    expect(row.deleted_at).toBeNull();

    for (const column of ['id', 'order_id', 'assigned_to_id']) {
      await expectColumnType('deliveries', column, 'uuid');
    }
    for (const column of [
      'departed_at',
      'arrived_at',
      'failed_at',
      'server_updated_at',
      'deleted_at',
    ]) {
      await expectColumnType('deliveries', column, 'timestamptz');
    }
  });

  it('moves server_updated_at forward on update', async () => {
    await insertDelivery();
    const read = () =>
      prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
        SELECT server_updated_at FROM deliveries WHERE id = ${DELIVERY_ID}::uuid
      `;
    const [before] = await read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await prisma.$executeRaw`
      UPDATE deliveries SET departed_at = now() WHERE id = ${DELIVERY_ID}::uuid
    `;
    const [after] = await read();
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
  });

  it('has indexes on order and on driver with departure', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'deliveries'
    `;
    for (const columns of ['(order_id)', '(assigned_to_id, departed_at)']) {
      expect(
        rows.some((r) => r.indexdef.includes(columns)),
        columns
      ).toBe(true);
    }
  });

  it('allows several attempts for the same order', async () => {
    await insertDelivery();
    await prisma.$executeRaw`
      UPDATE deliveries SET failed_at = now(), failure_reason = 'client absent'
      WHERE id = ${DELIVERY_ID}::uuid
    `;
    await expect(insertDelivery({ id: '0199d001-0000-7000-8000-000000000042' })).resolves.toBe(1);
  });
});

describe('deliveries keys and author (AC-2)', () => {
  it('rejects an unknown order with 23503', async () => {
    expect(await captureSqlCode(insertDelivery({ orderId: UNKNOWN_ID }))).toBe('23503');
  });

  it('rejects assigned_to_id of a guest with 23514', async () => {
    expect(await captureSqlCode(insertDelivery({ assignedToId: GUEST_ID }))).toBe('23514');
  });

  it('rejects an unknown assigned_to_id with 23503', async () => {
    expect(await captureSqlCode(insertDelivery({ assignedToId: UNKNOWN_ID }))).toBe('23503');
  });

  it('rejects a null assigned_to_id with 23502', async () => {
    expect(await captureSqlCode(insertDelivery({ assignedToId: null }))).toBe('23502');
  });

  it('rejects a null order_id with 23502', async () => {
    expect(await captureSqlCode(insertDelivery({ orderId: null }))).toBe('23502');
  });

  it('accepts a registered driver', async () => {
    await expect(insertDelivery({ assignedToId: CUSTOMER_ID })).resolves.toBe(1);
  });
});
