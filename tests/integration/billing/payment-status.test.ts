import type { PaymentStatus } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup';

const { counts, consume } = vi.hoisted(() => {
  const counts = new Map<string, number>();
  return {
    counts,
    consume: vi.fn((key: string, limit: number, _seconds: number) => {
      const count = counts.get(key) ?? 0;
      if (count >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
      counts.set(key, count + 1);
      return Promise.resolve({ allowed: true, remaining: limit - count - 1 });
    }),
  };
});
vi.mock('../../../src/lib/rate-limit.js', () => ({ checkAndConsume: consume }));

const { app } = await import('../../../src/app.js');
const { logger } = await import('../../../src/lib/logger.js');
const startsAt = new Date('2026-10-01T00:00:00Z');
const endsAt = new Date('2026-11-01T00:00:00Z');
let organizationId: string;
let paymentId: string;
let receiptNumber: string;
const read = (id = paymentId) => request(app).get(`/api/v1/billing/payments/${id}`);

beforeEach(async () => {
  counts.clear();
  consume.mockClear();
  organizationId = uuidv7();
  paymentId = uuidv7();
  await prisma.organization.create({ data: { id: organizationId, name: 'Status Test Shop' } });
  await prisma.subscriptionPayment.create({ data: {
    id: paymentId, organizationId, plan: 'PRO', months: 1, amount: 15000n,
    operator: 'MTN_MOMO', payerPhoneNumber: '+237677123456',
    providerReference: `status-${paymentId}`, providerPayload: { private: 'provider-evidence' },
    termsVersion: '2026-10', customerTaxId: 'TESTNIU123',
  } });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.$executeRaw`DELETE FROM subscription_receipts WHERE organization_id = ${organizationId}::uuid`;
  await prisma.$executeRaw`DELETE FROM subscriptions WHERE organization_id = ${organizationId}::uuid`;
  await prisma.$executeRaw`DELETE FROM subscription_payments WHERE organization_id = ${organizationId}::uuid`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${organizationId}::uuid`;
});

async function setStatus(status: PaymentStatus) {
  await prisma.subscriptionPayment.update({ where: { id: paymentId }, data: {
    status, confirmedAt: status === 'SUCCEEDED' || status === 'REFUNDED' ? startsAt : null,
  } });
}

async function paid() {
  await setStatus('SUCCEEDED');
  await prisma.subscription.create({ data: {
    id: uuidv7(), organizationId, paymentId, plan: 'PRO', months: 1, price: 15000n,
    origin: 'PAYMENT', status: 'ACTIVE', startsAt, endsAt,
  } });
  return prisma.$transaction(async (tx) => {
    const [next] = await tx.$queryRaw<{ number: string }[]>`SELECT next_subscription_receipt_number(${startsAt}) AS number`;
    receiptNumber = next.number;
    return tx.subscriptionReceipt.create({ data: {
      id: uuidv7(), number: receiptNumber, kind: 'RECEIPT', organizationId, paymentId,
      customerName: 'Receipt Shop Snapshot', customerTaxId: 'TESTNIU123',
      label: 'Distribo PRO - 1 month', amountExclTax: 12903n, vatRateBp: 1925,
      vatAmount: 2097n, amount: 15000n, issuedAt: startsAt,
    } });
  });
}

const expectedReceipt = () => ({
  number: receiptNumber, label: 'Distribo PRO - 1 month',
  customer_name: 'Receipt Shop Snapshot', customer_tax_id: 'TESTNIU123',
  amount_excl_tax: 12903, vat_rate_bp: 1925, vat_amount: 2097, amount: 15000,
  issued_at: startsAt.toISOString(),
});

describe('public payment status', () => {
  it('waiting', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: paymentId, status: 'PENDING', business_name: 'Status Test Shop', plan: 'PRO',
      months: 1, amount: 15000, operator: 'MTN_MOMO', period: null, receipt: null,
    });
    expect(consume).toHaveBeenCalledWith(expect.stringMatching(/^billing:status:/), 120, 3600);
  });

  it('paid', async () => {
    await paid();
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: paymentId, status: 'SUCCEEDED', business_name: 'Status Test Shop', plan: 'PRO',
      months: 1, amount: 15000, operator: 'MTN_MOMO',
      period: { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() },
      receipt: expectedReceipt(),
    });
  });

  it.each(['FAILED', 'EXPIRED'] as const)('states %s', async (status) => {
    await setStatus(status);
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status, period: null, receipt: null });
  });

  it('states REFUNDED keeps the original RECEIPT, not the credit note', async () => {
    const receipt = await paid();
    await setStatus('REFUNDED');
    await prisma.$transaction(async (tx) => {
      const [next] = await tx.$queryRaw<{ number: string }[]>`SELECT next_subscription_receipt_number(${endsAt}) AS number`;
      await tx.subscriptionReceipt.create({ data: {
        id: uuidv7(), number: next.number, kind: 'CREDIT_NOTE', organizationId, paymentId,
        cancelsReceiptId: receipt.id, customerName: receipt.customerName,
        customerTaxId: receipt.customerTaxId, label: 'Refund', amountExclTax: 12903n,
        vatRateBp: 1925, vatAmount: 2097n, amount: 15000n, issuedAt: endsAt,
      } });
    });
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'REFUNDED', period: null, receipt: expectedReceipt() });
  });

  it('refused malformed id', async () => {
    const response = await read('not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('refused unknown id', async () => {
    const response = await read(uuidv7());
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('refused the 121st read before any lookup and logs no address', async () => {
    const warn = vi.spyOn(logger, 'warn');
    for (let i = 0; i < 120; i++) expect((await read()).status).toBe(200);
    const lookup = vi.spyOn(prisma.subscriptionPayment, 'findUnique');
    const response = await read();
    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(lookup).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { event: 'payment_status_rate_limited' }, expect.any(String),
    );
  });

  it('disclosure: unknown ids consume the same limit and expose no private payment fields', async () => {
    await paid();
    const first = await read(uuidv7());
    const second = await read(uuidv7());
    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    const firstError = (first.body as { error: { code: string; message: string } }).error;
    const secondError = (second.body as { error: { code: string; message: string } }).error;
    expect({ code: firstError.code, message: firstError.message }).toEqual({
      code: secondError.code, message: secondError.message,
    });
    const real = await read();
    const body = real.body as Record<string, unknown>;
    expect(real.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([
      'amount', 'business_name', 'id', 'months', 'operator', 'period', 'plan', 'receipt', 'status',
    ]);
    expect(body.receipt).toEqual(expectedReceipt());
    for (let i = 3; i < 120; i++) expect((await read(uuidv7())).status).toBe(404);
    expect((await read()).status).toBe(429);
  });

  it('rejects every query field before looking up a payment', async () => {
    const lookup = vi.spyOn(prisma.subscriptionPayment, 'findUnique');
    const response = await read().query({ include: 'provider_payload' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('fails closed without a lookup when the rate limiter fails', async () => {
    consume.mockRejectedValueOnce(new Error('Counter unavailable'));
    const lookup = vi.spyOn(prisma.subscriptionPayment, 'findUnique');
    const response = await read();
    expect(response.status).toBe(500);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('returns the purchased period rather than another period of the business', async () => {
    await paid();
    const otherPaymentId = uuidv7();
    await prisma.subscriptionPayment.create({ data: {
      id: otherPaymentId, organizationId, plan: 'PRO', months: 1, amount: 15000n,
      operator: 'MTN_MOMO', payerPhoneNumber: '+237677123456',
      providerReference: `status-${otherPaymentId}`, termsVersion: '2026-10',
      status: 'SUCCEEDED', confirmedAt: startsAt,
    } });
    await prisma.subscription.create({ data: {
      id: uuidv7(), organizationId, paymentId: otherPaymentId, plan: 'PRO', months: 1, price: 15000n,
      origin: 'PAYMENT', status: 'SCHEDULED', startsAt: endsAt,
      endsAt: new Date('2026-12-01T00:00:00Z'),
    } });
    const response = await read();
    expect(response.status).toBe(200);
    expect((response.body as Record<string, unknown>).period).toEqual({
      starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
    });
  });
});
