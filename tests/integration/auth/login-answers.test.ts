import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
const jobs: { to: string; channel: string }[] = [];
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
  enqueueOtpDelivery: (d: { to: string; channel: string }) => {
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
const { hashPassword } = await import('../../../src/lib/password.js');

const PHONE = '+237677123456';
const PASSWORD = 'correct horse battery';
type Body = { error?: { code: string; message?: string }; sent?: boolean; channel?: string };
const login = async (password: string, phone = PHONE) => {
  const res = await request(app).post('/api/v1/auth/login').send({ phone_number: phone, password });
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
  cfg.limit = null;
  await clean();
});
afterAll(clean);

describe('login answers', () => {
  it('right password', async () => {
    await person();
    const res = await login(PASSWORD);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ sent: true, channel: 'SMS' });
    expect(jobs).toEqual([expect.objectContaining({ to: PHONE, channel: 'SMS' })]);
    const rows = await prisma.$queryRaw<{ purpose: string }[]>`SELECT purpose FROM otp_challenges`;
    expect(rows.map((r) => r.purpose)).toEqual(['LOGIN']);
  });

  it.each(['an unknown number', 'a guest number', 'a released number'])(
    'no account: %s',
    async (kase) => {
      let phone = '+237677123999';
      if (kase === 'a guest number') {
        phone = '+237677123888';
        await prisma.person.create({ data: { id: newId(), phoneNumber: phone } });
      }
      if (kase === 'a released number') {
        phone = '+237677123777';
        await prisma.person.create({
          data: {
            id: newId(),
            phoneNumber: null,
            fullName: 'Ancien Titulaire',
            releasedPhoneNumber: phone,
            registeredAt: new Date(),
            passwordHash: await hashPassword(PASSWORD),
          },
        });
      }
      const res = await login(PASSWORD, phone);
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('ACCOUNT_NOT_FOUND');
      expect(jobs).toHaveLength(0);
    }
  );

  it('wrong password', async () => {
    await person();
    const res = await login('wrong password!');
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('INVALID_CREDENTIALS');
    expect(store.get(`login:fail:${PHONE}`)).toBe(1);
    expect(jobs).toHaveLength(0);
  });

  it('suspended', async () => {
    await person({ status: 'SUSPENDED' });
    const right = await login(PASSWORD);
    expect(right.status).toBe(403);
    expect(right.body.error?.code).toBe('ACCOUNT_SUSPENDED');
    expect(jobs).toHaveLength(0);
    const wrong = await login('wrong password!');
    expect(wrong.status).toBe(401);
    expect(wrong.body.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('number checks', async () => {
    cfg.limit = 2;
    const phones = ['+237677123001', '+237677123002', '+237677123003'];
    const statuses = [];
    for (const p of phones) statuses.push((await login(PASSWORD, p)).status);
    expect(statuses).toEqual([404, 404, 429]);
    const limited = await login(PASSWORD, '+237677123004');
    expect(limited.body.error?.code).toBe('RATE_LIMITED');

    store.clear();
    cfg.limit = null;
    for (let i = 0; i < 50; i++) {
      const res = await login(PASSWORD, `+23767712${String(3100 + i)}`);
      expect(res.status).toBe(404);
    }
  });
});

describe('login answers security', () => {
  it('scan', async () => {
    cfg.limit = 5;
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) {
      statuses.push((await login(PASSWORD, `+23767712${String(3200 + i)}`)).status);
    }
    expect(statuses.filter((s) => s === 404)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  });

  it('suspension hidden', async () => {
    await person({ status: 'SUSPENDED' });
    const suspended = await login('wrong password!');
    store.clear();
    await prisma.person.updateMany({ where: { phoneNumber: PHONE }, data: { status: 'ACTIVE' } });
    const active = await login('wrong password!');
    expect(suspended.status).toBe(401);
    const bare = (r: { status: number; body: Body }) => ({
      status: r.status,
      code: r.body.error?.code,
      message: r.body.error?.message,
    });
    expect(bare(suspended)).toEqual(bare(active));
  });

  it('limit answer does not echo the number', async () => {
    cfg.limit = 1;
    await login(PASSWORD, '+237677123001');
    const res = await login(PASSWORD, '+237677123002');
    expect(res.status).toBe(429);
    expect(JSON.stringify(res.body)).not.toContain('123002');
  });

  it('a limit hit queues nothing even for a registered number', async () => {
    await person();
    cfg.limit = 1;
    await login(PASSWORD, '+237677123001');
    const res = await login(PASSWORD);
    expect(res.status).toBe(429);
    expect(jobs).toHaveLength(0);
  });
});
