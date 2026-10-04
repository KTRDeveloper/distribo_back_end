import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const ORG_ID = '0199c016-0000-7000-8000-000000000001';
const OWNER_ID = '0199c016-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c016-0000-7000-8000-000000000012';
const OTHER_CUSTOMER_ID = '0199c016-0000-7000-8000-000000000013';
const REL_ID = '0199c016-0000-7000-8000-000000000021';
const OTHER_REL_ID = '0199c016-0000-7000-8000-000000000022';
const ORDER_ID = '0199c016-0000-7000-8000-000000000041';
const OTHER_ORDER_ID = '0199c016-0000-7000-8000-000000000042';
const ID_1 = '0199c016-0000-7000-8000-000000000031';
const ID_2 = '0199c016-0000-7000-8000-000000000032';
const ID_3 = '0199c016-0000-7000-8000-000000000033';
const ID_4 = '0199c016-0000-7000-8000-000000000034';
const ORDER_TOTAL = 30000;

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

type EntryRow = {
  id?: string;
  relationshipId?: string;
  orderId?: string | null;
  kind?: string;
  amount?: number;
  mode?: string | null;
  reverses?: string | null;
};

type Client = Pick<typeof appPrisma, '$executeRaw'>;

/** Inserts a ledger entry as the application account; defaults describe a SALE of the order. */
function insertEntry(row: EntryRow = {}, client: Client = appPrisma): Promise<number> {
  const orderId = row.orderId === undefined ? ORDER_ID : row.orderId;
  return client.$executeRaw`
    INSERT INTO ledger_entries (
      id, customer_relationship_id, order_id, kind, amount, mode,
      reverses_entry_id, recorded_by_id, occurred_at
    ) VALUES (
      ${row.id ?? ID_1}::uuid, ${row.relationshipId ?? REL_ID}::uuid,
      ${orderId}::uuid, ${row.kind ?? 'SALE'}::text::public."LedgerEntryKind",
      ${row.amount ?? ORDER_TOTAL}::bigint, ${row.mode ?? null}::text::public."LedgerEntryMode",
      ${row.reverses ?? null}::uuid, ${OWNER_ID}::uuid, now()
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700016011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700016012',
        ...registered,
      },
      {
        id: OTHER_CUSTOMER_ID,
        fullName: 'Fixture Other Customer',
        phoneNumber: '+2250700016013',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Supplier')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_person_id, created_by_id
    ) VALUES
      (${REL_ID}::uuid, ${ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid),
      (${OTHER_REL_ID}::uuid, ${ORG_ID}::uuid, ${OTHER_CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO orders (
      id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, delivery_cost
    ) VALUES
      (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'SUPPLIER', ${OWNER_ID}::uuid, ${ORDER_TOTAL}, ${ORDER_TOTAL}),
      (${OTHER_ORDER_ID}::uuid, ${REL_ID}::uuid, 'SUPPLIER', ${OWNER_ID}::uuid, 5000, 5000)
  `;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

async function countRows(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM ledger_entries
  `;
  return Number(rows[0].n);
}

describe('ledger_entries sale rules (AC-1, C-24)', () => {
  it('accepts a SALE with order_id and amount equal to the order total', async () => {
    expect(await captureSqlCode(insertEntry())).toBeUndefined();
    expect(await countRows()).toBe(1);
  });

  it('rejects a SALE without order_id with 23514', async () => {
    expect(await captureSqlCode(insertEntry({ orderId: null }))).toBe('23514');
  });

  it('rejects a SALE whose amount differs from the order total with 23514', async () => {
    expect(await captureSqlCode(insertEntry({ amount: ORDER_TOTAL + 1 }))).toBe('23514');
  });

  it('rejects a second SALE for an order that has a live SALE with 23514', async () => {
    await insertEntry({ id: ID_1 });
    expect(await captureSqlCode(insertEntry({ id: ID_2 }))).toBe('23514');
    expect(await countRows()).toBe(1);
  });

  it('accepts a new SALE for an order whose first SALE was reversed', async () => {
    await insertEntry({ id: ID_1 });
    await insertEntry({ id: ID_2, reverses: ID_1, orderId: null });
    expect(await captureSqlCode(insertEntry({ id: ID_3 }))).toBeUndefined();
    expect(await countRows()).toBe(3);
  });

  it('keeps the live-SALE rule per order', async () => {
    await insertEntry({ id: ID_1 });
    expect(
      await captureSqlCode(insertEntry({ id: ID_2, orderId: OTHER_ORDER_ID, amount: 5000 }))
    ).toBeUndefined();
  });

  it('lets only one of two concurrent SALEs for the same order commit', async () => {
    const attempt = (id: string) =>
      appPrisma.$transaction(async (tx) => {
        await insertEntry({ id }, tx);
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
    const results = await Promise.allSettled([attempt(ID_1), attempt(ID_2)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await countRows()).toBe(1);
  });

  it('does not require an order for other kinds', async () => {
    expect(
      await captureSqlCode(insertEntry({ kind: 'PAYMENT', mode: 'CASH', orderId: null }))
    ).toBeUndefined();
  });
});

describe('ledger_entries reversal rules (AC-2, C-25)', () => {
  beforeEach(async () => {
    await insertEntry({ id: ID_1, kind: 'PAYMENT', mode: 'CASH', amount: 700, orderId: null });
  });

  const reversal = (row: EntryRow = {}): Promise<number> =>
    insertEntry({
      id: ID_2,
      kind: 'PAYMENT',
      mode: 'CASH',
      amount: 700,
      orderId: null,
      reverses: ID_1,
      ...row,
    });

  it('accepts a reversal of the same relationship, kind and amount', async () => {
    expect(await captureSqlCode(reversal())).toBeUndefined();
  });

  it('rejects the same target a second time with 23505', async () => {
    await reversal();
    expect(await captureSqlCode(reversal({ id: ID_3 }))).toBe('23505');
  });

  it('rejects a target of another relationship with 23514', async () => {
    expect(await captureSqlCode(reversal({ relationshipId: OTHER_REL_ID }))).toBe('23514');
  });

  it('rejects a target of another kind with 23514', async () => {
    expect(await captureSqlCode(reversal({ kind: 'CREDIT_NOTE', mode: null }))).toBe('23514');
  });

  it('rejects a target with another amount with 23514', async () => {
    expect(await captureSqlCode(reversal({ amount: 701 }))).toBe('23514');
  });

  it('rejects a reversal of a reversal with 23514', async () => {
    await reversal();
    expect(await captureSqlCode(reversal({ id: ID_3, reverses: ID_2 }))).toBe('23514');
  });

  it('rejects a reversal that points to itself with 23514', async () => {
    expect(await captureSqlCode(reversal({ id: ID_4, reverses: ID_4 }))).toBe('23514');
  });
});

describe('ledger_entries mismatched sale (AB-1, CWE-345)', () => {
  it('refuses a SALE of 3000 for an order of 30000', async () => {
    expect(await captureSqlCode(insertEntry({ amount: 3000 }))).toBe('23514');
    expect(await countRows()).toBe(0);
  });
});
