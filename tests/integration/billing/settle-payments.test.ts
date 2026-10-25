import { beforeEach, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup.js';
import { httpError } from '../../../src/lib/http-error.js';
import { settlePendingPayments } from '../../../src/modules/billing/settle.service.js';
import { runSettlePaymentsJob } from '../../../src/jobs/settle-payments.js';

const { getStatus, warn, error, info } = vi.hoisted(() => ({
  getStatus: vi.fn<(reference: string) => Promise<{
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED'; amount?: bigint; paidAt?: Date;
  } | null>>(),
  warn: vi.fn<(entry: Record<string, unknown>, message: string) => void>(),
  error: vi.fn<(entry: Record<string, unknown>, message: string) => void>(),
  info: vi.fn<(entry: Record<string, unknown>, message: string) => void>(),
}));

vi.mock('../../../src/modules/billing/aggregator.js', () => ({
  getPaymentAggregator: () => ({ getStatus }),
}));
vi.mock('../../../src/lib/logger.js', () => ({ logger: { warn, error, info } }));

const now = new Date('2026-10-26T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const emptyReport = { checked: 0, activated: 0, failed: 0, expired: 0, pending: 0, anomalies: 0 };

async function payment(ageMinutes = 20, status: 'PENDING' | 'FAILED' = 'PENDING') {
  const organization = await prisma.organization.create({
    data: { id: uuidv7(), name: 'Settlement test business', paymentCode: uuidv7() },
  });
  return prisma.subscriptionPayment.create({ data: {
    id: uuidv7(), organizationId: organization.id, plan: 'ESSENTIAL', months: 3,
    amount: 15000n, operator: 'MTN_MOMO', payerPhoneNumber: '+237600000001',
    providerReference: uuidv7(), termsVersion: 'test-v1', createdAt: minutesAgo(ageMinutes), status,
  } });
}

function succeeded() {
  return { status: 'SUCCEEDED' as const, amount: 15000n, paidAt: minutesAgo(10) };
}

beforeEach(() => {
  vi.clearAllMocks();
  getStatus.mockReset();
  getStatus.mockResolvedValue(succeeded());
});

describe('settling pending payments', () => {
  it('recovers a missed confirmation with its period, receipt and report', async () => {
    const row = await payment();
    expect(await settlePendingPayments(now)).toEqual({ ...emptyReport, checked: 1, activated: 1 });
    expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: row.id } }))
      .toMatchObject({ status: 'SUCCEEDED', confirmedAt: now });
    expect(await prisma.subscription.count({ where: { paymentId: row.id } })).toBe(1);
    expect(await prisma.subscriptionReceipt.count({ where: { paymentId: row.id } })).toBe(1);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: row.organizationId } }))
      .toMatchObject({ plan: 'ESSENTIAL' });
  });

  it('selects only the oldest 200 stale PENDING payments', async () => {
    const young = await payment(5);
    const failed = await payment(60, 'FAILED');
    const seed = await payment(20);
    const rows = Array.from({ length: 200 }, (_, index) => ({
      id: uuidv7(), organizationId: seed.organizationId, plan: 'ESSENTIAL' as const, months: 3,
      amount: 15000n, operator: 'MTN_MOMO' as const, payerPhoneNumber: '+237600000001',
      providerReference: uuidv7(), termsVersion: 'test-v1', createdAt: minutesAgo(21 + index),
    }));
    await prisma.subscriptionPayment.createMany({ data: rows });
    getStatus.mockResolvedValue({ status: 'FAILED' });
    expect(await settlePendingPayments(now)).toEqual({ ...emptyReport, checked: 200, failed: 200 });
    expect(getStatus.mock.calls.map(([reference]) => reference))
      .toEqual([...rows].reverse().map((row) => row.providerReference));
    for (const row of [young, failed, seed]) {
      expect(getStatus).not.toHaveBeenCalledWith(row.providerReference);
    }
  });

  it.each([
    ['PENDING', 'pending'], ['FAILED', 'failed'], ['EXPIRED', 'expired'],
  ] as const)('records the aggregator outcome %s, never a clock-based outcome', async (status, counter) => {
    const row = await payment();
    getStatus.mockResolvedValue({ status });
    expect(await settlePendingPayments(now)).toEqual({ ...emptyReport, checked: 1, [counter]: 1 });
    expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: row.id } }))
      .toMatchObject({ status, confirmedAt: null });
    expect(await prisma.subscription.count({ where: { paymentId: row.id } })).toBe(0);
  });

  it.each(['unknown reference', 'amount mismatch', 'pending too long'] as const)(
    'warns about %s without blocking the next payment', async (problem) => {
      const row = await payment(problem === 'pending too long' ? 25 * 60 : 21);
      const next = await payment();
      getStatus.mockImplementation((reference: string) => {
        if (reference !== row.providerReference) return Promise.resolve(succeeded());
        if (problem === 'unknown reference') return Promise.resolve(null);
        if (problem === 'amount mismatch') return Promise.resolve({ ...succeeded(), amount: 1n });
        return Promise.resolve({ status: 'PENDING' });
      });
      expect(await settlePendingPayments(now)).toEqual({
        ...emptyReport, checked: 2, activated: 1, pending: problem === 'pending too long' ? 1 : 0,
        anomalies: 1,
      });
      const anomalyLogs = warn.mock.calls.filter(([entry]) => entry.event === 'payment_settle_anomaly');
      expect(anomalyLogs).toHaveLength(1);
      expect(anomalyLogs[0]?.[0]).toEqual({ event: 'payment_settle_anomaly', paymentId: row.id });
      expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
      expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: next.id } }))
        .toMatchObject({ status: 'SUCCEEDED' });
    },
  );

  it('returns job exit codes 1 for anomalies and 0 for a clean report and logs both', async () => {
    await payment();
    getStatus.mockResolvedValueOnce(null);
    expect(await runSettlePaymentsJob(now)).toBe(1);
    expect(info).toHaveBeenLastCalledWith(expect.objectContaining({
      checked: 1, anomalies: 1,
    }), expect.any(String));
    expect(await runSettlePaymentsJob(now)).toBe(0);
    expect(info).toHaveBeenLastCalledWith(expect.objectContaining({
      checked: 1, activated: 1, anomalies: 0,
    }), expect.any(String));
  });

  it('activates a lost confirmation only once across repeated sweeps', async () => {
    const row = await payment();
    await settlePendingPayments(now);
    expect(await settlePendingPayments(now)).toEqual(emptyReport);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(await prisma.subscription.count({ where: { paymentId: row.id } })).toBe(1);
    expect(await prisma.subscriptionReceipt.count({ where: { paymentId: row.id } })).toBe(1);
  });

  it('settles the first and third payments and rethrows the second failure after the loop', async () => {
    const first = await payment(23);
    const second = await payment(22);
    const third = await payment(21);
    const failure = new Error('Provider unavailable');
    getStatus.mockImplementation((reference: string) => {
      if (reference === second.providerReference) return Promise.reject(failure);
      return Promise.resolve(succeeded());
    });
    await expect(settlePendingPayments(now)).rejects.toBe(failure);
    expect(getStatus.mock.calls.map(([reference]) => reference))
      .toEqual([first.providerReference, second.providerReference, third.providerReference]);
    expect(error).toHaveBeenCalledWith({ event: 'payment_settle_failed', paymentId: second.id }, expect.any(String));
    expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: second.id } })).toEqual(second);
    for (const row of [first, third]) {
      expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: row.id } }))
        .toMatchObject({ status: 'SUCCEEDED' });
    }
  });

  it('includes the exact 15-minute cutoff but excludes newer payments', async () => {
    const eligible = await payment(15);
    await payment(15 - 1 / 60_000);
    getStatus.mockResolvedValue({ status: 'PENDING' });
    expect(await settlePendingPayments(now)).toEqual({ ...emptyReport, checked: 1, pending: 1 });
    expect(getStatus).toHaveBeenCalledExactlyOnceWith(eligible.providerReference);
  });

  it('warns only above 24 hours and only when the aggregator still says PENDING', async () => {
    const boundary = await payment(24 * 60);
    await payment(24 * 60 + 1 / 60_000);
    const paid = await payment(25 * 60);
    getStatus.mockImplementation((reference: string) =>
      Promise.resolve(reference === paid.providerReference ? succeeded() : { status: 'PENDING' }));
    expect(await settlePendingPayments(now)).toEqual({
      ...emptyReport, checked: 3, activated: 1, pending: 2, anomalies: 1,
    });
    expect(warn).not.toHaveBeenCalledWith(expect.objectContaining({ paymentId: boundary.id }), expect.anything());
    expect(warn).not.toHaveBeenCalledWith(expect.objectContaining({ paymentId: paid.id }), expect.anything());
  });

  it('preserves the first unexpected error, continues, and does not misclassify coded errors', async () => {
    const first = await payment(22);
    const second = await payment(21);
    const third = await payment(20);
    const failure = httpError(500, 'NOT_FOUND', 'Unexpected failure');
    getStatus.mockImplementation((reference: string) => {
      if (reference === first.providerReference) return Promise.reject(failure);
      if (reference === second.providerReference) return Promise.reject(httpError(409, 'OTHER_CONFLICT', 'Conflict'));
      return Promise.resolve(succeeded());
    });
    await expect(settlePendingPayments(now)).rejects.toBe(failure);
    expect(error).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
    expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: third.id } }))
      .toMatchObject({ status: 'SUCCEEDED' });
  });

  it('concurrent sweeps create only one period and receipt', async () => {
    const row = await payment();
    let calls = 0;
    let release!: () => void;
    const bothChecking = new Promise<void>((resolve) => { release = resolve; });
    getStatus.mockImplementation(async () => {
      if (++calls === 2) release();
      await bothChecking;
      return succeeded();
    });
    const reports = await Promise.all([settlePendingPayments(now), settlePendingPayments(now)]);
    expect(reports.reduce((sum, report) => sum + report.activated, 0)).toBe(1);
    expect(reports.every((report) => report.checked === 1 && report.anomalies === 0)).toBe(true);
    expect(await prisma.subscription.count({ where: { paymentId: row.id } })).toBe(1);
    expect(await prisma.subscriptionReceipt.count({ where: { paymentId: row.id } })).toBe(1);
  });
});
