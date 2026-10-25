import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup.js';
import type { AggregatorPayment } from '../../../src/modules/billing/aggregator.port.js';
import * as repository from '../../../src/modules/billing/payment.repository.js';
import { reconcilePayments } from '../../../src/modules/billing/reconcile.service.js';
import { runReconcilePaymentsJob } from '../../../src/jobs/reconcile-payments.js';

const { listStatement, error } = vi.hoisted(() => ({
  listStatement: vi.fn<(day: string) => Promise<AggregatorPayment[]>>(),
  error: vi.fn<(entry: Record<string, unknown>, message: string) => void>(),
}));
vi.mock('../../../src/modules/billing/aggregator.js', () => ({
  getPaymentAggregator: () => ({ listStatement }),
}));
vi.mock('../../../src/lib/logger.js', () => ({ logger: { error } }));

const day = '2026-10-11';
const now = new Date('2026-10-12T02:00:00.000Z');
const paidAt = new Date('2026-10-11T12:00:00.000Z');
type Status = 'PENDING' | 'SUCCEEDED' | 'REFUNDED' | 'FAILED';

async function payment(status: Status = 'SUCCEEDED', confirmedAt = paidAt) {
  const organization = await prisma.organization.create({
    data: { id: uuidv7(), name: 'Reconciliation test business', paymentCode: uuidv7() },
  });
  return prisma.subscriptionPayment.create({ data: {
    id: uuidv7(), organizationId: organization.id, plan: 'ESSENTIAL', months: 3,
    amount: 15000n, operator: 'MTN_MOMO', payerPhoneNumber: '+237600000001',
    providerReference: uuidv7(), termsVersion: 'test-v1', status,
    confirmedAt: status === 'SUCCEEDED' || status === 'REFUNDED' ? confirmedAt : null,
  } });
}

function statement(row: { providerReference: string; amount: bigint }): AggregatorPayment {
  return { providerReference: row.providerReference, amount: row.amount, status: 'SUCCEEDED', paidAt };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  listStatement.mockReset();
  listStatement.mockResolvedValue([]);
});

describe('nightly payment reconciliation', () => {
  it('returns no mismatches and exit 0 for a clean day with two payments', async () => {
    const rows = [await payment(), await payment()];
    listStatement.mockResolvedValue(rows.map(statement));
    expect(await reconcilePayments(day, now)).toEqual([]);
    expect(await runReconcilePaymentsJob(day, now)).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', 'payment_unknown_locally'],
    ['pending', 'money_without_plan'],
    ['amount', 'payment_amount_differs'],
    ['absent', 'plan_without_money'],
  ] as const)('reports the %s mismatch and returns exit 1 with ids-only logs', async (kind, event) => {
    const row = kind === 'unknown' ? null : await payment(kind === 'pending' ? 'PENDING' : 'SUCCEEDED');
    const line = row ? statement(row) : statement({ providerReference: uuidv7(), amount: 15000n });
    if (kind === 'amount') line.amount = 1n;
    listStatement.mockResolvedValue(kind === 'absent' ? [] : [line]);
    const id = row?.id ?? line.providerReference;
    expect(await reconcilePayments(day, now)).toEqual([{ event, id }]);
    expect(await runReconcilePaymentsJob(day, now)).toBe(1);
    expect(error).toHaveBeenCalledExactlyOnceWith({ event, id }, expect.any(String));
    const logs = JSON.stringify(error.mock.calls);
    expect(logs).not.toContain('15000');
    expect(logs).not.toContain('+237600000001');
    if (row) expect(logs).not.toContain(row.providerReference);
  });

  it('ignores refunded local payments and unsuccessful statement lines', async () => {
    const refunded = await payment('REFUNDED');
    const failed = await payment('FAILED');
    listStatement.mockResolvedValue([
      statement(refunded), { ...statement(failed), status: 'FAILED', paidAt: null },
      { ...statement({ providerReference: uuidv7(), amount: 15000n }), status: 'EXPIRED', paidAt: null },
    ]);
    expect(await reconcilePayments(day, now)).toEqual([]);
    expect(await runReconcilePaymentsJob(day, now)).toBe(0);
  });

  it('defaults to yesterday UTC and exposes the package script', async () => {
    expect(await runReconcilePaymentsJob(undefined, now)).toBe(0);
    expect(listStatement).toHaveBeenCalledExactlyOnceWith(day);
    const pkg = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['job:reconcile-payments']).toBe('tsx src/jobs/reconcile-payments.ts');
  });

  it('reports charged money without activating a plan or changing any rows, even on repeat', async () => {
    const row = await payment('PENDING');
    listStatement.mockResolvedValue([statement(row)]);
    const before = {
      payments: await prisma.subscriptionPayment.findMany(),
      organizations: await prisma.organization.findMany(),
      subscriptions: await prisma.subscription.findMany(),
      receipts: await prisma.subscriptionReceipt.findMany(),
      events: await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM subscription_events ORDER BY id`,
    };
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(await reconcilePayments(day, now)).toEqual([{ event: 'money_without_plan', id: row.id }]);
    }
    expect({
      payments: await prisma.subscriptionPayment.findMany(),
      organizations: await prisma.organization.findMany(),
      subscriptions: await prisma.subscription.findMany(),
      receipts: await prisma.subscriptionReceipt.findMany(),
      events: await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM subscription_events ORDER BY id`,
    }).toEqual(before);
  });

  it('includes UTC midnight and the last millisecond, excluding adjacent days and creation dates', async () => {
    await payment('SUCCEEDED', new Date('2026-10-10T23:59:59.999Z'));
    const first = await payment('SUCCEEDED', new Date('2026-10-11T00:00:00.000Z'));
    const last = await payment('SUCCEEDED', new Date('2026-10-11T23:59:59.999Z'));
    await payment('SUCCEEDED', new Date('2026-10-12T00:00:00.000Z'));
    const result = await reconcilePayments(day, now);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([
      { event: 'plan_without_money', id: first.id }, { event: 'plan_without_money', id: last.id },
    ]));
  });

  it('requires a SUCCEEDED statement line for a locally confirmed payment', async () => {
    const row = await payment();
    listStatement.mockResolvedValue([{ ...statement(row), status: 'FAILED', paidAt: null }]);
    expect(await reconcilePayments(day, now)).toEqual([{ event: 'plan_without_money', id: row.id }]);
  });

  it.each(['2026-02-30', '2026-10-11T00:00:00Z', 'not-a-day'])(
    'rejects invalid UTC day %s before reading the provider', async (invalidDay) => {
      await expect(runReconcilePaymentsJob(invalidDay, now)).rejects.toThrow();
      expect(listStatement).not.toHaveBeenCalled();
    },
  );

  it.each(['statement', 'references', 'confirmed'] as const)(
    'propagates a failed %s read instead of returning a clean exit', async (source) => {
      const row = await payment();
      listStatement.mockResolvedValue([statement(row)]);
      const failure = new Error('Read unavailable');
      if (source === 'statement') listStatement.mockRejectedValue(failure);
      if (source === 'references') vi.spyOn(repository, 'findPaymentsByReferences').mockRejectedValue(failure);
      if (source === 'confirmed') vi.spyOn(repository, 'listConfirmedOn').mockRejectedValue(failure);
      await expect(runReconcilePaymentsJob(day, now)).rejects.toBe(failure);
      expect(error).not.toHaveBeenCalled();
    },
  );
});
