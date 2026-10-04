import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const ORG_ID = '0199c015-0000-7000-8000-000000000001';
const OWNER_ID = '0199c015-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c015-0000-7000-8000-000000000012';
const GUEST_ID = '0199c015-0000-7000-8000-000000000013';
const REL_ID = '0199c015-0000-7000-8000-000000000021';
const UNKNOWN_REL_ID = '0199c015-0000-7000-8000-0000000009ff';
const ORDER_ID = '0199c015-0000-7000-8000-000000000041';
const UNKNOWN_ORDER_ID = '0199c015-0000-7000-8000-0000000009fe';
const FIRST_ID = '0199c015-0000-7000-8000-000000000031';
const SECOND_ID = '0199c015-0000-7000-8000-000000000032';
const UNKNOWN_ENTRY_ID = '0199c015-0000-7000-8000-0000000009fd';

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
  by?: string;
};

/** Inserts a ledger entry as the application account; defaults describe a SALE by the owner. */
function insertEntry(row: EntryRow = {}): Promise<number> {
  const kind = row.kind ?? 'SALE';
  // A SALE that reverses nothing must carry its order (C-24); other kinds keep order_id null.
  const orderId = row.orderId ?? (kind === 'SALE' && !row.reverses ? ORDER_ID : null);
  return appPrisma.$executeRaw`
    INSERT INTO ledger_entries (
      id, customer_relationship_id, order_id, kind, amount, mode,
      reverses_entry_id, recorded_by_id, occurred_at
    ) VALUES (
      ${row.id ?? FIRST_ID}::uuid, ${row.relationshipId ?? REL_ID}::uuid,
      ${orderId}::uuid, ${kind}::text::public."LedgerEntryKind",
      ${row.amount ?? 10000}::bigint, ${row.mode ?? null}::text::public."LedgerEntryMode",
      ${row.reverses ?? null}::uuid, ${row.by ?? OWNER_ID}::uuid, now()
    )
  `;
}

async function balanceEffect(id: string): Promise<bigint> {
  const rows = await prisma.$queryRaw<Array<{ balance_effect: bigint }>>`
    SELECT balance_effect FROM ledger_entries WHERE id = ${id}::uuid
  `;
  return rows[0].balance_effect;
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700015011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700015012',
        ...registered,
      },
      { id: GUEST_ID, phoneNumber: '+2250700015013' },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Supplier')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_person_id, created_by_id
    ) VALUES (${REL_ID}::uuid, ${ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO orders (
      id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, delivery_cost
    )
    VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'SUPPLIER', ${OWNER_ID}::uuid, 10000, 10000)
  `;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('ledger_entries balance effect (AC-1, C-23)', () => {
  it.each([
    ['SALE', null, 10000n],
    ['REFUND', 'CASH', 10000n],
    ['PAYMENT', 'CASH', -10000n],
    ['CREDIT_NOTE', null, -10000n],
    ['OPENING_BALANCE', null, 10000n],
  ])('gives %s an original effect of %s', async (kind, mode, effect) => {
    await insertEntry({ kind, mode });
    expect(await balanceEffect(FIRST_ID)).toBe(effect);
  });

  it.each([
    ['PAYMENT', 'CASH', 10000n],
    ['SALE', null, -10000n],
    ['CREDIT_NOTE', null, 10000n],
    ['REFUND', 'MOBILE_MONEY', -10000n],
  ])('flips the sign of a reversing %s', async (kind, mode, effect) => {
    await insertEntry({ id: FIRST_ID, kind, mode });
    await insertEntry({ id: SECOND_ID, kind, mode, reverses: FIRST_ID });
    expect(await balanceEffect(SECOND_ID)).toBe(effect);
  });
});

describe('ledger_entries amount and mode (AC-2, C-23)', () => {
  it.each([
    ['amount 0', { amount: 0 }, '23514'],
    ['amount -5', { amount: -5 }, '23514'],
    ['PAYMENT with mode CASH', { kind: 'PAYMENT', mode: 'CASH' }, undefined],
    ['PAYMENT with mode MOBILE_MONEY', { kind: 'PAYMENT', mode: 'MOBILE_MONEY' }, undefined],
    ['PAYMENT without mode', { kind: 'PAYMENT' }, '23514'],
    ['REFUND without mode', { kind: 'REFUND' }, '23514'],
    ['SALE with mode CASH', { kind: 'SALE', mode: 'CASH' }, '23514'],
    ['OPENING_BALANCE with mode CASH', { kind: 'OPENING_BALANCE', mode: 'CASH' }, '23514'],
    ['CREDIT_NOTE without mode', { kind: 'CREDIT_NOTE' }, undefined],
    ['CREDIT_NOTE with mode CASH', { kind: 'CREDIT_NOTE', mode: 'CASH' }, '23514'],
  ] as Array<[string, EntryRow, string | undefined]>)(
    'for %s the insert %#',
    async (_label, row, expected) => {
      expect(await captureSqlCode(insertEntry(row))).toBe(expected);
    }
  );

  it('rejects an unknown kind or mode with 22P02', async () => {
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO ledger_entries (
          id, customer_relationship_id, kind, amount, recorded_by_id, occurred_at
        ) VALUES (${FIRST_ID}::uuid, ${REL_ID}::uuid, 'GIFT'::text::public."LedgerEntryKind",
                  10, ${OWNER_ID}::uuid, now())
      `)
    ).toBe('22P02');
    expect(await captureSqlCode(insertEntry({ kind: 'PAYMENT', mode: 'CHEQUE' }))).toBe('22P02');
  });
});

