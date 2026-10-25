import { readFile, readdir } from 'node:fs/promises';
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const ORG_ID = '0199e002-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199e002-0000-7000-8000-000000000002';
const PAYMENT_ID = '0199e002-0000-7000-8000-0000000000a1';
const SUB_1 = '0199e002-0000-7000-8000-0000000000b1';
const SUB_2 = '0199e002-0000-7000-8000-0000000000b2';
const SUB_3 = '0199e002-0000-7000-8000-0000000000b3';
const MIGRATIONS = new URL('../../../prisma/migrations/', import.meta.url);

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

type Period = {
  id?: string;
  organizationId?: string;
  plan?: string;
  months?: number | null;
  price?: number;
  origin?: string;
  status?: string;
  paymentId?: string | null;
  startsAt?: string;
  endsAt?: string;
  endReason?: string | null;
};

/** Inserts a period as the application account; defaults describe a running PAYMENT period. */
function insertPeriod(period: Period = {}): Promise<number> {
  const origin = period.origin ?? 'PAYMENT';
  const bought = origin === 'PAYMENT';
  const months = 'months' in period ? period.months : bought ? 3 : null;
  const paymentId = 'paymentId' in period ? period.paymentId : bought ? PAYMENT_ID : null;
  const endReason = 'endReason' in period ? period.endReason : null;
  return appPrisma.$executeRaw`
    INSERT INTO subscriptions (
      id, organization_id, plan, months, price, origin, status, payment_id,
      starts_at, ends_at, end_reason
    ) VALUES (
      ${period.id ?? SUB_1}::uuid, ${period.organizationId ?? ORG_ID}::uuid,
      ${period.plan ?? 'PRO'}::text::public."PaidPlan", ${months}::int,
      ${period.price ?? (bought ? 30000 : 0)}::bigint,
      ${origin}::text::public."SubscriptionOrigin",
      ${period.status ?? 'ACTIVE'}::text::public."SubscriptionStatus", ${paymentId}::uuid,
      ${period.startsAt ?? '2026-10-01T00:00:00Z'}::timestamptz,
      ${period.endsAt ?? '2027-01-01T00:00:00Z'}::timestamptz,
      ${endReason}::text::public."SubscriptionEndReason"
    )
  `;
}

async function countPeriods(): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM subscriptions
  `;
  return Number(row.n);
}

/** Reads the preflight DO block from the deployed migration so the guard tested is the one shipped. */
async function preflightBlock(): Promise<string> {
  const directory = (await readdir(MIGRATIONS)).find((name) =>
    name.endsWith('_bil_002_subscription_periods')
  );
  if (!directory) throw new Error('BIL-002 migration is missing');
  const sql = await readFile(new URL(`${directory}/migration.sql`, MIGRATIONS), 'utf8');
  const block = sql.match(/^DO \$\$[\s\S]*?\n\$\$;/m)?.[0];
  if (!block) throw new Error('BIL-002 must start with a preflight DO block');
  return block;
}

/** Runs the preflight against a scratch `subscriptions(id uuid)` table that shadows the real one. */
async function runPreflight(ids: string[]): Promise<void> {
  const block = await preflightBlock();
  const rollback = new Error('Roll back scratch schema');
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`CREATE SCHEMA bil_002_preflight`;
      await tx.$executeRaw`SET LOCAL search_path = bil_002_preflight, public`;
      await tx.$executeRaw`CREATE TABLE subscriptions (id uuid)`;
      if (ids.length > 0) {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO subscriptions (id) VALUES ${Prisma.join(
            ids.map((id) => Prisma.sql`(${id}::uuid)`)
          )}`
        );
      }
      // Trusted migration SQL, not request input.
      await tx.$executeRawUnsafe(block);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

