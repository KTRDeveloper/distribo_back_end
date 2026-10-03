import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
const jobs: { to: string }[] = [];

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number) => {
    const c = store.get(key) ?? 0;
    if (c >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    store.set(key, c + 1);
    return Promise.resolve({ allowed: true, remaining: limit - c - 1 });
  },
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: { to: string }) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');

type Body = {
  error: { code: string };
  existing_account: Record<string, string> | null;
};
const post = async (phone?: unknown) => {
  const res = await request(app)
    .post('/api/v1/auth/register/request')
    .send(phone === undefined ? {} : { phone_number: phone });
  return { status: res.status, body: res.body as Body, raw: res.body as Record<string, unknown> };
};

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

describe('register request', () => {
  it('unknown', async () => {
    const res = await post('6 77 12 34 56');
    expect(res.status).toBe(202);
    expect(res.raw).toEqual({ sent: true, expires_in: 600, existing_account: null });
    expect(jobs.map((j) => j.to)).toEqual(['+237677123456']);
  });

  it('guest', async () => {
    const id = newId();
    await prisma.$executeRaw`INSERT INTO people (id, phone_number, created_at, server_updated_at) VALUES (${id}::uuid, '+237677123456', now(), now())`;
    const res = await post('+237677123456');
    expect(res.status).toBe(202);
    expect(res.body.existing_account).toBeNull();
    const rows = await prisma.$queryRaw<{ person_id: string }[]>`SELECT person_id FROM otp_challenges`;
    expect(rows[0]?.person_id).toBe(id);
  });

  it('registered', async () => {
    await prisma.person.create({
      data: { id: newId(), phoneNumber: '+237677123456', fullName: 'Béatrice Ngono', registeredAt: new Date(), passwordHash: 'x', phoneVerifiedAt: new Date() },
    });
    const res = await post('+237677123456');
    expect(res.status).toBe(202);
    expect(res.raw).toEqual({
      sent: true,
      expires_in: 600,
      existing_account: { masked_name: 'Béatrice N…' },
    });
    expect(jobs).toHaveLength(1);
  });

  it.each([
    [undefined, 400, 'VALIDATION_ERROR'],
    ['12345', 400, 'VALIDATION_ERROR'],
    ['+33612345678', 400, 'UNSUPPORTED_NUMBER'],
  ])('invalid %s', async (n, status, code) => {
    const res = await post(n);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(jobs).toHaveLength(0);
  });

  it('limits', async () => {
    const send = () => post('+237677123456');
    for (let i = 0; i < 3; i++) {
      store.delete('otp:cooldown:REGISTRATION:+237677123456');
      expect((await send()).status).toBe(202);
    }
    store.delete('otp:cooldown:REGISTRATION:+237677123456');
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('OTP_RATE_LIMITED');
  });

  it('pumping', async () => {
    for (let i = 0; i < 50; i++) await post(`+4477009000${String(i).padStart(2, '0')}`);
    expect(jobs).toHaveLength(0);
  });

  it('disclosure', async () => {
    await prisma.person.create({
      data: { id: newId(), phoneNumber: '+237677123456', fullName: 'Béatrice Ngono', registeredAt: new Date(), passwordHash: 'x', phoneVerifiedAt: new Date() },
    });
    const res = await post('+237677123456');
    expect(Object.keys(res.raw).sort()).toEqual(['existing_account', 'expires_in', 'sent']);
    expect(Object.keys(res.body.existing_account ?? {})).toEqual(['masked_name']);
  });
});
