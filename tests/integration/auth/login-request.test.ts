import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
const jobs: { to: string; channel: string }[] = [];
const verifyCalls = vi.hoisted(() => ({ n: 0 }));

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number) => {
    const c = store.get(key) ?? 0;
    if (c >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    store.set(key, c + 1);
    return Promise.resolve({ allowed: true, remaining: limit - c - 1 });
  },
  getCount: (key: string) => Promise.resolve(store.get(key) ?? 0),
  resetKey: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: { to: string; channel: string }) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));
vi.mock('../../../src/lib/password.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/lib/password.js')>();
  return {
    ...actual,
    verifyPassword: (h: string, p: string) => {
      verifyCalls.n++;
      return actual.verifyPassword(h, p);
    },
  };
});

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { hashPassword } = await import('../../../src/lib/password.js');

const PHONE = '+237677123456';
const PASSWORD = 'correct horse battery';
const lockKey = `login:fail:${PHONE}`;
type Body = { error?: { code: string }; sent?: boolean; channel?: string; expires_in?: number };
const login = async (password: string, phone = PHONE, extra: object = {}) => {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ phone_number: phone, password, ...extra });
  return { status: res.status, body: res.body as Body };
};

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number LIKE '+237677123%' OR released_phone_number LIKE '+237677123%'`;
}
async function person(data: Record<string, unknown> = {}) {
  return prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: PHONE,
      fullName: 'Béatrice Ngono',
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
      passwordHash: await hashPassword(PASSWORD),
      ...data,
    },
  });
}
beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  verifyCalls.n = 0;
  await clean();
});
afterAll(clean);

describe('login request', () => {
  it('sms code', async () => {
    await person();
    const res = await login(PASSWORD);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ sent: true, channel: 'SMS', expires_in: 600 });
    expect(jobs).toEqual([expect.objectContaining({ to: PHONE, channel: 'SMS' })]);
    const rows = await prisma.$queryRaw<{ purpose: string }[]>`SELECT purpose FROM otp_challenges`;
    expect(rows.map((r) => r.purpose)).toEqual(['LOGIN']);
  });

  it('email code', async () => {
    await person({ email: 'bea@example.com', emailVerifiedAt: new Date() });
    const res = await login(PASSWORD, PHONE, { use_email: true });
    expect(res.status).toBe(202);
    expect(res.body.channel).toBe('EMAIL');
    expect(jobs).toEqual([expect.objectContaining({ to: 'bea@example.com', channel: 'EMAIL' })]);
  });

  it.each([
    ['unverified', { email: 'bea@example.com' }],
    ['empty', {}],
  ])('email unverified: %s', async (_n, data) => {
    await person(data);
    const res = await login(PASSWORD, PHONE, { use_email: true });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('EMAIL_NOT_VERIFIED');
    expect(jobs).toHaveLength(0);
  });

  it('failures alike', async () => {
    const results = [];
    results.push(await login(PASSWORD, '+237677123999'));
    await prisma.person.create({ data: { id: newId(), phoneNumber: '+237677123888' } });
    results.push(await login(PASSWORD, '+237677123888'));
    await person();
    results.push(await login('wrong password!'));
    await prisma.person.create({
      data: {
        id: newId(),
        phoneNumber: null,
        fullName: 'Ancien Titulaire',
        releasedPhoneNumber: '+237677123777',
        registeredAt: new Date(),
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    results.push(await login(PASSWORD, '+237677123777'));
    for (const r of results) {
      expect(r.status).toBe(401);
      expect(r.body.error?.code).toBe(results[0]?.body.error?.code);
      expect(r.body.error?.code).toBe('INVALID_CREDENTIALS');
    }
    expect(jobs).toHaveLength(0);
  });

  it('lock', async () => {
    await person();
    for (let i = 0; i < 5; i++) expect((await login('wrong password!')).status).toBe(401);
    const locked = await login(PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.error?.code).toBe('LOGIN_LOCKED');
    expect(jobs).toHaveLength(0);
    store.delete(lockKey);
    expect((await login(PASSWORD)).status).toBe(202);
    expect(store.get(lockKey) ?? 0).toBe(0);
  });

  it('suspended', async () => {
    await person({ status: 'SUSPENDED' });
    const res = await login(PASSWORD);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('ACCOUNT_SUSPENDED');
    expect(jobs).toHaveLength(0);
  });
});

describe('login security', () => {
  it('stuffing', async () => {
    await person();
    const statuses: number[] = [];
    for (let i = 0; i < 100; i++) statuses.push((await login('wrong password!')).status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(95);
    expect(verifyCalls.n).toBe(5);
  });

  it('enumeration', async () => {
    await person();
    const known = await login('wrong password!');
    verifyCalls.n = 0;
    const unknown = await login('wrong password!', '+237677123999');
    expect(unknown.status).toBe(known.status);
    expect(unknown.body.error?.code).toBe(known.body.error?.code);
    expect(verifyCalls.n).toBe(1);
  });
});
