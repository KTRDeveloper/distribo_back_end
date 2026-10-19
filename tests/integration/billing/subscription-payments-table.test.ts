import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const ORG_ID = '0199e001-0000-7000-8000-000000000001';
const PAYMENT_ID = '0199e001-0000-7000-8000-000000000011';
const SECOND_ID = '0199e001-0000-7000-8000-000000000012';
const UNKNOWN_ORG_ID = '0199e001-0000-7000-8000-0000000000ff';
const CONFIRMED_AT = '2026-10-01T10:00:00.000Z';

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
  organizationId?: string;
  plan?: string;
  months?: number;
  amount?: number;
  operator?: string;
  payer?: string | null;
  reference?: string;
  status?: string;
  confirmedAt?: string | null;
  termsVersion?: string | null;
};

/** Inserts a payment as the application account; defaults describe a pending MTN payment. */
function insertPayment(row: Row = {}): Promise<number> {
  const payer = 'payer' in row ? row.payer : '+2250700017001';
  const confirmedAt = 'confirmedAt' in row ? row.confirmedAt : null;
  const termsVersion = 'termsVersion' in row ? row.termsVersion : '2026-10';
  return appPrisma.$executeRaw`
    INSERT INTO subscription_payments (
      id, organization_id, plan, months, amount, operator, payer_phone_number,
      provider_reference, status, terms_version, confirmed_at
    ) VALUES (
      ${row.id ?? PAYMENT_ID}::uuid, ${row.organizationId ?? ORG_ID}::uuid,
      ${row.plan ?? 'ESSENTIAL'}::text::public."PaidPlan", ${row.months ?? 3}::int,
      ${row.amount ?? 15000}::bigint, ${row.operator ?? 'MTN_MOMO'}::text::public."PaymentOperator",
      ${payer}, ${row.reference ?? 'REF-1'},
      ${row.status ?? 'PENDING'}::text::public."PaymentStatus", ${termsVersion},
      ${confirmedAt}::timestamptz
    )
  `;
}

/** Seeds a payment in the given status, with a confirmation date when the status needs one. */
function seed(status: string): Promise<number> {
  const confirmed = status === 'SUCCEEDED' || status === 'REFUNDED';
  return insertPayment({ status, confirmedAt: confirmed ? CONFIRMED_AT : null });
}

async function readStatus(): Promise<string> {
  const [row] = await prisma.$queryRaw<Array<{ status: string }>>`
    SELECT status::text AS status FROM subscription_payments WHERE id = ${PAYMENT_ID}::uuid
  `;
  return row.status;
}

beforeEach(async () => {
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
  `;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('pending', () => {
  it('stores a new payment as PENDING with a creation date and no confirmation', async () => {
    await insertPayment();
    const [row] = await prisma.$queryRaw<
      Array<{ status: string; confirmed_at: Date | null; created_at: Date | null; amount: bigint }>
    >`SELECT status::text AS status, confirmed_at, created_at, amount
      FROM subscription_payments WHERE id = ${PAYMENT_ID}::uuid`;
    expect(row.status).toBe('PENDING');
    expect(row.confirmed_at).toBeNull();
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.amount).toBe(15000n);
  });
});

describe('wrong rows', () => {
  it.each([
    ['months 2', () => insertPayment({ months: 2 }), '23514'],
    ['amount 0', () => insertPayment({ amount: 0 }), '23514'],
    ['operator OTHER with a payer number', () => insertPayment({ operator: 'OTHER' }), '23514'],
    ['operator MTN_MOMO without a payer number', () => insertPayment({ payer: null }), '23514'],
    [
      'SUCCEEDED and no confirmed_at',
      () => insertPayment({ status: 'SUCCEEDED', confirmedAt: null }),
      '23514',
    ],
    [
      'PENDING and a confirmed_at',
      () => insertPayment({ status: 'PENDING', confirmedAt: CONFIRMED_AT }),
      '23514',
    ],
    ['plan FREE', () => insertPayment({ plan: 'FREE' }), '22P02'],
    ['operator unknown', () => insertPayment({ operator: 'CASH' }), '22P02'],
    ['status unknown', () => insertPayment({ status: 'DONE' }), '22P02'],
    ['no terms_version', () => insertPayment({ termsVersion: null }), '23502'],
    [
      'an organization that does not exist',
      () => insertPayment({ organizationId: UNKNOWN_ORG_ID }),
      '23503',
    ],
  ])('refuses %s with %s', async (_problem, run, code) => {
    expect(await captureSqlCode(run())).toBe(code);
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM subscription_payments
    `;
    expect(count).toBe(0n);
  });

  it('accepts an administrator-recorded payment: operator OTHER, no payer number, confirmed', async () => {
    await insertPayment({
      operator: 'OTHER',
      payer: null,
      status: 'SUCCEEDED',
      confirmedAt: CONFIRMED_AT,
    });
    expect(await readStatus()).toBe('SUCCEEDED');
  });

  it.each([1, 3, 6, 12])('accepts months %i', async (months) => {
    await insertPayment({ months });
    expect(await readStatus()).toBe('PENDING');
  });
});

