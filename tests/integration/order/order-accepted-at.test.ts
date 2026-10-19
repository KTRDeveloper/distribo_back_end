import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const SUPPLIER_ORG_ID = '0199c022-0000-7000-8000-000000000001';
const OWNER_ID = '0199c022-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c022-0000-7000-8000-000000000012';
const REL_ID = '0199c022-0000-7000-8000-000000000021';
const ORDER_ID = '0199c022-0000-7000-8000-000000000031';
const ACCEPTED = new Date('2026-01-02T00:00:00.000Z');
const CANCELLED = new Date('2026-01-03T00:00:00.000Z');

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
  party: 'CUSTOMER' | 'SUPPLIER';
  status: 'PENDING' | 'CONFIRMED';
  acceptedAt: Date | null;
};

function insertOrder(row: Row): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO orders (
      id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, status, accepted_at
    )
    VALUES (
      ${ORDER_ID}::uuid, ${REL_ID}::uuid, ${row.party}::text::public."OrderParty", ${OWNER_ID}::uuid, 0,
      ${row.status}::text::public."OrderStatus", ${row.acceptedAt}::timestamptz
    )
  `;
}

async function acceptedAtOf(): Promise<Date | null | undefined> {
  const rows = await prisma.$queryRaw<Array<{ accepted_at: Date | null }>>`
    SELECT accepted_at FROM orders WHERE id = ${ORDER_ID}::uuid
  `;
  return rows[0] ? rows[0].accepted_at : undefined;
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700022011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700022012',
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
});

describe('column (AC-1)', () => {
  it('is empty when the insert omits it, and is timestamptz with no default', async () => {
    await prisma.$executeRaw`
      INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
      VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'CUSTOMER', ${OWNER_ID}::uuid, 0)
    `;
    expect(await acceptedAtOf()).toBeNull();
    const columns = await prisma.$queryRaw<
      Array<{ data_type: string; column_default: string | null; is_nullable: string }>
    >`
      SELECT data_type, column_default, is_nullable FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'accepted_at'
    `;
    expect(columns).toEqual([
      { data_type: 'timestamp with time zone', column_default: null, is_nullable: 'YES' },
    ]);
  });
});

describe('checks (AC-2, C-51)', () => {
  const examples: Array<[Row['party'], Row['status'], 'set' | 'empty', string | undefined]> = [
    ['CUSTOMER', 'CONFIRMED', 'set', undefined],
    ['CUSTOMER', 'PENDING', 'empty', undefined],
    ['CUSTOMER', 'PENDING', 'set', '23514'],
    ['SUPPLIER', 'CONFIRMED', 'set', '23514'],
    ['SUPPLIER', 'CONFIRMED', 'empty', undefined],
  ];

  it.each(examples)('%s %s with the date %s -> %s', async (party, status, date, expected) => {
    const code = await captureSqlCode(
      insertOrder({ party, status, acceptedAt: date === 'set' ? ACCEPTED : null })
    );
    expect(code).toBe(expected);
    expect(await acceptedAtOf()).toEqual(expected ? undefined : date === 'set' ? ACCEPTED : null);
  });
});

describe('acceptance step (AC-3)', () => {
  it('keeps the date when the supplier cancels after accepting', async () => {
    await insertOrder({ party: 'CUSTOMER', status: 'PENDING', acceptedAt: null });
    await prisma.$executeRaw`
      UPDATE orders SET status = 'CONFIRMED', accepted_at = ${ACCEPTED}::timestamptz
      WHERE id = ${ORDER_ID}::uuid
    `;
    expect(await acceptedAtOf()).toEqual(ACCEPTED);

    await prisma.$executeRaw`
      UPDATE orders SET
        status = 'CANCELLED', cancelled_by_party = 'SUPPLIER', cancelled_by_id = ${OWNER_ID}::uuid,
        cancelled_at = ${CANCELLED}::timestamptz, cancellation_reason = 'Out of stock'
      WHERE id = ${ORDER_ID}::uuid
    `;
    expect(await acceptedAtOf()).toEqual(ACCEPTED);
  });
});

describe('supplier order (AB-1, CWE-345)', () => {
  it('refuses a date set afterwards on an order the supplier entered', async () => {
    await insertOrder({ party: 'SUPPLIER', status: 'CONFIRMED', acceptedAt: null });
    const code = await captureSqlCode(
      prisma.$executeRaw`
        UPDATE orders SET accepted_at = ${ACCEPTED}::timestamptz WHERE id = ${ORDER_ID}::uuid
      `
    );
    expect(code).toBe('23514');
    expect(await acceptedAtOf()).toBeNull();
  });
});
