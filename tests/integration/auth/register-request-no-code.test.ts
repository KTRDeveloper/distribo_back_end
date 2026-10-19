import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
const jobs: { to: string }[] = [];
const cfg = vi.hoisted(() => ({ limit: null as number | null }));

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
  enqueueOtpDelivery: (d: { to: string }) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: {
    get: (category: string, key: string) =>
      Promise.resolve(
        category === 'auth' && key === 'max_number_checks_per_ip_per_hour' ? cfg.limit : null
      ),
  },
}));

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');

const PHONE = '+237677123456';
type Body = { error?: { code: string }; existing_account?: Record<string, string> | null };
const post = async (phone: string) => {
  const res = await request(app)
    .post('/api/v1/auth/register/request')
    .send({ phone_number: phone });
  return { status: res.status, body: res.body as Body, raw: res.body as Record<string, unknown> };
};
const registered = () =>
  prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: PHONE,
      fullName: 'Béatrice Ngono',
      registeredAt: new Date(),
      passwordHash: 'x',
      phoneVerifiedAt: new Date(),
    },
  });

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number LIKE '+237677123%'`;
}
beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  cfg.limit = null;
  await clean();
});
afterAll(clean);

describe('register request: a registered number gets no code', () => {
  it('unknown number', async () => {
    const res = await post('6 77 12 34 56');
    expect(res.status).toBe(202);
    expect(res.raw).toEqual({ sent: true, expires_in: 600, existing_account: null });
    expect(jobs.map((j) => j.to)).toEqual([PHONE]);
  });

  it('guest number', async () => {
    const id = newId();
    await prisma.$executeRaw`INSERT INTO people (id, phone_number, created_at, server_updated_at) VALUES (${id}::uuid, ${PHONE}, now(), now())`;
    const res = await post(PHONE);
    expect(res.status).toBe(202);
    expect(res.raw).toEqual({ sent: true, expires_in: 600, existing_account: null });
    const rows = await prisma.$queryRaw<
      { person_id: string }[]
    >`SELECT person_id FROM otp_challenges`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.person_id).toBe(id);
    expect(jobs).toHaveLength(1);
  });

  it('registered number', async () => {
    await registered();
    const res = await post(PHONE);
    expect(res.status).toBe(202);
    expect(res.raw).toEqual({
      sent: false,
      expires_in: 0,
      existing_account: { masked_name: 'Béatrice N…' },
    });
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM otp_challenges`;
    expect(Number(rows[0]?.n)).toBe(0);
    expect(jobs).toHaveLength(0);
  });

  it('number checks', async () => {
    cfg.limit = 2;
    expect((await post('+237677123401')).status).toBe(202);
    expect((await post('+237677123402')).status).toBe(202);
    const res = await post('+237677123403');
    expect(res.status).toBe(429);
    expect(res.body.error?.code).toBe('RATE_LIMITED');
    expect(jobs).toHaveLength(2);
  });

  it('a registered number is counted as a number check too', async () => {
    cfg.limit = 1;
    await registered();
    expect((await post(PHONE)).status).toBe(202);
    const res = await post(PHONE);
    expect(res.status).toBe(429);
    expect(res.body.error?.code).toBe('RATE_LIMITED');
  });

  it('no flooding', async () => {
    await registered();
    for (let i = 0; i < 10; i++) {
      store.clear();
      expect((await post(PHONE)).status).toBe(202);
    }
    expect(jobs).toHaveLength(0);
  });

  it('masked name only', async () => {
    await registered();
    const res = await post(PHONE);
    expect(Object.keys(res.raw).sort()).toEqual(['existing_account', 'expires_in', 'sent']);
    expect(Object.keys(res.body.existing_account ?? {})).toEqual(['masked_name']);
  });
});
