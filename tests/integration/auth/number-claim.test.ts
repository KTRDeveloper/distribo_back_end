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
const { logger } = await import('../../../src/lib/logger.js');
const { claimRefusal } = await import('../../../src/modules/auth/number-claim.service.js');

const PHONE = '+237677124456';
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

type Body = { error?: { code: string; message: string } } & Record<string, unknown>;
const post = async (phone: string) => {
  const res = await request(app).post('/api/v1/auth/register/claim').send({ phone_number: phone });
  return { status: res.status, body: res.body as Body };
};

async function holder(
  opts: {
    status?: 'ACTIVE' | 'SUSPENDED';
    devices?: { synced: Date | null; created: Date; revoked?: boolean }[];
    phone?: string;
  } = {}
) {
  const id = newId();
  await prisma.person.create({
    data: {
      id,
      phoneNumber: opts.phone ?? PHONE,
      fullName: 'Béatrice Ngono',
      registeredAt: new Date(),
      passwordHash: 'x',
      phoneVerifiedAt: new Date(),
      status: opts.status ?? 'ACTIVE',
    },
  });
  for (const d of opts.devices ?? []) {
    await prisma.device.create({
      data: {
        id: newId(),
        personId: id,
        platform: 'ANDROID',
        appVersion: '1.0.0',
        lastSyncedAt: d.synced,
        createdAt: d.created,
        revokedAt: d.revoked ? new Date() : null,
      },
    });
  }
  return id;
}

const challenges = () =>
  prisma.$queryRaw<
    { person_id: string | null; purpose: string }[]
  >`SELECT person_id, purpose::text AS purpose FROM otp_challenges`;

async function clean() {
  await prisma.$executeRaw`DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM people WHERE phone_number LIKE '+237677124%')`;
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM devices WHERE person_id IN (SELECT id FROM people WHERE phone_number LIKE '+237677124%')`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number LIKE '+237677124%'`;
}
beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  cfg.limit = null;
  await clean();
});
afterAll(clean);

describe('number claim', () => {
  it('idle holder', async () => {
    await holder({ devices: [{ synced: ago(215), created: ago(400) }] });
    const res = await post(PHONE);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ sent: true, expires_in: 600 });
    const rows = await challenges();
    expect(rows).toEqual([{ person_id: null, purpose: 'REGISTRATION' }]);
    expect(jobs.map((j) => j.to)).toEqual([PHONE]);
  });

  it('a holder with no device is idle', async () => {
    await holder();
    expect((await post(PHONE)).status).toBe(202);
    expect(jobs).toHaveLength(1);
  });

  const refused: [string, Parameters<typeof holder>[0]][] = [
    ['active, synchronized 5 months ago', { devices: [{ synced: ago(150), created: ago(400) }] }],
    [
      'active, synchronized yesterday on a revoked device',
      { devices: [{ synced: ago(1), created: ago(400), revoked: true }] },
    ],
    [
      'suspended, synchronized 2 years ago',
      { status: 'SUSPENDED', devices: [{ synced: ago(730), created: ago(800) }] },
    ],
    [
      'active, device created 2 days ago, never synchronized',
      { devices: [{ synced: null, created: ago(2) }] },
    ],
  ];
  it.each(refused)('refused: %s', async (_name, opts) => {
    await holder(opts);
    const res = await post(PHONE);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'NUMBER_NOT_AVAILABLE' } });
    expect(await challenges()).toHaveLength(0);
    expect(jobs).toHaveLength(0);
  });

  it('the latest activity over all devices counts', async () => {
    await holder({
      devices: [
        { synced: ago(400), created: ago(500) },
        { synced: ago(10), created: ago(300), revoked: true },
      ],
    });
    expect((await post(PHONE)).status).toBe(409);
  });

  it('limits', async () => {
    cfg.limit = 2;
    expect((await post('+237677124401')).status).toBe(202);
    expect((await post('+237677124402')).status).toBe(202);
    const res = await post('+237677124403');
    expect(res.status).toBe(429);
    expect(res.body.error?.code).toBe('RATE_LIMITED');
    expect(jobs).toHaveLength(2);
  });

  it('a fourth code in an hour is refused', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 4; i++) {
      for (const k of [...store.keys()]) if (k.startsWith('otp:cooldown')) store.delete(k);
      const res = await post(PHONE);
      codes.push(res.status === 429 ? (res.body.error?.code ?? '') : String(res.status));
    }
    expect(codes).toEqual(['202', '202', '202', 'OTP_RATE_LIMITED']);
  });

  it('a refused claim still counts as a number check', async () => {
    cfg.limit = 1;
    await holder({ devices: [{ synced: ago(1), created: ago(10) }] });
    expect((await post(PHONE)).status).toBe(409);
    const res = await post(PHONE);
    expect(res.status).toBe(429);
    expect(res.body.error?.code).toBe('RATE_LIMITED');
  });

  it('no registered holder', async () => {
    const res = await post('+237677124499');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ sent: true, expires_in: 600 });
    expect(jobs).toHaveLength(1);
    expect(await challenges()).toEqual([{ person_id: null, purpose: 'REGISTRATION' }]);
  });

  it('a guest holder is treated as no registered holder', async () => {
    await prisma.$executeRaw`INSERT INTO people (id, phone_number, created_at, server_updated_at) VALUES (${newId()}::uuid, ${PHONE}, now(), now())`;
    expect((await post(PHONE)).status).toBe(202);
    expect(await challenges()).toEqual([{ person_id: null, purpose: 'REGISTRATION' }]);
  });

  it('rejects a foreign or malformed number and unknown fields', async () => {
    expect((await post('+33612345678')).body.error?.code).toBe('UNSUPPORTED_NUMBER');
    expect((await post('abc')).body.error?.code).toBe('VALIDATION_ERROR');
    const res = await request(app)
      .post('/api/v1/auth/register/claim')
      .send({ phone_number: PHONE, extra: 1 });
    expect(res.status).toBe(400);
  });

  it('logs the refusal with the holder id and the reason, never the number', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const id = await holder({ status: 'SUSPENDED' });
    await post(PHONE);
    const calls = warn.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const entry = calls.find((c) => c.event === 'number_claim_refused');
    expect(entry).toMatchObject({
      event: 'number_claim_refused',
      personId: id,
      reason: 'SUSPENDED',
    });
    expect(JSON.stringify(calls)).not.toContain(PHONE);
    warn.mockRestore();
  });
});