describe('moves', () => {
  it.each([
    ['PENDING', 'SUCCEEDED', null],
    ['PENDING', 'FAILED', null],
    ['PENDING', 'EXPIRED', null],
    ['SUCCEEDED', 'REFUNDED', null],
    ['SUCCEEDED', 'PENDING', '23514'],
    ['SUCCEEDED', 'FAILED', '23514'],
    ['FAILED', 'SUCCEEDED', '23514'],
    ['EXPIRED', 'SUCCEEDED', '23514'],
    ['REFUNDED', 'SUCCEEDED', '23514'],
    ['REFUNDED', 'PENDING', '23514'],
  ])('%s to %s gives %s', async (from, to, code) => {
    await seed(from);
    const confirmed = to === 'SUCCEEDED' || to === 'REFUNDED';
    const confirmedAt = confirmed ? new Date(CONFIRMED_AT) : null;
    const result = await captureSqlCode(
      appPrisma.$executeRaw`
        UPDATE subscription_payments
        SET status = ${to}::text::public."PaymentStatus",
            confirmed_at = COALESCE(confirmed_at, ${confirmedAt}::timestamptz)
        WHERE id = ${PAYMENT_ID}::uuid
      `
    );
    expect(result).toBe(code ?? undefined);
    expect(await readStatus()).toBe(code === null ? to : from);
  });

  it('lets the provider payload be written while the status stays', async () => {
    await seed('PENDING');
    await appPrisma.$executeRaw`
      UPDATE subscription_payments SET provider_payload = '{"ok":true}'::jsonb
      WHERE id = ${PAYMENT_ID}::uuid
    `;
    const [row] = await prisma.$queryRaw<Array<{ provider_payload: unknown }>>`
      SELECT provider_payload FROM subscription_payments WHERE id = ${PAYMENT_ID}::uuid
    `;
    expect(row.provider_payload).toEqual({ ok: true });
  });
});

describe('frozen', () => {
  it.each([
    ['amount', 'amount = 1000'],
    ['plan', `plan = 'PRO'::public."PaidPlan"`],
    ['months', 'months = 6'],
    ['provider_reference', `provider_reference = 'REF-OTHER'`],
    ['payer_phone_number', `payer_phone_number = '+2250700017002'`],
    ['operator', `operator = 'ORANGE_MONEY'::public."PaymentOperator"`],
    ['organization_id', `organization_id = '${UNKNOWN_ORG_ID}'::uuid`],
    ['terms_version', `terms_version = '2027-01'`],
    ['created_at', `created_at = now() + interval '1 day'`],
    ['id', `id = '${SECOND_ID}'::uuid`],
  ])('refuses a change of %s with 23514', async (_column, assignment) => {
    await seed('PENDING');
    // The assignment is a fixed literal from this table, never user input.
    const code = await captureSqlCode(
      appPrisma.$executeRawUnsafe(
        `UPDATE subscription_payments SET ${assignment} WHERE id = '${PAYMENT_ID}'::uuid`
      )
    );
    expect(code).toBe('23514');
  });

  it('refuses a change of amount even in the same statement as a legal status move', async () => {
    await seed('PENDING');
    const code = await captureSqlCode(
      appPrisma.$executeRaw`
        UPDATE subscription_payments
        SET status = 'FAILED'::public."PaymentStatus", amount = 1
        WHERE id = ${PAYMENT_ID}::uuid
      `
    );
    expect(code).toBe('23514');
    expect(await readStatus()).toBe('PENDING');
  });
});

describe('no delete', () => {
  it('refuses DELETE and TRUNCATE for the application role with 42501', async () => {
    await seed('PENDING');
    expect(await captureSqlCode(appPrisma.$executeRaw`DELETE FROM subscription_payments`)).toBe(
      '42501'
    );
    expect(await captureSqlCode(appPrisma.$executeRaw`TRUNCATE TABLE subscription_payments`)).toBe(
      '42501'
    );
    expect(await readStatus()).toBe('PENDING');
  });
});

describe('replay', () => {
  it('refuses to set a SUCCEEDED payment back to PENDING and leaves the row unchanged', async () => {
    await seed('SUCCEEDED');
    const code = await captureSqlCode(
      appPrisma.$executeRaw`
        UPDATE subscription_payments
        SET status = 'PENDING'::public."PaymentStatus", confirmed_at = NULL
        WHERE id = ${PAYMENT_ID}::uuid
      `
    );
    expect(code).toBe('23514');
    const [row] = await prisma.$queryRaw<Array<{ status: string; confirmed_at: Date | null }>>`
      SELECT status::text AS status, confirmed_at FROM subscription_payments
      WHERE id = ${PAYMENT_ID}::uuid
    `;
    expect(row.status).toBe('SUCCEEDED');
    expect(row.confirmed_at?.toISOString()).toBe(CONFIRMED_AT);
  });
});

describe('duplicate', () => {
  it('refuses a second payment with the same provider_reference with 23505', async () => {
    await insertPayment({ reference: 'REF-DUP' });
    const code = await captureSqlCode(insertPayment({ id: SECOND_ID, reference: 'REF-DUP' }));
    expect(code).toBe('23505');
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM subscription_payments
    `;
    expect(count).toBe(1n);
  });
});
