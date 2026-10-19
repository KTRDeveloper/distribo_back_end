import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number) => {
    const c = store.get(key) ?? 0;
    if (c >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    store.set(key, c + 1);
    return Promise.resolve({ allowed: true, remaining: limit - c - 1 });
  },
}));

vi.mock('../../../src/modules/organization/organization.repository.js', async (original) => {
  const actual = await original<typeof import('../../../src/modules/organization/organization.repository.js')>();
  return { ...actual, findOrganizationByPaymentCode: vi.fn(actual.findOrganizationByPaymentCode) };
});

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { logger } = await import('../../../src/lib/logger.js');
const { getPaymentAggregator } = await import('../../../src/modules/billing/aggregator.js');
const { CURRENT_TERMS_VERSION } = await import('../../../src/modules/billing/payment.service.js');
const { findOrganizationByPaymentCode: read } = await import(
  '../../../src/modules/organization/organization.repository.js'
);

const ACTIVE = 'K9AAAAAA';
const SUSPENDED = 'K9BBBBBB';
const CLOSED = 'K9CCCCCC';
const UNKNOWN = 'K9ZZZZZZ';
const OTHER = 'K9DDDDDD';
const CODES = [ACTIVE, SUSPENDED, CLOSED, OTHER];
const PHONE = '+237677123456';

type ErrBody = { error: { code: string; message: string } };

const aggregator = getPaymentAggregator();
const requestPayment = vi.spyOn(aggregator, 'requestPayment');

function body(overrides: Record<string, unknown> = {}) {
  return {
    id: newId(),
    code: ACTIVE,
    plan: 'ESSENTIAL',
    months: 3,
    operator: 'MTN_MOMO',
    payer_phone_number: '6 77 12 34 56',
    customer_tax_id: 'M0123456789',
    terms_version: CURRENT_TERMS_VERSION,
    ...overrides,
  };
}
const post = (payload: unknown) => request(app).post('/api/v1/billing/payments').send(payload as object);

async function clean() {
  await prisma.subscriptionPayment.deleteMany({
    where: { organization: { paymentCode: { in: CODES } } },
  });
  await prisma.organization.deleteMany({ where: { paymentCode: { in: CODES } } });
}

let activeOrgId = '';
async function seed(
  paymentCode: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' = 'ACTIVE'
) {
  const id = newId();
  await prisma.organization.create({ data: { id, name: `Shop ${paymentCode}`, paymentCode, status } });
  return id;
}
const count = () => prisma.subscriptionPayment.count({ where: { organizationId: activeOrgId } });

beforeEach(async () => {
  store.clear();
  requestPayment.mockClear();
  vi.mocked(read).mockClear();
  await clean();
  activeOrgId = await seed(ACTIVE);
  await seed(SUSPENDED, 'SUSPENDED');
  await seed(CLOSED, 'CLOSED');
});
afterAll(clean);