beforeEach(async () => {
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${ORG_ID}::uuid, 'Fixture Business'), (${OTHER_ORG_ID}::uuid, 'Other Business')
  `;
  await prisma.$executeRaw`
    INSERT INTO subscription_payments (
      id, organization_id, plan, months, amount, operator, payer_phone_number,
      provider_reference, status, terms_version, confirmed_at
    ) VALUES (
      ${PAYMENT_ID}::uuid, ${ORG_ID}::uuid, 'PRO', 3, 30000, 'MTN_MOMO', '+2250700017001',
      'REF-BIL-002', 'SUCCEEDED', '2026-10', '2026-10-01T00:00:00Z'::timestamptz
    )
  `;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('preflight', () => {
  it('stops on old rows with the count and the ids', async () => {
    await expect(runPreflight([SUB_1, SUB_2])).rejects.toThrow(
      `2 subscription rows must be resolved before rebuilding the table: ${SUB_1},${SUB_2}`
    );
  });

  it('passes when the table is empty', async () => {
    await expect(runPreflight([])).resolves.toBeUndefined();
  });

  it('names at most 20 ids but counts them all', async () => {
    const ids = Array.from(
      { length: 22 },
      (_, index) => `0199e002-0000-7000-8000-${String(index + 1).padStart(12, '0')}`
    );
    const error = await runPreflight(ids).catch((caught: unknown) => String(caught));
    expect(error).toContain('22 subscription rows');
    expect(error).toContain(ids[19]);
    expect(error).not.toContain(ids[20]);
  });
});

describe('valid periods', () => {
  it('stores a PAYMENT, a CONVERSION and a GIFT period', async () => {
    await insertPeriod();
    await insertPeriod({
      id: SUB_2,
      origin: 'CONVERSION',
      status: 'SCHEDULED',
      startsAt: '2027-01-01T00:00:00Z',
      endsAt: '2027-02-01T00:00:00Z',
    });
    await insertPeriod({
      id: SUB_3,
      origin: 'GIFT',
      plan: 'ESSENTIAL',
      status: 'ENDED',
      endReason: 'EXPIRED',
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2026-02-01T00:00:00Z',
    });
    const rows = await prisma.$queryRaw<
      Array<{ id: string; plan: string; months: number | null; price: bigint; created_at: Date }>
    >`SELECT id, plan::text AS plan, months, price, created_at FROM subscriptions ORDER BY id`;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ plan: 'PRO', months: 3, price: 30000n });
    expect(rows[1]).toMatchObject({ months: null, price: 0n });
    expect(rows[2]).toMatchObject({ plan: 'ESSENTIAL', price: 0n });
    expect(rows[0].created_at).toBeInstanceOf(Date);
  });

  it('refuses an unknown plan, origin, status and end reason with 22P02', async () => {
    const values = [
      { plan: 'BASIC' },
      { origin: 'TRIAL' },
      { status: 'EXPIRED' },
      { status: 'ENDED', endReason: 'LOST' },
    ];
    for (const value of values) {
      expect(await captureSqlCode(insertPeriod(value))).toBe('22P02');
    }
  });

  it('refuses a null in each required column with 23502', async () => {
    for (const column of ['organization_id', 'plan', 'price', 'origin', 'status', 'created_at']) {
      const columns = [
        'id',
        'organization_id',
        'plan',
        'price',
        'origin',
        'status',
        'starts_at',
        'ends_at',
        'created_at',
      ];
      const values = columns.map((name) => {
        if (name === column) return Prisma.sql`NULL`;
        const known: Record<string, Prisma.Sql> = {
          id: Prisma.sql`${SUB_1}::uuid`,
          organization_id: Prisma.sql`${ORG_ID}::uuid`,
          plan: Prisma.sql`'PRO'::public."PaidPlan"`,
          price: Prisma.sql`0`,
          origin: Prisma.sql`'GIFT'::public."SubscriptionOrigin"`,
          status: Prisma.sql`'ACTIVE'::public."SubscriptionStatus"`,
          starts_at: Prisma.sql`'2026-10-01T00:00:00Z'::timestamptz`,
          ends_at: Prisma.sql`'2027-01-01T00:00:00Z'::timestamptz`,
          created_at: Prisma.sql`now()`,
        };
        return known[name];
      });
      const statement = Prisma.sql`INSERT INTO subscriptions (${Prisma.raw(columns.join(', '))})
        VALUES (${Prisma.join(values)})`;
      expect(await captureSqlCode(appPrisma.$executeRaw(statement))).toBe('23502');
    }
  });

  it('refuses null dates with 23502', async () => {
    const code = await captureSqlCode(
      appPrisma.$executeRaw`
        INSERT INTO subscriptions (id, organization_id, plan, price, origin, status)
        VALUES (${SUB_1}::uuid, ${ORG_ID}::uuid, 'PRO', 0, 'GIFT', 'ACTIVE')
      `
    );
    expect(code).toBe('23502');
  });

  it('refuses an unknown business and an unknown payment with 23503', async () => {
    expect(
      await captureSqlCode(insertPeriod({ organizationId: '0199e002-0000-7000-8000-0000000000ff' }))
    ).toBe('23503');
    expect(
      await captureSqlCode(insertPeriod({ paymentId: '0199e002-0000-7000-8000-0000000000fe' }))
    ).toBe('23503');
  });
});

describe('wrong rows', () => {
  it('refuses a second ACTIVE period for the business with 23505', async () => {
    await insertPeriod();
    const code = await captureSqlCode(
      insertPeriod({ id: SUB_2, origin: 'GIFT', startsAt: '2027-01-01T00:00:00Z' })
    );
    expect(code).toBe('23505');
    expect(await countPeriods()).toBe(1);
  });

  it('accepts an ACTIVE period of another business and SCHEDULED or ENDED ones beside it', async () => {
    await insertPeriod({ origin: 'GIFT' });
    await insertPeriod({ id: SUB_2, origin: 'GIFT', organizationId: OTHER_ORG_ID });
    await insertPeriod({
      id: SUB_3,
      origin: 'GIFT',
      status: 'SCHEDULED',
      startsAt: '2027-01-01T00:00:00Z',
      endsAt: '2027-02-01T00:00:00Z',
    });
    expect(await countPeriods()).toBe(3);
  });

  it('refuses starts_at after ends_at with 23514', async () => {
    const code = await captureSqlCode(
      insertPeriod({ startsAt: '2027-01-02T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' })
    );
    expect(code).toBe('23514');
  });

  it('refuses PAYMENT without a payment, and a payment or months on a non-PAYMENT period', async () => {
    expect(await captureSqlCode(insertPeriod({ paymentId: null }))).toBe('23514');
    expect(await captureSqlCode(insertPeriod({ months: null }))).toBe('23514');
    expect(await captureSqlCode(insertPeriod({ origin: 'GIFT', paymentId: PAYMENT_ID }))).toBe(
      '23514'
    );
    expect(await captureSqlCode(insertPeriod({ origin: 'CONVERSION', months: 3 }))).toBe('23514');
  });

  it('refuses months other than 1, 3, 6 or 12 with 23514', async () => {
    expect(await captureSqlCode(insertPeriod({ months: 2 }))).toBe('23514');
    expect(await captureSqlCode(insertPeriod({ months: 0 }))).toBe('23514');
    await expect(insertPeriod({ months: 12 })).resolves.toBe(1);
  });

  it('refuses a price on a CONVERSION or GIFT period with 23514', async () => {
    expect(await captureSqlCode(insertPeriod({ origin: 'CONVERSION', price: 1000 }))).toBe('23514');
    expect(await captureSqlCode(insertPeriod({ origin: 'GIFT', price: 1 }))).toBe('23514');
  });

  it('refuses ENDED without end_reason, and an end_reason on a period not ended, with 23514', async () => {
    expect(await captureSqlCode(insertPeriod({ origin: 'GIFT', status: 'ENDED' }))).toBe('23514');
    expect(
      await captureSqlCode(insertPeriod({ origin: 'GIFT', status: 'ACTIVE', endReason: 'EXPIRED' }))
    ).toBe('23514');
    expect(
      await captureSqlCode(
        insertPeriod({ origin: 'GIFT', status: 'SCHEDULED', endReason: 'CLOSED' })
      )
    ).toBe('23514');
  });
});

describe('no delete', () => {
  it('refuses DELETE and TRUNCATE for the application role with 42501', async () => {
    await insertPeriod();
    expect(await captureSqlCode(appPrisma.$executeRaw`DELETE FROM subscriptions`)).toBe('42501');
    expect(await captureSqlCode(appPrisma.$executeRaw`TRUNCATE TABLE subscriptions`)).toBe(
      '42501'
    );
    expect(await countPeriods()).toBe(1);
  });

  it('still lets the application role update a period', async () => {
    await insertPeriod();
    await expect(
      appPrisma.$executeRaw`
        UPDATE subscriptions
        SET status = 'ENDED'::public."SubscriptionStatus", end_reason = 'UPGRADED'::public."SubscriptionEndReason"
        WHERE id = ${SUB_1}::uuid
      `
    ).resolves.toBe(1);
  });
});

describe('same payment', () => {
  it('refuses a second period using the payment of an existing period with 23505', async () => {
    await insertPeriod();
    const code = await captureSqlCode(
      insertPeriod({
        id: SUB_2,
        status: 'SCHEDULED',
        startsAt: '2027-01-01T00:00:00Z',
        endsAt: '2027-04-01T00:00:00Z',
      })
    );
    expect(code).toBe('23505');
    expect(await countPeriods()).toBe(1);
  });

  it('lets two concurrent inserts with one payment store a single period', async () => {
    const results = await Promise.all([
      captureSqlCode(insertPeriod({ id: SUB_1, status: 'SCHEDULED' })),
      captureSqlCode(insertPeriod({ id: SUB_2, status: 'SCHEDULED' })),
    ]);
    expect(results.filter((code) => code === '23505')).toHaveLength(1);
    expect(await countPeriods()).toBe(1);
  });
});
