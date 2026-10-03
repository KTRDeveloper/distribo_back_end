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
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM refresh_tokens`;
  await prisma.$executeRaw`DELETE FROM devices`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number = ${PHONE}`;
}
async function setup(data: Record<string, unknown> = {}) {
  const p = await prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: PHONE,
      fullName: 'Eve Mbarga',
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
      passwordHash: 'x',
      ...data,
    },
  });
  const s = await issueSession(p.id, dev);
  return s.accessToken;
}
const post = (token: string | null, body: object = {}) => {
  const r = request(app).post('/api/v1/auth/email/verify/request');
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body);
};

beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  await clean();
});
afterAll(clean);

describe('email verification request', () => {
  it('code sent', async () => {
    const t = await setup({ email: 'eve@example.com' });
    const res = await post(t);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ sent: true, expires_in: 600 });
    expect(jobs).toEqual([expect.objectContaining({ to: 'eve@example.com', channel: 'EMAIL' })]);
    const rows = await prisma.$queryRaw<{ purpose: string }[]>`SELECT purpose FROM otp_challenges`;
    expect(rows.map((r) => r.purpose)).toEqual(['EMAIL_VERIFICATION']);
  });

  it('no email', async () => {
    const t = await setup();
    const res = await post(t);
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('EMAIL_MISSING');
    expect(jobs).toHaveLength(0);
  });

  it('already verified', async () => {
    const t = await setup({ email: 'eve@example.com', emailVerifiedAt: new Date() });
    const res = await post(t);
    expect(res.status).toBe(204);
    expect(jobs).toHaveLength(0);
  });

  it('limits', async () => {
    const t = await setup({ email: 'eve@example.com' });
    for (let i = 0; i < 3; i++) {
      expect((await post(t)).status).toBe(202);
      store.forEach((_v, k) => k.startsWith('otp:cooldown') && store.delete(k));
    }
    const res = await post(t);
    expect(res.status).toBe(429);
    expect((res.body as { error: { code: string } }).error.code).toBe('OTP_RATE_LIMITED');
    expect(jobs).toHaveLength(3);
  });
});

describe('email verification request security', () => {
  it('body ignored', async () => {
    const t = await setup({ email: 'eve@example.com' });
    const res = await post(t, { email: 'evil@example.com' });
    expect(res.status).toBe(202);
    expect(jobs.map((j) => j.to)).toEqual(['eve@example.com']);
  });

  it('no token', async () => {
    const res = await post(null);
    expect(res.status).toBe(401);
    expect(jobs).toHaveLength(0);
  });
});
