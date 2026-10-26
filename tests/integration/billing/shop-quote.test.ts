import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup.js';

const store = new Map<string, number>();
vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: vi.fn((key: string, limit: number) => {
    const count = store.get(key) ?? 0;
    if (count >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    store.set(key, count + 1);
    return Promise.resolve({ allowed: true, remaining: limit - count - 1 });
  }),
}));
vi.mock('../../../src/modules/organization/organization.repository.js', async (original) => {
  const actual = await original<typeof import('../../../src/modules/organization/organization.repository.js')>();
  return { ...actual, findOrganizationByPaymentCode: vi.fn(actual.findOrganizationByPaymentCode) };
});
vi.mock('../../../src/modules/billing/subscription.repository.js', async (original) => {
  const actual = await original<typeof import('../../../src/modules/billing/subscription.repository.js')>();
  return { ...actual, readQueueFor: vi.fn(actual.readQueueFor) };
});

const { app } = await import('../../../src/app.js');
const { logger } = await import('../../../src/lib/logger.js');
const { checkAndConsume } = await import('../../../src/lib/rate-limit.js');
const { findOrganizationByPaymentCode: readShop } = await import('../../../src/modules/organization/organization.repository.js');
const { readQueueFor } = await import('../../../src/modules/billing/subscription.repository.js');
const NOW = new Date('2026-10-12T09:00:00Z');
const END = new Date('2026-11-01T00:00:00Z');
const CODE = 'Q7AAAAAA';
const UNKNOWN = 'Q7ZZZZZZ';
const ids: string[] = [];
let organizationId: string;
type ErrorBody = { error: { code: string; message: string } };
const get = (query = 'plan=ESSENTIAL&months=3', code = CODE) =>
  request(app).get(`/api/v1/billing/shops/${encodeURIComponent(code)}/quote?${query}`);
const errorOf = (body: unknown) => {
  const { code, message } = (body as ErrorBody).error;
  return { code, message };
};

async function clean() {
  await prisma.subscription.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  ids.length = 0;
}
async function seedOrganization(paymentCode: string) {
  const id = uuidv7();
  ids.push(id);
  await prisma.organization.create({ data: { id, name: 'Quote Fixture', paymentCode } });
  return id;
}
async function period(
  plan: 'ESSENTIAL' | 'PRO',
  status: 'ACTIVE' | 'SCHEDULED' | 'ENDED',
  startsAt: Date,
  endsAt: Date,
  endReason: 'EXPIRED' | 'REFUNDED' | null = null,
  orgId = organizationId,
) {
  return prisma.subscription.create({ data: {
    id: uuidv7(), organizationId: orgId, plan, status, startsAt, endsAt,
    origin: 'GIFT', price: 0n, endReason,
  } });
}
beforeEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  store.clear();
  await clean();
  organizationId = await seedOrganization(CODE);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(async () => {
  vi.useRealTimers();
  await clean();
});

