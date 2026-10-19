import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
const jobs: { to: string; channel?: string }[] = [];
const cfg = vi.hoisted(() => ({ limit: null as number | null }));

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
  configService: {
    get: (category: string, key: string) =>
      Promise.resolve(
        category === 'auth' && key === 'max_number_checks_per_ip_per_hour' ? cfg.limit : null
      ),
  },
}));

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');

type Body = { error?: { code: string } } & Record<string, unknown>;
const post = async (body: Record<string, unknown>) => {
  const res = await request(app).post('/api/v1/auth/password-reset/request').send(body);
  return { status: res.status, raw: res.body as Body };
};
const PHONE = '+237677125456';
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
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number LIKE '+237677125%'`;
}
beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  cfg.limit = null;
  await clean();
});
afterAll(clean);

const NOTHING = { sent: true, expires_in: 600, existing_account: null };

describe('password reset request: SMS only', () => {
  it('registered holder: the code goes by SMS to the number', async () => {
    await register({ email: 'b@example.com', emailVerifiedAt: new Date() });
    const res = await post({ phone_number: PHONE });
    expect(res.status).toBe(202);
    expect(res.raw).toEqual({ ...NOTHING, existing_account: { masked_name: 'Béatrice N…' } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.to).toBe(PHONE);
    expect(jobs[0]?.channel).not.toBe('EMAIL');
    const rows = await prisma.$queryRaw<{ purpose: string; channel: string; target: string }[]>`
      SELECT purpose, channel, target FROM otp_challenges`;
    expect(rows).toEqual([{ purpose: 'PASSWORD_RESET', channel: 'SMS', target: PHONE }]);
  });

  it('email refused: use_email answers 400 and nothing is queued', async () => {
    await register();
    for (const use_email of [true, false]) {
      const res = await post({ phone_number: PHONE, use_email });
      expect(res.status).toBe(400);
      expect(res.raw.error?.code).toBe('VALIDATION_ERROR');
    }
    expect(jobs).toHaveLength(0);
    const rows = await prisma.$queryRaw<unknown[]>`SELECT 1 FROM otp_challenges`;
    expect(rows).toHaveLength(0);
  });

  it('nothing sent: unknown number', async () => {
    const res = await post({ phone_number: PHONE });
    expect(res.status).toBe(202);
    expect(res.raw).toEqual(NOTHING);
    expect(jobs).toHaveLength(0);
  });

  it('nothing sent: guest number', async () => {
    await prisma.$executeRaw`INSERT INTO people (id, phone_number, created_at, server_updated_at) VALUES (${newId()}::uuid, ${PHONE}, now(), now())`;
    const res = await post({ phone_number: PHONE });
    expect(res.status).toBe(202);
    expect(res.raw).toEqual(NOTHING);
    expect(jobs).toHaveLength(0);
  });

  it('number checks are counted: the third number from one IP answers 429', async () => {
    cfg.limit = 2;
    expect((await post({ phone_number: '+237677125001' })).status).toBe(202);
    expect((await post({ phone_number: '+237677125002' })).status).toBe(202);
    const third = await post({ phone_number: '+237677125003' });
    expect(third.status).toBe(429);
    expect(third.raw.error?.code).toBe('RATE_LIMITED');
  });

  it('a malformed number is counted too, so scans cannot dodge the limit', async () => {
    cfg.limit = 1;
    expect((await post({ phone_number: 'abc' })).status).toBe(202);
    const second = await post({ phone_number: PHONE });
    expect(second.status).toBe(429);
    expect(second.raw.error?.code).toBe('RATE_LIMITED');
    expect(jobs).toHaveLength(0);
  });

  it('security: a verified email never receives a reset code', async () => {
    await register({ email: 'b@example.com', emailVerifiedAt: new Date() });
    await post({ phone_number: PHONE, use_email: true });
    expect(jobs.filter((j) => j.to === 'b@example.com' || j.channel === 'EMAIL')).toHaveLength(0);
    const rows = await prisma.$queryRaw<
      unknown[]
    >`SELECT 1 FROM otp_challenges WHERE channel = 'EMAIL'`;
    expect(rows).toHaveLength(0);
  });
});
