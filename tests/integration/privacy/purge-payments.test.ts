import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { purge } from '../../../src/modules/privacy/purge.service';
import { prisma } from '../../setup';

const NOW = new Date('2026-10-05T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ORG_ID = '0199c050-0000-7000-8000-000000000001';

const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);

let sequence = 0;
/** Returns a fresh UUIDv7-shaped id for a row of the fixture. */
function nextId(): string {
  sequence += 1;
  return `0199c050-0000-7000-8000-${String(1000 + sequence).padStart(12, '0')}`;
}

let originalMigrationUrl: string | undefined;

beforeEach(async () => {
  sequence = 0;
  originalMigrationUrl = process.env.MIGRATION_DATABASE_URL;
  process.env.MIGRATION_DATABASE_URL = process.env.DATABASE_URL;
  await prisma.organization.create({ data: { id: ORG_ID, name: 'Fixture Business' } });
});

afterEach(() => {
  if (originalMigrationUrl === undefined) delete process.env.MIGRATION_DATABASE_URL;
  else process.env.MIGRATION_DATABASE_URL = originalMigrationUrl;
});

/** Inserts a payment request of the given status and age; SUCCEEDED and REFUNDED carry a confirmation date. */
async function payment(status: string, createdAt: Date): Promise<string> {
  const id = nextId();
  const confirmedAt = status === 'SUCCEEDED' || status === 'REFUNDED' ? createdAt : null;
  await prisma.$executeRaw`
    INSERT INTO subscription_payments (
      id, organization_id, plan, months, amount, operator, payer_phone_number,
      provider_reference, status, terms_version, created_at, confirmed_at
    ) VALUES (
      ${id}::uuid, ${ORG_ID}::uuid, 'ESSENTIAL'::text::public."PaidPlan", 3, 15000,
      'MTN_MOMO'::text::public."PaymentOperator", '+2250700050001', ${'REF-' + id},
      ${status}::text::public."PaymentStatus", '2026-10', ${createdAt}::timestamptz,
      ${confirmedAt}::timestamptz
    )`;
  return id;
}

async function exists(id: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM subscription_payments WHERE id = ${id}::uuid`;
  return Number(rows[0]?.n) === 1;
}

async function receipt(paymentId: string): Promise<string> {
  const id = nextId();
  await prisma.$executeRaw`
    INSERT INTO subscription_receipts (
      id, number, kind, organization_id, payment_id, customer_name, label,
      amount_excl_tax, vat_rate_bp, vat_amount, amount, issued_at
    ) VALUES (
      ${id}::uuid, next_subscription_receipt_number(${daysAgo(4000)}::timestamptz),
      'RECEIPT'::text::public."ReceiptKind", ${ORG_ID}::uuid, ${paymentId}::uuid,
      'Fixture Business', 'Essential, 3 months', 12579, 1925, 2421, 15000,
      ${daysAgo(4000)}::timestamptz
    )`;
  return id;
}

describe('purge of payment requests (PRIV-005)', () => {
  it('AC-1 retention, CM-44: failed and expired requests go after 90 days, the others stay', async () => {
    const rows: Array<[string, number, boolean]> = [
      ['FAILED', 91, true],
      ['EXPIRED', 91, true],
      ['FAILED', 89, false],
      ['PENDING', 91, false],
      ['SUCCEEDED', 400, false],
      ['REFUNDED', 400, false],
    ];
    const seeded: Array<[string, boolean]> = [];
    for (const [status, age, deleted] of rows) {
      seeded.push([await payment(status, daysAgo(age)), deleted]);
    }

    const counts = await purge(NOW);

    for (const [id, deleted] of seeded) {
      expect(await exists(id), id).toBe(!deleted);
    }
    expect(counts.subscription_payments).toBe(2);
  });

  it('AC-2 cited kept: a request that an event cites stays and the purge does not fail', async () => {
    const cited = await payment('EXPIRED', daysAgo(91));
    const free = await payment('EXPIRED', daysAgo(91));
    await prisma.$executeRaw`
      INSERT INTO subscription_events (id, organization_id, kind, actor, payment_id)
      VALUES (${nextId()}::uuid, ${ORG_ID}::uuid, 'PAYMENT'::text::public."SubscriptionEventKind",
        'SYSTEM'::text::public."SubscriptionEventActor", ${cited}::uuid)`;

    const counts = await purge(NOW);

    expect(await exists(cited)).toBe(true);
    expect(await exists(free)).toBe(false);
    expect(counts.subscription_payments).toBe(1);
  });

  it('AC-2 cited kept: a request that a receipt cites stays', async () => {
    const cited = await payment('FAILED', daysAgo(120));
    await receipt(cited);

    const counts = await purge(NOW);

    expect(await exists(cited)).toBe(true);
    expect(counts.subscription_payments).toBe(0);
  });

  it('AC-3 batches: 2500 due requests are all deleted, then a second run deletes 0', async () => {
    await prisma.$executeRaw`
      INSERT INTO subscription_payments (
        id, organization_id, plan, months, amount, operator, payer_phone_number,
        provider_reference, status, terms_version, created_at
      )
      SELECT gen_random_uuid(), ${ORG_ID}::uuid, 'ESSENTIAL'::text::public."PaidPlan", 3, 15000,
        'MTN_MOMO'::text::public."PaymentOperator", '+2250700050001', 'BULK-' || n,
        'FAILED'::text::public."PaymentStatus", '2026-10', ${daysAgo(100)}::timestamptz
      FROM generate_series(1, 2500) AS n`;

    const first = await purge(NOW);
    const second = await purge(NOW);

    expect(first.subscription_payments).toBe(2500);
    expect(second.subscription_payments).toBe(0);
    expect(await prisma.subscriptionPayment.count()).toBe(0);
  });

  it('AB-1 history kept: 11-year-old succeeded and refunded payments and their receipts are untouched', async () => {
    const old = daysAgo(4000);
    const succeeded = await payment('SUCCEEDED', old);
    const refunded = await payment('REFUNDED', old);
    await receipt(succeeded);
    await receipt(refunded);

    const counts = await purge(NOW);

    expect(counts.subscription_payments).toBe(0);
    expect(await exists(succeeded)).toBe(true);
    expect(await exists(refunded)).toBe(true);
    expect(await prisma.subscriptionReceipt.count()).toBe(2);
  });
});
