import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
const jobs: { to: string; channel?: string }[] = [];

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number) => {
    const c = store.get(key) ?? 0;
    if (c >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    store.set(key, c + 1);
    return Promise.resolve({ allowed: true, remaining: limit - c - 1 });
  },
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: { to: string; channel?: string }) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');

const post = async (body: Record<string, unknown>) => {
  const res = await request(app).post('/api/v1/auth/password-reset/request').send(body);
  return { status: res.status, raw: res.body as Record<string, unknown> };
};
const PHONE = '+237677123456';
const register = (extra: Record<string, unknown> = {}) =>
  prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: PHONE,
      fullName: 'Béatrice Ngono',
      registeredAt: new Date(),
      passwordHash: 'x',
      phoneVerifiedAt: new Date(),
      ...extra,
    },
  });

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number LIKE '+237677123%'`;
}
beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  await clean();
});
afterAll(clean);

const SAME = { sent: true, expires_in: 600, existing_account: null };

describe('password reset request', () => {
  it('sms', async () => {
    await register();
    const res = await post({ phone_number: PHONE });
    expect(res.status).toBe(202);
    expect(res.raw).toEqual({ ...SAME, existing_account: { masked_name: 'Béatrice N…' } });
    expect(jobs.map((j) => j.to)).toEqual([PHONE]);
    const rows = await prisma.$queryRaw<{ purpose: string }[]>`SELECT purpose FROM otp_challenges`;
    expect(rows.map((r) => r.purpose)).toEqual(['PASSWORD_RESET']);
  });

  it('email', async () => {
    await register({ email: 'b@example.com', emailVerifiedAt: new Date() });
    const res = await post({ phone_number: PHONE, use_email: true });
    expect(res.status).toBe(400);
    expect((res.raw.error as { code: string }).code).toBe('VALIDATION_ERROR');
    expect(jobs).toHaveLength(0);
  });

  it('nothing sent: unknown', async () => {
    const res = await post({ phone_number: PHONE });
    expect(res.status).toBe(202);
    expect(res.raw).toEqual(SAME);
    expect(jobs).toHaveLength(0);
  });

  it('nothing sent: guest', async () => {
    await prisma.$executeRaw`INSERT INTO people (id, phone_number, created_at, server_updated_at) VALUES (${newId()}::uuid, ${PHONE}, now(), now())`;
    const res = await post({ phone_number: PHONE });
    expect(res.status).toBe(202);
    expect(res.raw).toEqual(SAME);
    expect(jobs).toHaveLength(0);
  });

  it('nothing sent: unverified email', async () => {
    await register({ email: 'b@example.com' });
    const res = await post({ phone_number: PHONE, use_email: true });
    expect(res.status).toBe(400);
    expect((res.raw.error as { code: string }).code).toBe('VALIDATION_ERROR');
    expect(jobs).toHaveLength(0);
  });

  it('limits', async () => {
    await register();
    for (let i = 0; i < 3; i++) {
      store.delete(`otp:cooldown:PASSWORD_RESET:${PHONE}`);
      expect((await post({ phone_number: PHONE })).status).toBe(202);
    }
    store.delete(`otp:cooldown:PASSWORD_RESET:${PHONE}`);
    const res = await request(app).post('/api/v1/auth/password-reset/request').send({ phone_number: PHONE });
    expect(res.status).toBe(429);
    expect((res.body as { error: { code: string } }).error.code).toBe('OTP_RATE_LIMITED');
  });

  it('enumeration', async () => {
    await register();
    const known = await post({ phone_number: PHONE });
    const unknown = await post({ phone_number: '+237677123499' });
    expect(Object.keys(known.raw).sort()).toEqual(Object.keys(unknown.raw).sort());
    expect(unknown.raw.existing_account).toBeNull();
  });

  it('pumping', async () => {
    for (let i = 0; i < 50; i++) {
      const res = await post({ phone_number: `+4477009000${String(i).padStart(2, '0')}` });
      expect(res.status).toBe(202);
    }
    expect(jobs).toHaveLength(0);
  });

  it('rejects unknown fields', async () => {
    expect((await post({ phone_number: PHONE, x: 1 })).status).toBe(400);
  });
});