describe('claimRefusal boundary', () => {
  const setSynced = (id: string, at: string) =>
    prisma.device.updateMany({ where: { personId: id }, data: { lastSyncedAt: new Date(at) } });

  it('six calendar months back, UTC, to the millisecond', async () => {
    const now = new Date('2026-08-15T12:00:00.000Z');
    const id = await holder({ devices: [{ synced: null, created: ago(900) }] });
    await setSynced(id, '2026-02-15T11:59:59.999Z');
    expect(await claimRefusal({ id, status: 'ACTIVE' }, now)).toBeNull();
    await setSynced(id, '2026-02-15T12:00:00.001Z');
    expect(await claimRefusal({ id, status: 'ACTIVE' }, now)).toBe('RECENTLY_ACTIVE');
  });

  it('a month without the same day still gives a six month window', async () => {
    const now = new Date('2026-08-31T12:00:00.000Z');
    const id = await holder({ devices: [{ synced: null, created: ago(900) }] });
    await setSynced(id, '2026-02-27T12:00:00.000Z');
    expect(await claimRefusal({ id, status: 'ACTIVE' }, now)).toBeNull();
    await setSynced(id, '2026-03-04T12:00:00.000Z');
    expect(await claimRefusal({ id, status: 'ACTIVE' }, now)).toBe('RECENTLY_ACTIVE');
  });

  it('suspension wins over activity', async () => {
    const now = new Date('2026-08-15T12:00:00.000Z');
    expect(await claimRefusal({ id: newId(), status: 'SUSPENDED' }, now)).toBe('SUSPENDED');
  });
});

describe('security', () => {
  it('flooding a live number sends no code', async () => {
    await holder({ devices: [{ synced: ago(1), created: ago(100) }] });
    for (let i = 0; i < 100; i++) {
      store.clear();
      expect((await post(PHONE)).status).toBe(409);
    }
    expect(jobs).toHaveLength(0);
    expect(await challenges()).toHaveLength(0);
  });

  it('refusals are alike, suspended or active', async () => {
    const id = await holder({ devices: [{ synced: ago(1), created: ago(100) }] });
    const active = await post(PHONE);
    await prisma.person.update({ where: { id }, data: { status: 'SUSPENDED' } });
    store.clear();
    const suspended = await post(PHONE);
    const bare = (r: { status: number; body: Body }) => ({
      status: r.status,
      error: { ...r.body.error, requestId: undefined },
    });
    expect(bare(suspended)).toEqual(bare(active));
    expect(suspended.status).toBe(409);
  });
});