describe('payment creation', () => {
  it('starts: 201 PENDING with the server amount, one row, one aggregator request', async () => {
    const payload = body();
    const res = await post(payload);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: payload.id,
      status: 'PENDING',
      plan: 'ESSENTIAL',
      months: 3,
      amount: 15000,
      operator: 'MTN_MOMO',
    });
    const rows = await prisma.subscriptionPayment.findMany({ where: { organizationId: activeOrgId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: payload.id,
      amount: 15000n,
      status: 'PENDING',
      payerPhoneNumber: PHONE,
      termsVersion: CURRENT_TERMS_VERSION,
      customerTaxId: 'M0123456789',
    });
    expect(rows[0]?.providerReference).toMatch(/^fake-/);
    expect(requestPayment).toHaveBeenCalledTimes(1);
    expect(requestPayment.mock.calls[0]?.[0]).toMatchObject({
      clientReference: payload.id,
      amount: 15000n,
      operator: 'MTN_MOMO',
      payerPhone: PHONE,
    });
  });

  it('optional NIU: absent is stored as null', async () => {
    const payload = body();
    delete (payload as Record<string, unknown>).customer_tax_id;
    expect((await post(payload)).status).toBe(201);
    const row = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: payload.id } });
    expect(row.customerTaxId).toBeNull();
  });

  it('answer lists six fields, no number or reference', async () => {
    const res = await post(body());
    expect(Object.keys(res.body as object).sort()).toEqual(
      ['amount', 'id', 'months', 'operator', 'plan', 'status']
    );
  });

  describe('repeat', () => {
    it('the same body twice gives equal answers, one row and one aggregator request', async () => {
      const payload = body();
      const first = await post(payload);
      const second = await post(payload);
      expect(second.status).toBe(first.status);
      expect(second.body).toEqual(first.body);
      expect(await count()).toBe(1);
      expect(requestPayment).toHaveBeenCalledTimes(1);
    });

    it('the same id with another plan, months, operator or number is 409 PAYMENT_ID_USED', async () => {
      const payload = body();
      await post(payload);
      const others = [
        { plan: 'PRO' },
        { months: 6 },
        { operator: 'ORANGE_MONEY' },
        { payer_phone_number: '+237677123457' },
      ];
      for (const other of others) {
        const res = await post({ ...payload, ...other });
        expect(res.status).toBe(409);
        expect((res.body as ErrBody).error.code).toBe('PAYMENT_ID_USED');
      }
      expect(await count()).toBe(1);
      expect(requestPayment).toHaveBeenCalledTimes(1);
    });

    it('the same id for another business is 409 PAYMENT_ID_USED', async () => {
      const payload = body();
      await post(payload);
      await seed(OTHER);
      const res = await post({ ...payload, code: OTHER });
      expect(res.status).toBe(409);
      expect((res.body as ErrBody).error.code).toBe('PAYMENT_ID_USED');
    });

    it('two concurrent identical requests create one row and one aggregator request', async () => {
      const payload = body();
      const [a, b] = await Promise.all([post(payload), post(payload)]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body).toEqual(b.body);
      expect(await count()).toBe(1);
      expect(requestPayment).toHaveBeenCalledTimes(1);
    });
  });

  describe('refused: nothing stored, no aggregator call', () => {
    it.each([
      ['plan FREE', { plan: 'FREE' }],
      ['months 2', { months: 2 }],
      ['an invalid number', { payer_phone_number: '12345' }],
      ['a landline', { payer_phone_number: '+237222123456' }],
      ['a long NIU', { customer_tax_id: 'A'.repeat(21) }],
      ['a NIU with a symbol', { customer_tax_id: 'M01-23' }],
      ['an empty NIU', { customer_tax_id: '' }],
      ['an operator OTHER', { operator: 'OTHER' }],
      ['a long terms version', { terms_version: 'v'.repeat(21) }],
      ['an id that is not a UUIDv7', { id: '11111111-1111-4111-8111-111111111111' }],
      ['a malformed code', { code: 'K9AAAAA0' }],
      ['an unknown field', { extra: 1 }],
    ])('%s is 400 VALIDATION_ERROR', async (_label, override) => {
      const res = await post(body(override));
      expect(res.status).toBe(400);
      const err = res.body as ErrBody;
      expect(err.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(err)).not.toContain('6 77 12 34 56');
      expect(await prisma.subscriptionPayment.count()).toBe(0);
      expect(requestPayment).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown business', UNKNOWN],
      ['a SUSPENDED business', SUSPENDED],
      ['a CLOSED business', CLOSED],
    ])('%s is 404 NOT_FOUND', async (_label, code) => {
      const res = await post(body({ code }));
      expect(res.status).toBe(404);
      expect((res.body as ErrBody).error.code).toBe('NOT_FOUND');
      expect(await prisma.subscriptionPayment.count()).toBe(0);
      expect(requestPayment).not.toHaveBeenCalled();
    });

    it('an older terms version is 409 TERMS_CHANGED', async () => {
      const res = await post(body({ terms_version: '1999-01' }));
      expect(res.status).toBe(409);
      expect((res.body as ErrBody).error.code).toBe('TERMS_CHANGED');
      expect(await count()).toBe(0);
      expect(requestPayment).not.toHaveBeenCalled();
    });

    it('an aggregator failure stores nothing and answers 500', async () => {
      requestPayment.mockRejectedValueOnce(new Error('aggregator down'));
      const res = await post(body());
      expect(res.status).toBe(500);
      expect(await count()).toBe(0);
    });
  });

  describe('abuse', () => {
    it('browser amount: an amount in the body is 400 VALIDATION_ERROR, no row, no aggregator call', async () => {
      const res = await post(body({ amount: 1 }));
      expect(res.status).toBe(400);
      expect((res.body as ErrBody).error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.subscriptionPayment.count()).toBe(0);
      expect(requestPayment).not.toHaveBeenCalled();
    });

    it('flood by address: the 11th payment in an hour is 429 RATE_LIMITED before any read', async () => {
      const warn = vi.spyOn(logger, 'warn');
      for (let i = 0; i < 10; i += 1) {
        const res = await post(body({ payer_phone_number: `+23767712${3000 + i}` }));
        expect(res.status).toBe(201);
      }
      vi.mocked(read).mockClear();
      const res = await post(body({ payer_phone_number: '+237677129999' }));
      expect(res.status).toBe(429);
      expect((res.body as ErrBody).error.code).toBe('RATE_LIMITED');
      expect(read).not.toHaveBeenCalled();
      const call = warn.mock.calls.find(
        (c) => (c[0] as { event?: string }).event === 'payment_create_rate_limited'
      );
      expect(call).toBeDefined();
      expect(JSON.stringify(call)).not.toMatch(/127\.0\.0\.1|::1|ffff|677/);
      expect(await count()).toBe(10);
    });

    it('stranger harassed: the 6th request naming one payer number is 429 RATE_LIMITED before any read', async () => {
      for (let i = 0; i < 5; i += 1) {
        expect((await post(body())).status).toBe(201);
      }
      vi.mocked(read).mockClear();
      const res = await post(body());
      expect(res.status).toBe(429);
      expect((res.body as ErrBody).error.code).toBe('RATE_LIMITED');
      expect(read).not.toHaveBeenCalled();
      expect(await count()).toBe(5);
      expect([...store.keys()].some((k) => k.includes('677123456'))).toBe(false);
    });

    it('a rejected body consumes no limit slot', async () => {
      await post(body({ plan: 'FREE' }));
      expect(store.size).toBe(0);
    });
  });
});