describe('public shop quote', () => {
  it('nothing running: returns exactly seven public fields', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'Quote Fixture', plan: 'ESSENTIAL', months: 3, price: 15000,
      placement: 'NOW', starts_at: NOW.toISOString(), ends_at: '2027-01-12T09:00:00.000Z',
    });
  });

  it.each([
    ['PRO', 'ESSENTIAL', 'QUEUED', END, '2026-12-01T00:00:00.000Z'],
    ['ESSENTIAL', 'ESSENTIAL', 'QUEUED', END, '2026-12-01T00:00:00.000Z'],
    ['ESSENTIAL', 'PRO', 'UPGRADE', NOW, '2026-11-12T09:00:00.000Z'],
  ] as const)('behind %s asking %s', async (running, asked, placement, startsAt, endsAt) => {
    await period(running, 'ACTIVE', new Date('2026-10-01T00:00:00Z'), END);
    const before = await prisma.subscription.findMany({ where: { organizationId } });
    const res = await get(`plan=${asked}&months=1`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ placement, starts_at: startsAt.toISOString(), ends_at: endsAt });
    expect(await prisma.subscription.findMany({ where: { organizationId } })).toEqual(before);
    expect(await prisma.subscriptionEvent.count({ where: { organizationId } })).toBe(0);
  });

  it.each([
    ['ESSENTIAL', 1, 5000], ['PRO', 3, 30000], ['ENTERPRISE', 12, 250000],
  ])('grid %s %i months', async (plan, months, price) => {
    const res = await get(`plan=${plan}&months=${months}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan, months, price });
  });

  it.each([
    'plan=FREE&months=1', 'plan=ESSENTIAL&months=2', 'months=1', 'plan=PRO',
    'plan=PRO&months=1&price=1', 'plan=PRO&months=1&plan=ESSENTIAL',
    'plan=PRO&months=01', 'plan=PRO&months=1&months=3',
  ])('refused query %s before any read', async (query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('VALIDATION_ERROR');
    expect(readShop).not.toHaveBeenCalled();
    expect(readQueueFor).not.toHaveBeenCalled();
  });

  it('refused unknown, suspended, closed and deleted shops identically', async () => {
    const unknown = await get(undefined, UNKNOWN);
    expect(unknown.status).toBe(404);
    expect(errorOf(unknown.body).code).toBe('NOT_FOUND');
    for (const status of ['SUSPENDED', 'CLOSED', 'ACTIVE'] as const) {
      await prisma.organization.update({ where: { id: organizationId }, data: {
        status, deletedAt: status === 'ACTIVE' ? NOW : null,
      } });
      const res = await get();
      expect(res.status).toBe(404);
      expect(errorOf(res.body)).toEqual(errorOf(unknown.body));
    }
    expect(readQueueFor).not.toHaveBeenCalled();
  });

  it('normalizes codes and rejects malformed ones before any read', async () => {
    expect((await get(undefined, `  ${CODE.toLowerCase()} `)).status).toBe(200);
    vi.mocked(readShop).mockClear();
    vi.mocked(readQueueFor).mockClear();
    const res = await get(undefined, 'Q7AAAAA0');
    expect(res.status).toBe(400);
    expect(errorOf(res.body).code).toBe('VALIDATION_ERROR');
    expect(readShop).not.toHaveBeenCalled();
    expect(readQueueFor).not.toHaveBeenCalled();
  });

  it('guessing: 60 identical 404s then ten 429s without additional reads', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const errors: unknown[] = [];
    for (let i = 0; i < 70; i++) {
      const res = await get(undefined, UNKNOWN);
      expect(res.status).toBe(i < 60 ? 404 : 429);
      expect(errorOf(res.body).code).toBe(i < 60 ? 'NOT_FOUND' : 'RATE_LIMITED');
      if (i < 60) errors.push(errorOf(res.body));
    }
    expect(new Set(errors.map((error) => JSON.stringify(error))).size).toBe(1);
    expect(readShop).toHaveBeenCalledTimes(60);
    expect(readQueueFor).not.toHaveBeenCalled();
    expect(checkAndConsume).toHaveBeenCalledWith(expect.stringMatching(/^billing:quote:/), 60, 3600);
    const events = warn.mock.calls.filter((call) =>
      (call[0] as { event?: string }).event === 'payment_code_rate_limited');
    expect(events).toHaveLength(10);
    expect(JSON.stringify(events)).not.toMatch(/127\.0\.0\.1|::1|ffff/);
  });

  it('blocks queue reads as well as shop reads after 60 successful quotes', async () => {
    for (let i = 0; i < 60; i++) expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(429);
    expect(readShop).toHaveBeenCalledTimes(60);
    expect(readQueueFor).toHaveBeenCalledTimes(60);
  });

  it('fails closed without reading when the rate limiter fails', async () => {
    vi.mocked(checkAndConsume).mockRejectedValueOnce(new Error('Fixture unavailable'));
    expect((await get()).status).toBe(500);
    expect(readShop).not.toHaveBeenCalled();
    expect(readQueueFor).not.toHaveBeenCalled();
  });

  it('uses the entire tenant queue without including another business', async () => {
    await period('PRO', 'ACTIVE', new Date('2026-10-01T00:00:00Z'), END);
    await period('ESSENTIAL', 'SCHEDULED', END, new Date('2026-12-01T00:00:00Z'));
    const foreign = await seedOrganization('Q7BBBBBB');
    await period('PRO', 'ACTIVE', NOW, new Date('2027-02-01T00:00:00Z'), null, foreign);
    const res = await get('plan=ESSENTIAL&months=1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      placement: 'QUEUED', starts_at: '2026-12-01T00:00:00.000Z', ends_at: '2027-01-01T00:00:00.000Z',
    });
  });

  it.each([3, 7])('uses the latest natural expiry at the grace boundary of %i days', async (days) => {
    const expired = new Date(NOW.getTime() - days * 86_400_000);
    await period('ESSENTIAL', 'ENDED', new Date('2026-09-01T00:00:00Z'), expired, 'EXPIRED');
    await period('PRO', 'ENDED', expired, new Date(expired.getTime() + 1000), 'REFUNDED');
    const foreign = await seedOrganization('Q7BBBBBB');
    await period('PRO', 'ENDED', expired, NOW, 'EXPIRED', foreign);
    const res = await get('plan=ESSENTIAL&months=1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      placement: 'NOW', starts_at: (days < 7 ? expired : NOW).toISOString(),
    });
  });
});
