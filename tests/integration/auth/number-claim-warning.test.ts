import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const clock = vi.hoisted(() => ({ offsetMs: 0 }));
const store = new Map<string, { count: number; expiresAt: number }>();
const windows: { key: string; limit: number; windowSeconds: number }[] = [];

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number, windowSeconds: number) => {
    windows.push({ key, limit, windowSeconds });
    const now = Date.now() + clock.offsetMs;
    const entry = store.get(key);
    const count = entry && entry.expiresAt > now ? entry.count : 0;
    if (count >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    store.set(key, { count: count + 1, expiresAt: now + windowSeconds * 1000 });
    return Promise.resolve({ allowed: true, remaining: limit - count - 1 });
  },
  getCount: () => Promise.resolve(0),
  resetKey: () => Promise.resolve(),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: () => Promise.resolve(),
}));

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { logger } = await import('../../../src/lib/logger.js');

const PHONE = '+237677125456';
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

const FR =
  "Quelqu'un indique détenir votre numéro. Si vous ne l'utilisez plus, changez-le dans votre profil.";
const EN =
  'Someone says they hold your number. If you no longer use it, change it in your profile.';

const post = async (phone = PHONE) => {
  const res = await request(app).post('/api/v1/auth/register/claim').send({ phone_number: phone });
  return { status: res.status, body: res.body as Record<string, unknown> };
};

async function holder(opts: {
  status?: 'ACTIVE' | 'SUSPENDED';
  language?: 'FR' | 'EN' | null;
  synced: Date;
}) {
  const id = newId();
  await prisma.person.create({
    data: {
      id,
      phoneNumber: PHONE,
      fullName: 'Béatrice Ngono',
      registeredAt: new Date(),
      passwordHash: 'x',
      phoneVerifiedAt: new Date(),
      status: opts.status ?? 'ACTIVE',
      preferredLanguage: opts.language ?? null,
    },
  });
  await prisma.device.create({
    data: {
      id: newId(),
      personId: id,
      platform: 'ANDROID',
      appVersion: '1.0.0',
      lastSyncedAt: opts.synced,
      createdAt: ago(400),
    },
  });
  return id;
}

const notices = (personId: string) =>
  prisma.$queryRaw<
    { source_event: string; content: string; read_status: string }[]
  >`SELECT source_event, content, read_status::text AS read_status FROM notifications WHERE recipient_id = ${personId}::uuid ORDER BY created_at`;

async function clean() {
  await prisma.$executeRaw`DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM people WHERE phone_number LIKE '+237677125%')`;
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM devices WHERE person_id IN (SELECT id FROM people WHERE phone_number LIKE '+237677125%')`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number LIKE '+237677125%'`;
}
beforeEach(async () => {
  store.clear();
  windows.length = 0;
  clock.offsetMs = 0;
  await clean();
});
afterAll(clean);

describe('holder warned', () => {
  it.each([
    ['FR', FR],
    ['EN', EN],
  ] as const)('language %s', async (language, text) => {
    const id = await holder({ language, synced: ago(1) });
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'NUMBER_NOT_AVAILABLE' } });
    const rows = await notices(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_event: 'phone.claimed',
      content: text,
      read_status: 'UNREAD',
    });
    expect(windows.find((w) => w.key === `phone-claimed:${id}`)).toMatchObject({
      limit: 1,
      windowSeconds: 86400,
    });
  });

  it('an empty language preference gives French', async () => {
    const id = await holder({ synced: ago(1) });
    await post();
    expect((await notices(id)).map((n) => n.content)).toEqual([FR]);
  });

  it('the claimant answer is the same whether or not the holder is warned', async () => {
    await holder({ synced: ago(1) });
    const first = await post();
    const second = await post();
    const bare = (r: typeof first) => ({
      status: r.status,
      error: { ...(r.body.error as object), requestId: undefined },
    });
    expect(bare(second)).toEqual(bare(first));
  });
});

describe('one a day', () => {
  it('3 claims give one notice, a claim after the window gives a second', async () => {
    const id = await holder({ synced: ago(1) });
    for (let i = 0; i < 3; i++) expect((await post()).status).toBe(409);
    expect(await notices(id)).toHaveLength(1);
    clock.offsetMs = DAY + 1000;
    expect((await post()).status).toBe(409);
    expect(await notices(id)).toHaveLength(2);
  });
});

describe('no warning', () => {
  it('suspended, synchronized yesterday', async () => {
    const id = await holder({ status: 'SUSPENDED', synced: ago(1) });
    expect((await post()).status).toBe(409);
    expect(await notices(id)).toHaveLength(0);
    expect(windows.some((w) => w.key.startsWith('phone-claimed:'))).toBe(false);
  });

  it('active, synchronized 7 months ago (claim allowed)', async () => {
    const id = await holder({ synced: ago(215) });
    expect((await post()).status).toBe(202);
    expect(await notices(id)).toHaveLength(0);
    expect(windows.some((w) => w.key.startsWith('phone-claimed:'))).toBe(false);
  });
});

describe('security', () => {
  it('100 claims bury the holder under at most one notice', async () => {
    const id = await holder({ synced: ago(1) });
    for (let i = 0; i < 100; i++) expect((await post()).status).toBe(409);
    expect(await notices(id)).toHaveLength(1);
  });

  it('the log carries the holder id and never the number', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const info = vi.spyOn(logger, 'info');
    const id = await holder({ synced: ago(1) });
    await post();
    const calls = [...warn.mock.calls, ...info.mock.calls].map((c) => c[0] as object);
    expect(JSON.stringify(calls)).not.toContain(PHONE);
    expect(JSON.stringify(calls)).toContain(id);
    warn.mockRestore();
    info.mockRestore();
  });
});
