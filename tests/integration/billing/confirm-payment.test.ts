import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';
import { getPaymentAggregator } from '../../../src/modules/billing/aggregator.js';
import type { AggregatorPayment } from '../../../src/modules/billing/aggregator.port.js';
import { confirmPayment } from '../../../src/modules/billing/confirmation.service.js';
import * as receipts from '../../../src/modules/billing/receipt.service.js';
import * as limits from '../../../src/modules/billing/limits.service.js';
import { logger } from '../../../src/lib/logger.js';

const ORG = '0199c014-0000-7000-8000-000000000001';
const OWNER = '0199c014-0000-7000-8000-000000000011';
const PAYMENT = '0199c014-0000-7000-8000-000000000021';
const SEATS = ['0199c014-0000-7000-8000-000000000031', '0199c014-0000-7000-8000-000000000032'];
const REFERENCE = 'confirmation-fixture';
const NOW = new Date('2026-10-25T12:00:00Z');
const getStatus = vi.fn<() => Promise<AggregatorPayment | null>>();
const checked: AggregatorPayment = {
  providerReference: REFERENCE, status: 'SUCCEEDED', amount: 15000n, paidAt: NOW,
};

beforeEach(async () => {
  getStatus.mockReset().mockResolvedValue(checked);
  vi.spyOn(getPaymentAggregator(), 'getStatus').mockImplementation(getStatus);
  await prisma.person.createMany({ data: [
    { id: OWNER, phoneNumber: '+2250700014011', fullName: 'Fixture Owner',
      phoneVerifiedAt: NOW, registeredAt: NOW, passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture' },
    ...SEATS.map((id, i) => ({ id, phoneNumber: `+225070001403${i}`, fullName: 'Fixture Seller',
      phoneVerifiedAt: NOW, registeredAt: NOW, passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture' })),
  ] });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG}::uuid, 'Fixture Business')`;
    await tx.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status)
      VALUES ('0199c014-0000-7000-8000-000000000041'::uuid, ${OWNER}::uuid, ${ORG}::uuid, 'OWNER', 'ACTIVE')
    `;
    for (const id of SEATS) {
      await tx.$executeRaw`
        INSERT INTO collaborations (id, person_id, organization_id, role, status, accepted_at)
        VALUES (${id}::uuid, ${id}::uuid, ${ORG}::uuid, 'SELLER', 'PAUSED', ${NOW})
      `;
    }
  });
  await prisma.subscriptionPayment.create({ data: {
    id: PAYMENT, organizationId: ORG, plan: 'ESSENTIAL', months: 3, amount: 15000n,
    operator: 'MTN_MOMO', payerPhoneNumber: '+2250700014011', providerReference: REFERENCE,
    termsVersion: 'fixture-v1',
  } });
});

afterEach(() => vi.restoreAllMocks());

async function paymentEventCount(): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) FROM subscription_events WHERE kind = 'PAYMENT'
  `;
  return Number(row.count);
}

async function expectNoActivation() {
  expect(await prisma.subscription.count()).toBe(0);
  expect(await prisma.subscriptionReceipt.count()).toBe(0);
  const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM subscription_events`;
  expect(row.count).toBe(0n);
}

