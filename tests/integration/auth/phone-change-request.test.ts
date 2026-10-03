import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
const jobs: { to: string; channel: string }[] = [];

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

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const PHONE = '+237677124456';
const NEW = '+237677124457';
const OTHER = '+237677124458';
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM refresh_tokens`;
  await prisma.$executeRaw`DELETE FROM devices`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number IN (${PHONE}, ${NEW}, ${OTHER})`;
}
async function setup() {
  const p = await prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: PHONE,
      fullName: 'Eve Mbarga',
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
      passwordHash: 'x',
    },
  });
  return (await issueSession(p.id, dev)).accessToken;
}
const post = (token: string | null, body: object = { new_phone_number: NEW }) => {
  const r = request(app).post('/api/v1/auth/phone/change/request');
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body);
};
const code = (res: { body: unknown }) => (res.body as { error: { code: string } }).error.code;

beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  await clean();
});
afterAll(clean);

describe('phone change request', () => {
  it('code sent', async () => {
    const t = await setup();
    const res = await post(t);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ sent: true, expires_in: 600 });
    expect(jobs).toEqual([expect.objectContaining({ to: NEW, channel: 'SMS' })]);
    const rows = await prisma.$queryRaw<{ purpose: string }[]>`SELECT purpose FROM otp_challenges`;
    expect(rows.map((r) => r.purpose)).toEqual(['PHONE_CHANGE']);
  });

  it.each([
    ['own number', () => ({ new_phone_number: PHONE }), 400, 'SAME_NUMBER', null],
    ['registered holder', () => ({ new_phone_number: OTHER }), 409, 'PHONE_TAKEN', true],
    ['guest holder', () => ({ new_phone_number: OTHER }), 409, 'PHONE_TAKEN', false],
    ['foreign', () => ({ new_phone_number: '+33612345678' }), 400, 'UNSUPPORTED_NUMBER', null],
    ['missing', () => ({}), 400, 'VALIDATION_ERROR', null],
  ])('refusal %s', async (_n, body, status, errCode, holder) => {
    const t = await setup();
    if (holder !== null) {
      await prisma.person.create({
        data: {
          id: newId(),
          phoneNumber: OTHER,
          ...(holder
            ? {
                fullName: 'Zed Nana',
                registeredAt: new Date(),
                phoneVerifiedAt: new Date(),
                passwordHash: 'x',
              }
            : {}),
        },
      });
    }
    const res = await post(t, body());
    expect(res.status).toBe(status);
    expect(code(res)).toBe(errCode);
    expect(jobs).toHaveLength(0);
  });

  it('limits', async () => {
    const t = await setup();
    for (let i = 0; i < 3; i++) {
      expect((await post(t)).status).toBe(202);
      store.forEach((_v, k) => k.startsWith('otp:cooldown') && store.delete(k));
    }
    const res = await post(t);
    expect(res.status).toBe(429);
    expect(code(res)).toBe('OTP_RATE_LIMITED');
    expect(jobs).toHaveLength(3);
  });
});

describe('phone change request security', () => {
  it('probing: 409 carries no name or id', async () => {
    const t = await setup();
    const o = await prisma.person.create({
      data: {
        id: newId(),
        phoneNumber: OTHER,
        fullName: 'Zed Nana',
        registeredAt: new Date(),
        phoneVerifiedAt: new Date(),
        passwordHash: 'x',
      },
    });
    const res = await post(t, { new_phone_number: OTHER });
    const text = JSON.stringify(res.body);
    expect(res.status).toBe(409);
    expect(text).not.toContain('Zed');
    expect(text).not.toContain(o.id);
  });

  it('no token', async () => {
    const res = await post(null);
    expect(res.status).toBe(401);
    expect(jobs).toHaveLength(0);
  });
});
