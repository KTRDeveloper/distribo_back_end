import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const enqueue = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const hook = vi.hoisted(() => ({ calls: [] as string[], fail: false }));

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({ enqueueOtpDelivery: enqueue }));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { hashOtp } = await import('../../../src/lib/otp.js');
const { newId } = await import('../../../src/shared/ids.js');
const { registerPhoneReleasedHandler } = await import(
  '../../../src/modules/person/phone-released.js'
);

registerPhoneReleasedHandler((event) => {
  hook.calls.push(event.phoneNumber);
  if (hook.fail) return Promise.reject(new Error('handler failed'));
  return Promise.resolve();
});

const PHONE = '+237677125456';
const CODE = '123456';
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const valid = {
  phone_number: PHONE,
  code: CODE,
  full_name: 'Nouveau Titulaire',
  password: 'correct horse battery',
  device: { platform: 'ANDROID', app_version: '1.0.0' },
  new_holder: true,
};
const post = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/auth/register').send(body);

async function seedCode() {
  await prisma.otpChallenge.create({
    data: {
      id: newId(),
      target: PHONE,
      purpose: 'REGISTRATION',
      channel: 'SMS',
      codeHash: await hashOtp(CODE),
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
}
async function seedHolder(
  opts: { status?: 'ACTIVE' | 'SUSPENDED'; syncedDaysAgo?: number | null; guest?: boolean } = {}
) {
  const id = newId();
  await prisma.person.create({
    data: {
      id,
      phoneNumber: PHONE,
      ...(opts.guest
        ? {}
        : {
            fullName: 'Ancien Titulaire',
            passwordHash: '$argon2id$x',
            registeredAt: new Date(),
            phoneVerifiedAt: new Date(),
          }),
      status: opts.status ?? 'ACTIVE',
    },
  });
  if (opts.syncedDaysAgo !== null && opts.syncedDaysAgo !== undefined) {
    await prisma.device.create({
      data: {
        id: newId(),
        personId: id,
        platform: 'ANDROID',
        appVersion: '1.0.0',
        lastSyncedAt: ago(opts.syncedDaysAgo),
        createdAt: ago(opts.syncedDaysAgo + 30),
      },
    });
  }
  return id;
}
const people = `(SELECT id FROM people WHERE phone_number = '${PHONE}' OR released_phone_number = '${PHONE}')`;
async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRawUnsafe(`DELETE FROM notifications WHERE recipient_id IN ${people}`);
  await prisma.$executeRawUnsafe(`DELETE FROM refresh_tokens WHERE person_id IN ${people}`);
  await prisma.$executeRawUnsafe(`DELETE FROM devices WHERE person_id IN ${people}`);
  await prisma.$executeRawUnsafe(
    `DELETE FROM people WHERE phone_number = '${PHONE}' OR released_phone_number = '${PHONE}'`
  );
}
beforeEach(async () => {
  hook.calls = [];
  hook.fail = false;
  enqueue.mockClear();
  await clean();
});
afterAll(clean);

const codeUnspent = async () =>
  (await prisma.otpChallenge.findFirstOrThrow({ where: { target: PHONE } })).consumedAt === null;
const errCode = (res: { body: unknown }) => (res.body as { error: { code: string } }).error.code;

describe('registering on a recycled number re-checks the old holder', () => {
  it('idle holder released', async () => {
    const old = await seedHolder({ syncedDaysAgo: 7 * 30 });
    await seedCode();
    const res = await post(valid);
    expect(res.status).toBe(201);
    const row = await prisma.person.findUniqueOrThrow({ where: { id: old } });
    expect(row.phoneNumber).toBeNull();
    expect(row.releasedPhoneNumber).toBe(PHONE);
    expect(hook.calls).toEqual([PHONE]);
  });

  it.each([
    ['active, last synchronization 5 months ago', 'ACTIVE', 5 * 30],
    ['suspended, last synchronization 2 years ago', 'SUSPENDED', 2 * 365],
  ] as const)('refused: %s', async (_label, status, days) => {
    const old = await seedHolder({ status, syncedDaysAgo: days });
    await seedCode();
    const res = await post(valid);
    expect(res.status).toBe(409);
    expect(errCode(res)).toBe('NUMBER_NOT_AVAILABLE');
    const row = await prisma.person.findUniqueOrThrow({ where: { id: old } });
    expect(row.phoneNumber).toBe(PHONE);
    expect(row.releasedPhoneNumber).toBeNull();
    expect(await codeUnspent()).toBe(true);
    expect(hook.calls).toEqual([]);
    expect(await prisma.person.count({ where: { fullName: 'Nouveau Titulaire' } })).toBe(0);
  });

  it('handler fails: the release is undone', async () => {
    const old = await seedHolder({ syncedDaysAgo: 400 });
    await seedCode();
    hook.fail = true;
    const res = await post(valid);
    expect(res.status).toBe(500);
    const row = await prisma.person.findUniqueOrThrow({ where: { id: old } });
    expect(row.phoneNumber).toBe(PHONE);
    expect(row.releasedPhoneNumber).toBeNull();
    expect(row.scopeVersion).toBe(0);
    expect(await prisma.person.count({ where: { fullName: 'Nouveau Titulaire' } })).toBe(0);
    expect(await prisma.notification.count({ where: { recipientId: old } })).toBe(0);
  });

  it('no holder: unknown number', async () => {
    await seedCode();
    expect((await post(valid)).status).toBe(201);
    expect(hook.calls).toEqual([]);
  });

  it('no holder: guest number', async () => {
    await seedHolder({ guest: true });
    await seedCode();
    expect((await post(valid)).status).toBe(201);
    expect(hook.calls).toEqual([]);
  });

  it('stale code: the holder synchronizes after the code was issued', async () => {
    const old = await seedHolder({ syncedDaysAgo: 400 });
    await seedCode();
    await prisma.device.updateMany({ where: { personId: old }, data: { lastSyncedAt: new Date() } });
    const res = await post(valid);
    expect(res.status).toBe(409);
    expect(errCode(res)).toBe('NUMBER_NOT_AVAILABLE');
    const row = await prisma.person.findUniqueOrThrow({ where: { id: old } });
    expect(row.phoneNumber).toBe(PHONE);
    expect(hook.calls).toEqual([]);
  });

  it('a wrong code is answered OTP_INVALID, not the holder state', async () => {
    await seedHolder({ syncedDaysAgo: 10 });
    await seedCode();
    const res = await post({ ...valid, code: '000000' });
    expect(res.status).toBe(400);
    expect(errCode(res)).toBe('OTP_INVALID');
  });

  it('without new_holder a registered holder still answers ACCOUNT_EXISTS', async () => {
    await seedHolder({ syncedDaysAgo: 400 });
    await seedCode();
    const res = await post({ ...valid, new_holder: false });
    expect(res.status).toBe(409);
    expect(errCode(res)).toBe('ACCOUNT_EXISTS');
    expect(hook.calls).toEqual([]);
  });
});
