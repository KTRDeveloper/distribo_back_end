import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const ORG_ID = '0199e003-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199e003-0000-7000-8000-000000000002';
const PAYMENT_ID = '0199e003-0000-7000-8000-000000000011';
const OTHER_PAYMENT_ID = '0199e003-0000-7000-8000-000000000012';
const UNKNOWN_ID = '0199e003-0000-7000-8000-0000000000ff';

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
  id: string;
  number?: string | null;
  kind?: string;
  organizationId?: string;
  paymentId?: string;
  cancels?: string | null;
  customerName?: string | null;
  excl?: number;
  rate?: number;
  vat?: number;
  amount?: number;
  issuedAt?: string;
};

let sequence = 0;
/** A fresh UUID for each receipt row of a test. */
function receiptId(): string {
  sequence += 1;
  return `0199e003-0000-7000-8000-${String(100 + sequence).padStart(12, '0')}`;
}

/**
 * Inserts a receipt as the application account. Defaults describe the 5 000 F
 * receipt of the design (4 193 excl. tax, 807 VAT, rate 1925) with the number
 * the function returns.
 */
function insertReceipt(row: Row): Promise<number> {
  const number = 'number' in row ? row.number : undefined;
  const customerName = 'customerName' in row ? row.customerName : 'Fixture Business';
  const cancels = row.cancels ?? null;
  const issuedAt = row.issuedAt ?? null;
  return appPrisma.$executeRaw`
    INSERT INTO subscription_receipts (
      id, number, kind, organization_id, payment_id, cancels_receipt_id, customer_name,
      label, amount_excl_tax, vat_rate_bp, vat_amount, amount, issued_at
    ) VALUES (
      ${row.id}::uuid,
      ${number === undefined ? null : number}::text,
      ${row.kind ?? 'RECEIPT'}::text::public."ReceiptKind",
      ${row.organizationId ?? ORG_ID}::uuid, ${row.paymentId ?? PAYMENT_ID}::uuid,
      ${cancels}::uuid, ${customerName}, 'Essential, 3 months',
      ${row.excl ?? 4193}::bigint, ${row.rate ?? 1925}::int, ${row.vat ?? 807}::bigint,
      ${row.amount ?? 5000}::bigint, COALESCE(${issuedAt}::timestamptz, now())
    )
  `;
}

/** Inserts a receipt whose number comes from the function, in one statement. */
function insertNumbered(row: Row): Promise<number> {
  const cancels = row.cancels ?? null;
  const issuedAt = row.issuedAt ?? null;
  return appPrisma.$executeRaw`
    INSERT INTO subscription_receipts (
      id, number, kind, organization_id, payment_id, cancels_receipt_id, customer_name,
      label, amount_excl_tax, vat_rate_bp, vat_amount, amount, issued_at
    ) VALUES (
      ${row.id}::uuid,
      next_subscription_receipt_number(COALESCE(${issuedAt}::timestamptz, now())),
      ${row.kind ?? 'RECEIPT'}::text::public."ReceiptKind",
      ${row.organizationId ?? ORG_ID}::uuid, ${row.paymentId ?? PAYMENT_ID}::uuid,
      ${cancels}::uuid, 'Fixture Business', 'Essential, 3 months',
      ${row.excl ?? 4193}::bigint, 1925::int, ${row.vat ?? 807}::bigint,
      ${row.amount ?? 5000}::bigint, COALESCE(${issuedAt}::timestamptz, now())
    )
  `;
}

async function nextNumber(issued: string): Promise<string> {
  const [row] = await prisma.$queryRaw<Array<{ n: string }>>`
    SELECT next_subscription_receipt_number(${issued}::timestamptz) AS n
  `;
  return row.n;
}

