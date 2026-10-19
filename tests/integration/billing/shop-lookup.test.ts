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
const { findOrganizationByPaymentCode: read } = await import(
  '../../../src/modules/organization/organization.repository.js'
);

const ACTIVE = 'K7AAAAAA';
const SUSPENDED = 'K7BBBBBB';
const CLOSED = 'K7CCCCCC';
const DELETED = 'K7DDDDDD';
const UNKNOWN = 'K7ZZZZZZ';
const CODES = [ACTIVE, SUSPENDED, CLOSED, DELETED];

/** The error body without its per-request id, so two answers can be compared. */
const sameShape = (body: unknown) => {
  const { error } = body as { error: { code: string; message: string } };
  return JSON.stringify({ code: error.code, message: error.message });
};

type ErrBody = { error: { code: string; message: string; details?: unknown } };
const get = (code: string) => request(app).get(`/api/v1/billing/shops/${encodeURIComponent(code)}`);

async function clean() {
  await prisma.organization.deleteMany({ where: { paymentCode: { in: CODES } } });
}

async function seed(
  paymentCode: string,
  name: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' = 'ACTIVE',
  deletedAt: Date | null = null
) {
  await prisma.organization.create({ data: { id: newId(), name, paymentCode, status, deletedAt } });
}

beforeEach(async () => {
  store.clear();
  vi.restoreAllMocks();
  vi.mocked(read).mockClear();
  await clean();
  await seed(ACTIVE, 'Boutique Mbarga');
  await seed(SUSPENDED, 'Suspended shop', 'SUSPENDED');
  await seed(CLOSED, 'Closed shop', 'CLOSED');
  await seed(DELETED, 'Deleted shop', 'ACTIVE', new Date());
});
afterAll(clean);

describe('shop lookup by payment code', () => {
  it('shop name: an ACTIVE business gives its name only, with no sign-in', async () => {
    const res = await get(ACTIVE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Boutique Mbarga' });
  });

  it('loose code: lower case with spaces gives the same answer', async () => {
    const exact = await get(ACTIVE);
    const loose = await get(`  ${ACTIVE.toLowerCase()} `);
    expect(loose.status).toBe(200);
    expect(loose.body).toEqual(exact.body);
  });

  describe('nothing', () => {
    it('a well formed code held by no business is 404 NOT_FOUND', async () => {
      const res = await get(UNKNOWN);
      expect(res.status).toBe(404);
      expect((res.body as ErrBody).error.code).toBe('NOT_FOUND');
    });

    it('SUSPENDED, CLOSED and deleted businesses give the same 404 as an unknown code', async () => {
      const unknown = await get(UNKNOWN);
      for (const code of [SUSPENDED, CLOSED, DELETED]) {
        const res = await get(code);
        expect(res.status).toBe(404);
        expect(sameShape(res.body)).toBe(sameShape(unknown.body));
      }
    });

    it.each([
      ['7 characters', 'K7AAAAA'],
      ['9 characters', 'K7AAAAAAA'],
      ['a zero', 'K7AAAAA0'],
      ['an O', 'K7AAAAAO'],
      ['a one', 'K7AAAAA1'],
      ['a symbol', 'K7AAAA-A'],
    ])('%s is 400 VALIDATION_ERROR without the value', async (_label, code) => {
      const res = await get(code);
      expect(res.status).toBe(400);
      const body = res.body as ErrBody;
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(body)).not.toContain(code);
    });
  });

  it('limit: 30 lookups are normal, the 31st is 429 RATE_LIMITED and logged without the address', async () => {
    const warn = vi.spyOn(logger, 'warn');
    for (let i = 0; i < 30; i += 1) {
      expect((await get(ACTIVE)).status).toBe(200);
    }
    const res = await get(ACTIVE);
    expect(res.status).toBe(429);
    expect((res.body as ErrBody).error.code).toBe('RATE_LIMITED');
    const call = warn.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === 'payment_code_rate_limited'
    );
    expect(call).toBeDefined();
    expect(JSON.stringify(call)).not.toMatch(/127\.0\.0\.1|::1|ffff/);
    expect([...store.keys()].every((k) => k.startsWith('billing:code:'))).toBe(true);
  });

  it('guessing: 40 unknown codes give 30 identical 404s then 429, and the database is not read after the limit', async () => {
    const answers: { status: number; body: unknown }[] = [];
    for (let i = 0; i < 40; i += 1) {
      const res = await get(UNKNOWN);
      answers.push({ status: res.status, body: res.body });
    }
    const first30 = answers.slice(0, 30);
    expect(first30.every((a) => a.status === 404)).toBe(true);
    expect(new Set(first30.map((a) => sameShape(a.body))).size).toBe(1);
    expect(answers.slice(30).every((a) => a.status === 429)).toBe(true);
    expect(read).toHaveBeenCalledTimes(30);
  });

  it('a rejected malformed code does not read the database', async () => {
    await get('K7AAAAA0');
    expect(read).not.toHaveBeenCalled();
  });
});