describe('ledger_entries generated column (AC-3)', () => {
  it('rejects an explicit balance_effect with 428C9', async () => {
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO ledger_entries (
          id, customer_relationship_id, kind, amount, balance_effect, recorded_by_id, occurred_at
        ) VALUES (${FIRST_ID}::uuid, ${REL_ID}::uuid, 'SALE'::public."LedgerEntryKind",
                  10000, 5, ${OWNER_ID}::uuid, now())
      `)
    ).toBe('428C9');
  });
});

describe('ledger_entries immutability (AC-4, AB-1, C-39)', () => {
  it('denies UPDATE, DELETE and TRUNCATE with 42501 and keeps the row unchanged', async () => {
    await insertEntry({ kind: 'PAYMENT', mode: 'CASH', amount: 30000 });

    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        UPDATE ledger_entries SET amount = 3000 WHERE id = ${FIRST_ID}::uuid
      `)
    ).toBe('42501');
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        DELETE FROM ledger_entries WHERE id = ${FIRST_ID}::uuid
      `)
    ).toBe('42501');
    expect(await captureSqlCode(appPrisma.$executeRaw`TRUNCATE TABLE ledger_entries`)).toBe(
      '42501'
    );

    const rows = await prisma.$queryRaw<Array<{ amount: bigint; balance_effect: bigint }>>`
      SELECT amount, balance_effect FROM ledger_entries WHERE id = ${FIRST_ID}::uuid
    `;
    expect(rows).toEqual([{ amount: 30000n, balance_effect: -30000n }]);
  });

  it('lets the application account insert and read', async () => {
    await expect(insertEntry()).resolves.toBe(1);
    const rows = await appPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ledger_entries WHERE id = ${FIRST_ID}::uuid
    `;
    expect(rows).toEqual([{ id: FIRST_ID }]);
  });
});

describe('ledger_entries keys, author and columns (AC-5, C-04)', () => {
  it('stores order, reversal, reference, note and server time', async () => {
    await insertEntry({
      id: FIRST_ID,
      kind: 'PAYMENT',
      mode: 'MOBILE_MONEY',
      amount: 500,
      orderId: ORDER_ID,
    });
    await appPrisma.$executeRaw`
      INSERT INTO ledger_entries (
        id, customer_relationship_id, kind, amount, mode, transaction_reference,
        reverses_entry_id, recorded_by_id, note, occurred_at
      ) VALUES (
        ${SECOND_ID}::uuid, ${REL_ID}::uuid, 'PAYMENT'::public."LedgerEntryKind", 500,
        'MOBILE_MONEY'::public."LedgerEntryMode", 'REF-1', ${FIRST_ID}::uuid,
        ${OWNER_ID}::uuid, 'fixture note', now()
      )
    `;
    const rows = await prisma.$queryRaw<
      Array<{
        order_id: string | null;
        reverses_entry_id: string | null;
        transaction_reference: string | null;
        note: string | null;
        server_updated_at: Date;
        amount_type: string;
      }>
    >`
      SELECT order_id, reverses_entry_id, transaction_reference, note, server_updated_at,
             pg_typeof(amount)::text AS amount_type
      FROM ledger_entries WHERE id = ${SECOND_ID}::uuid
    `;
    expect(rows[0]).toMatchObject({
      order_id: null,
      reverses_entry_id: FIRST_ID,
      transaction_reference: 'REF-1',
      note: 'fixture note',
      amount_type: 'bigint',
    });
    expect(Math.abs(Date.now() - rows[0].server_updated_at.getTime())).toBeLessThan(5_000);
  });

  it('has no deleted_at column', async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ledger_entries' AND column_name = 'deleted_at'
    `;
    expect(rows).toEqual([]);
  });

  it('rejects an unknown relationship, order or reversed entry with 23503', async () => {
    expect(await captureSqlCode(insertEntry({ relationshipId: UNKNOWN_REL_ID }))).toBe('23503');
    expect(await captureSqlCode(insertEntry({ orderId: UNKNOWN_ORDER_ID }))).toBe('23503');
    expect(await captureSqlCode(insertEntry({ reverses: UNKNOWN_ENTRY_ID }))).toBe('23503');
  });

  it('rejects a guest as recorded_by_id with 23514', async () => {
    expect(await captureSqlCode(insertEntry({ by: GUEST_ID }))).toBe('23514');
  });

  it('rejects a missing required column with 23502', async () => {
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO ledger_entries (id, customer_relationship_id, kind, amount, occurred_at)
        VALUES (${FIRST_ID}::uuid, ${REL_ID}::uuid, 'OPENING_BALANCE'::public."LedgerEntryKind", 10, now())
      `)
    ).toBe('23502');
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        INSERT INTO ledger_entries (id, customer_relationship_id, kind, amount, recorded_by_id)
        VALUES (${FIRST_ID}::uuid, ${REL_ID}::uuid, 'OPENING_BALANCE'::public."LedgerEntryKind", 10,
                ${OWNER_ID}::uuid)
      `)
    ).toBe('23502');
  });
});