describe('confirmPayment', () => {
  it('activates the paid period, freezes the receipt and restores paused seats', async () => {
    expect(await confirmPayment(REFERENCE, { status: 'untrusted' }, NOW)).toBe('ACTIVATED');
    expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: PAYMENT } })).toMatchObject({
      status: 'SUCCEEDED', confirmedAt: NOW,
      providerPayload: {
        received: { status: 'untrusted' },
        checked: { providerReference: REFERENCE, status: 'SUCCEEDED', amount: '15000', paidAt: NOW.toISOString() },
      },
    });
    const period = await prisma.subscription.findFirstOrThrow();
    expect(period).toMatchObject({ paymentId: PAYMENT, status: 'ACTIVE', plan: 'ESSENTIAL', months: 3,
      startsAt: NOW, endsAt: new Date('2027-01-25T12:00:00Z') });
    expect(await prisma.subscriptionReceipt.findFirstOrThrow()).toMatchObject({
      paymentId: PAYMENT, customerName: 'Fixture Business', amount: 15000n,
    });
    expect(await prisma.$queryRaw`
      SELECT actor, payment_id, subscription_id, occurred_at FROM subscription_events WHERE kind = 'PAYMENT'
    `).toEqual([
      { actor: 'PAYER', payment_id: PAYMENT, subscription_id: period.id, occurred_at: NOW },
    ]);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: ORG } })).toMatchObject({
      plan: 'ESSENTIAL', maxCollaborators: 5,
    });
    expect(await prisma.collaboration.findMany({ where: { id: { in: SEATS } } })).toEqual(
      [expect.objectContaining({ status: 'ACTIVE' }), expect.objectContaining({ status: 'ACTIVE' })],
    );
  });

  it('replays without another provider call, period or receipt', async () => {
    expect(await confirmPayment(REFERENCE, {}, NOW)).toBe('ACTIVATED');
    expect(await confirmPayment(REFERENCE, {}, NOW)).toBe('ALREADY_DONE');
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.subscriptionReceipt.count()).toBe(1);
    expect(await paymentEventCount()).toBe(1);
  });

  it.each(['PENDING', 'FAILED', 'EXPIRED'] as const)('handles provider %s without activating', async (status) => {
    getStatus.mockResolvedValue({ ...checked, status });
    expect(await confirmPayment(REFERENCE, { status: 'SUCCEEDED' }, NOW)).toBe(
      status === 'PENDING' ? 'STILL_PENDING' : status,
    );
    expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: PAYMENT } })).toMatchObject({
      status, confirmedAt: null,
    });
    await expectNoActivation();
  });

  it('rejects a missing local payment without querying the provider', async () => {
    await expect(confirmPayment('absent', {}, NOW)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(getStatus).not.toHaveBeenCalled();
    await expectNoActivation();
  });

  it('rejects an unknown provider reference without changing the payment', async () => {
    getStatus.mockResolvedValue(null);
    await expect(confirmPayment(REFERENCE, {}, NOW)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect((await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: PAYMENT } })).status).toBe('PENDING');
    await expectNoActivation();
  });

  it('rejects another amount and logs the payment id without sensitive fields', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    getStatus.mockResolvedValue({ ...checked, amount: 5000n });
    await expect(confirmPayment(REFERENCE, { phone: 'private-body' }, NOW)).rejects.toMatchObject({
      statusCode: 409, code: 'PAYMENT_MISMATCH',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({ event: 'payment_amount_mismatch', paymentId: PAYMENT });
    expect((await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: PAYMENT } })).status).toBe('PENDING');
    await expectNoActivation();
  });

  it('rolls back a half-done confirmation when receipt issuance fails', async () => {
    vi.spyOn(receipts, 'issueReceipt').mockRejectedValueOnce(new Error('receipt failure'));
    await expect(confirmPayment(REFERENCE, {}, NOW)).rejects.toThrow('receipt failure');
    expect(await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: PAYMENT } })).toMatchObject({
      status: 'PENDING', confirmedAt: null, providerPayload: null,
    });
    await expectNoActivation();
  });

  it('serializes parallel confirmations into one activation', async () => {
    const outcomes = await Promise.all([confirmPayment(REFERENCE, {}, NOW), confirmPayment(REFERENCE, {}, NOW)]);
    expect(outcomes.sort()).toEqual(['ACTIVATED', 'ALREADY_DONE']);
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.subscriptionReceipt.count()).toBe(1);
    expect(await paymentEventCount()).toBe(1);
  });

  it.each(['FAILED', 'EXPIRED'] as const)('does not overwrite activation with a delayed %s result', async (status) => {
    let release!: (payment: AggregatorPayment) => void;
    let queried!: () => void;
    const started = new Promise<void>((resolve) => { queried = resolve; });
    getStatus.mockImplementationOnce(() => {
      queried();
      return new Promise((resolve) => { release = resolve; });
    });
    const delayed = confirmPayment(REFERENCE, {}, NOW);
    await started;
    expect(await confirmPayment(REFERENCE, {}, NOW)).toBe('ACTIVATED');
    release({ ...checked, status });
    expect(await delayed).toBe('ALREADY_DONE');
    expect((await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: PAYMENT } })).status).toBe('SUCCEEDED');
    expect(await prisma.subscriptionReceipt.count()).toBe(1);
  });

  it('rolls back period, receipt, event and rights when limit enforcement fails', async () => {
    vi.spyOn(limits, 'enforceLimits').mockRejectedValueOnce(new Error('limits failure'));
    await expect(confirmPayment(REFERENCE, {}, NOW)).rejects.toThrow('limits failure');
    await expectNoActivation();
    expect((await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: PAYMENT } })).status).toBe('PENDING');
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: ORG } })).plan).toBe('FREE');
    expect(await prisma.collaboration.count({ where: { id: { in: SEATS }, status: 'PAUSED' } })).toBe(2);
  });
});