async function count(): Promise<bigint> {
  const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count FROM subscription_receipts
  `;
  return row.count;
}

async function numbers(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ number: string }>>`
    SELECT number FROM subscription_receipts ORDER BY number
  `;
  return rows.map((r) => r.number);
}

beforeEach(async () => {
  sequence = 0;
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${ORG_ID}::uuid, 'Fixture Business'), (${OTHER_ORG_ID}::uuid, 'Other Business')
  `;
  for (const [id, org, ref] of [
    [PAYMENT_ID, ORG_ID, 'REF-1'],
    [OTHER_PAYMENT_ID, ORG_ID, 'REF-2'],
  ]) {
    await prisma.$executeRaw`
      INSERT INTO subscription_payments (
        id, organization_id, plan, months, amount, operator, payer_phone_number,
        provider_reference, status, terms_version, confirmed_at
      ) VALUES (
        ${id}::uuid, ${org}::uuid, 'ESSENTIAL', 3, 5000, 'MTN_MOMO', '+2250700017001',
        ${ref}, 'SUCCEEDED', '2026-10', now()
      )
    `;
  }
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('receipt', () => {
  it('stores a receipt with the number the function returned and sets issued_at', async () => {
    const id = receiptId();
    await insertNumbered({ id });
    const [row] = await prisma.$queryRaw<
      Array<{ number: string; kind: string; issued_at: Date | null; amount: bigint }>
    >`SELECT number, kind::text AS kind, issued_at, amount FROM subscription_receipts
      WHERE id = ${id}::uuid`;
    expect(row.number).toMatch(/^R-\d{4}-000001$/);
    expect(row.kind).toBe('RECEIPT');
    expect(row.issued_at).toBeInstanceOf(Date);
    expect(row.amount).toBe(5000n);
  });

  it('defaults issued_at to the server time when it is not given', async () => {
    const id = receiptId();
    await appPrisma.$executeRaw`
      INSERT INTO subscription_receipts (
        id, number, kind, organization_id, payment_id, customer_name, label,
        amount_excl_tax, vat_rate_bp, vat_amount, amount
      ) VALUES (
        ${id}::uuid, next_subscription_receipt_number(now()), 'RECEIPT'::public."ReceiptKind",
        ${ORG_ID}::uuid, ${PAYMENT_ID}::uuid, 'Fixture Business', 'Label', 4193, 1925, 807, 5000
      )
    `;
    const [row] = await prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT abs(extract(epoch FROM (now() - issued_at))) < 60 AS ok
      FROM subscription_receipts WHERE id = ${id}::uuid
    `;
    expect(row.ok).toBe(true);
  });

  it('refuses a missing customer_name with 23502', async () => {
    const result = await captureSqlCode(
      insertReceipt({ id: receiptId(), number: 'R-2026-000001', customerName: null })
    );
    expect(result).toBe('23502');
  });

  it('refuses a missing number with 23502', async () => {
    expect(await captureSqlCode(insertReceipt({ id: receiptId(), number: null }))).toBe('23502');
  });

  it('refuses an unknown kind with 22P02', async () => {
    expect(
      await captureSqlCode(
        insertReceipt({ id: receiptId(), number: 'R-2026-000001', kind: 'INVOICE' })
      )
    ).toBe('22P02');
  });

  it('refuses an unknown organization and an unknown payment with 23503', async () => {
    expect(
      await captureSqlCode(
        insertReceipt({ id: receiptId(), number: 'R-2026-000001', organizationId: UNKNOWN_ID })
      )
    ).toBe('23503');
    expect(
      await captureSqlCode(
        insertReceipt({ id: receiptId(), number: 'R-2026-000001', paymentId: UNKNOWN_ID })
      )
    ).toBe('23503');
    expect(await count()).toBe(0n);
  });

  it('refuses a credit note for a receipt that does not exist with 23514', async () => {
    const number = await nextNumber('2026-10-19T10:00:00Z');
    expect(
      await captureSqlCode(
        insertReceipt({ id: receiptId(), number, kind: 'CREDIT_NOTE', cancels: UNKNOWN_ID })
      )
    ).toBe('23514');
  });

  it('keeps the number unique', async () => {
    await insertNumbered({ id: receiptId() });
    const [{ n }] = await prisma.$queryRaw<Array<{ n: string }>>`
      SELECT number AS n FROM subscription_receipts
    `;
    // Re-using the stored number is refused: by the number rule first (23514)
    // and in any case never accepted.
    const result = await captureSqlCode(insertReceipt({ id: receiptId(), number: n }));
    expect(['23505', '23514']).toContain(result);
    expect(await count()).toBe(1n);
  });
});

describe('wrong rows', () => {
  it('refuses an amount different from excl. tax plus VAT with 23514', async () => {
    const number = await nextNumber('2026-10-19T10:00:00Z');
    expect(await captureSqlCode(insertReceipt({ id: receiptId(), number, amount: 5001 }))).toBe(
      '23514'
    );
    expect(await count()).toBe(0n);
  });

  it('refuses the number R-26-1 with 23514', async () => {
    expect(await captureSqlCode(insertReceipt({ id: receiptId(), number: 'R-26-1' }))).toBe(
      '23514'
    );
    expect(await count()).toBe(0n);
  });

  it('refuses a CREDIT_NOTE without cancels_receipt_id with 23514', async () => {
    const number = await nextNumber('2026-10-19T10:00:00Z');
    expect(
      await captureSqlCode(insertReceipt({ id: receiptId(), number, kind: 'CREDIT_NOTE' }))
    ).toBe('23514');
    expect(await count()).toBe(0n);
  });

  it('refuses a RECEIPT that cancels another receipt with 23514', async () => {
    const first = receiptId();
    await insertNumbered({ id: first });
    const number = await nextNumber('2026-10-19T10:00:00Z');
    expect(
      await captureSqlCode(insertReceipt({ id: receiptId(), number, cancels: first }))
    ).toBe('23514');
  });

  it('refuses a second credit note for one receipt with 23505', async () => {
    const first = receiptId();
    await insertNumbered({ id: first });
    await insertNumbered({ id: receiptId(), kind: 'CREDIT_NOTE', cancels: first });
    expect(
      await captureSqlCode(insertNumbered({ id: receiptId(), kind: 'CREDIT_NOTE', cancels: first }))
    ).toBe('23505');
    expect(await count()).toBe(2n);
  });

  it('refuses a credit note with another amount with 23514', async () => {
    const first = receiptId();
    await insertNumbered({ id: first });
    expect(
      await captureSqlCode(
        insertNumbered({
          id: receiptId(),
          kind: 'CREDIT_NOTE',
          cancels: first,
          excl: 4000,
          vat: 1000,
        })
      )
    ).toBe('23514');
    expect(await count()).toBe(1n);
  });

  it('refuses a credit note for another payment or another business with 23514', async () => {
    const first = receiptId();
    await insertNumbered({ id: first });
    expect(
      await captureSqlCode(
        insertNumbered({
          id: receiptId(),
          kind: 'CREDIT_NOTE',
          cancels: first,
          paymentId: OTHER_PAYMENT_ID,
        })
      )
    ).toBe('23514');
    expect(
      await captureSqlCode(
        insertNumbered({
          id: receiptId(),
          kind: 'CREDIT_NOTE',
          cancels: first,
          organizationId: OTHER_ORG_ID,
        })
      )
    ).toBe('23514');
    expect(await count()).toBe(1n);
  });

  it('refuses a credit note that cancels a credit note with 23514', async () => {
    const first = receiptId();
    const note = receiptId();
    await insertNumbered({ id: first });
    await insertNumbered({ id: note, kind: 'CREDIT_NOTE', cancels: first });
    expect(
      await captureSqlCode(insertNumbered({ id: receiptId(), kind: 'CREDIT_NOTE', cancels: note }))
    ).toBe('23514');
  });

  it('accepts a credit note with the same amounts', async () => {
    const first = receiptId();
    await insertNumbered({ id: first });
    await insertNumbered({ id: receiptId(), kind: 'CREDIT_NOTE', cancels: first });
    expect(await count()).toBe(2n);
  });

  it.each([
    ['amount 0', { excl: 0, vat: 0, amount: 0 }],
    ['negative VAT', { excl: 5100, vat: -100, amount: 5000 }],
    ['negative excl. tax', { excl: -100, vat: 5100, amount: 5000 }],
  ])('refuses %s with 23514', async (_name, amounts) => {
    const number = await nextNumber('2026-10-19T10:00:00Z');
    expect(await captureSqlCode(insertReceipt({ id: receiptId(), number, ...amounts }))).toBe(
      '23514'
    );
    expect(await count()).toBe(0n);
  });

  it('accepts a receipt without VAT: rate 0, VAT 0', async () => {
    const number = await nextNumber('2026-10-19T10:00:00Z');
    await insertReceipt({ id: receiptId(), number, rate: 0, vat: 0, excl: 5000 });
    expect(await count()).toBe(1n);
  });
});

describe('numbers', () => {
  it('starts at 1 and follows the last number, in one series across years', async () => {
    expect(await nextNumber('2026-03-01T10:00:00Z')).toBe('R-2026-000001');
    for (let i = 0; i < 7; i += 1) {
      await insertNumbered({ id: receiptId(), issuedAt: '2026-03-01T10:00:00Z' });
    }
    expect((await numbers()).at(-1)).toBe('R-2026-000007');
    expect(await nextNumber('2026-03-01T10:00:00Z')).toBe('R-2026-000008');
    expect(await nextNumber('2027-01-05T10:00:00Z')).toBe('R-2027-000008');
  });

  it('refuses a number that skips ahead with 23514', async () => {
    for (let i = 0; i < 7; i += 1) {
      await insertNumbered({ id: receiptId(), issuedAt: '2026-03-01T10:00:00Z' });
    }
    expect(
      await captureSqlCode(
        insertReceipt({
          id: receiptId(),
          number: 'R-2026-000010',
          issuedAt: '2026-03-01T10:00:00Z',
        })
      )
    ).toBe('23514');
    expect(await count()).toBe(7n);
  });

  it('refuses a number whose year is not the issue year with 23514', async () => {
    expect(
      await captureSqlCode(
        insertReceipt({
          id: receiptId(),
          number: 'R-2025-000001',
          issuedAt: '2026-03-01T10:00:00Z',
        })
      )
    ).toBe('23514');
  });

  it('refuses a repeated number with 23514 or 23505', async () => {
    await insertNumbered({ id: receiptId(), issuedAt: '2026-03-01T10:00:00Z' });
    const result = await captureSqlCode(
      insertReceipt({
        id: receiptId(),
        number: 'R-2026-000001',
        issuedAt: '2026-03-01T10:00:00Z',
      })
    );
    expect(['23514', '23505']).toContain(result);
  });

  it('is executable by the application account', async () => {
    const [row] = await appPrisma.$queryRaw<Array<{ n: string }>>`
      SELECT next_subscription_receipt_number('2026-03-01T10:00:00Z'::timestamptz) AS n
    `;
    expect(row.n).toBe('R-2026-000001');
  });
});

describe('immutable', () => {
  beforeEach(async () => {
    await insertNumbered({ id: receiptId() });
  });

  it('lets the application account read receipts', async () => {
    const rows = await appPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM subscription_receipts
    `;
    expect(rows).toHaveLength(1);
  });

  it('refuses UPDATE with 42501', async () => {
    expect(
      await captureSqlCode(appPrisma.$executeRaw`UPDATE subscription_receipts SET label = 'x'`)
    ).toBe('42501');
  });

  it('refuses DELETE with 42501', async () => {
    expect(await captureSqlCode(appPrisma.$executeRaw`DELETE FROM subscription_receipts`)).toBe(
      '42501'
    );
  });

  it('refuses TRUNCATE with 42501', async () => {
    expect(
      await captureSqlCode(appPrisma.$executeRawUnsafe('TRUNCATE TABLE subscription_receipts'))
    ).toBe('42501');
    expect(await count()).toBe(1n);
  });
});

describe('rewrite', () => {
  it('refuses to set the amount of a stored receipt with 42501 and leaves the row unchanged', async () => {
    await insertNumbered({ id: receiptId() });
    const result = await captureSqlCode(
      appPrisma.$executeRaw`UPDATE subscription_receipts SET amount = 9999999`
    );
    expect(result).toBe('42501');
    const [row] = await prisma.$queryRaw<Array<{ amount: bigint }>>`
      SELECT amount FROM subscription_receipts
    `;
    expect(row.amount).toBe(5000n);
  });
});

describe('parallel', () => {
  it('gives consecutive numbers, none skipped and none repeated, to concurrent transactions', async () => {
    const total = 8;
    await Promise.all(
      Array.from({ length: total }, () => {
        const id = receiptId();
        return appPrisma.$transaction(async (tx) => {
          const [{ n }] = await tx.$queryRaw<Array<{ n: string }>>`
            SELECT next_subscription_receipt_number('2026-03-01T10:00:00Z'::timestamptz) AS n
          `;
          // Hold the lock a little so the others really queue behind it.
          await tx.$executeRaw`SELECT pg_sleep(0.05)`;
          await tx.$executeRaw`
            INSERT INTO subscription_receipts (
              id, number, kind, organization_id, payment_id, customer_name, label,
              amount_excl_tax, vat_rate_bp, vat_amount, amount, issued_at
            ) VALUES (
              ${id}::uuid, ${n}, 'RECEIPT'::public."ReceiptKind", ${ORG_ID}::uuid,
              ${PAYMENT_ID}::uuid, 'Fixture Business', 'Label', 4193, 1925, 807, 5000,
              '2026-03-01T10:00:00Z'::timestamptz
            )
          `;
        });
      })
    );
    expect(await numbers()).toEqual(
      Array.from({ length: total }, (_v, i) => `R-2026-${String(i + 1).padStart(6, '0')}`)
    );
  });
});
