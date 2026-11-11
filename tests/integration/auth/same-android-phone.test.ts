import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
  getCount: () => Promise.resolve(0),
  resetKey: () => Promise.resolve(),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: () => Promise.resolve(),
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));
const { app } = await import('../../../src/app.js');
const { logger } = await import('../../../src/lib/logger.js');
const { newId } = await import('../../../src/shared/ids.js');
const { hashOtp } = await import('../../../src/lib/otp.js');
const { hashAndroidId } = await import('../../../src/lib/android-id.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const PHONE = '+237677124457';
const OTHER_PHONE = '+237677124458';
const CODE = '123456';
const ANDROID_ID = 'a1b2c3d4';
const device = { platform: 'ANDROID', model: 'Tecno Spark', app_version: '1.0.0' } as const;

const spies = (['info', 'warn', 'error', 'debug'] as const).map((l) => vi.spyOn(logger, l));

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number IN (${PHONE}, ${OTHER_PHONE})`;
}
async function person(phone = PHONE) {
  return prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: phone,
      fullName: 'Béatrice Ngono',
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
      passwordHash: 'x',
    },
  });
}
async function challenge(personId: string, phone = PHONE) {
  await prisma.otpChallenge.create({
    data: {
      id: newId(),
      personId,
      target: phone,
      purpose: 'LOGIN',
      channel: 'SMS',
      codeHash: await hashOtp(CODE),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
}
const verify = (deviceExtra: object, phone = PHONE) =>
  request(app)
    .post('/api/v1/auth/login/verify')
    .send({ phone_number: phone, code: CODE, device: { ...device, ...deviceExtra } });
const openDevices = (personId: string) =>
  prisma.device.findMany({ where: { personId, revokedAt: null } });

beforeEach(async () => {
  spies.forEach((s) => s.mockClear());
  await clean();
});

describe('a new login on the same Android phone', () => {
  it('replace: the old device is revoked, its token REPLACED, one open device', async () => {
    const p = await person();
    const old = await issueSession(p.id, { ...device, android_id: ANDROID_ID });
    await challenge(p.id);
    const res = await verify({ android_id: ANDROID_ID });
    expect(res.status).toBe(200);
    const oldDevice = await prisma.device.findUniqueOrThrow({ where: { id: old.deviceId } });
    expect(oldDevice.revokedAt).not.toBeNull();
    const tokens = await prisma.refreshToken.findMany({ where: { deviceId: old.deviceId } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].revokedAt).not.toBeNull();
    expect(tokens[0].revokedReason).toBe('REPLACED');
    const open = await openDevices(p.id);
    expect(open).toHaveLength(1);
    expect(open[0].id).not.toBe(old.deviceId);
    expect(open[0].androidIdHash).toBe(hashAndroidId(p.id, ANDROID_ID));
  });

  it('expired old: the device with an expired refresh token is revoked too', async () => {
    const p = await person();
    const old = await issueSession(p.id, { ...device, android_id: ANDROID_ID });
    await prisma.refreshToken.updateMany({
      where: { deviceId: old.deviceId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await challenge(p.id);
    expect((await verify({ android_id: ANDROID_ID })).status).toBe(200);
    const oldDevice = await prisma.device.findUniqueOrThrow({ where: { id: old.deviceId } });
    expect(oldDevice.revokedAt).not.toBeNull();
    expect(await openDevices(p.id)).toHaveLength(1);
  });

  it('no id: nothing is revoked, with no android_id or an old device without a fingerprint', async () => {
    const p = await person();
    const noHash = await issueSession(p.id, device);
    const hashed = await issueSession(p.id, { ...device, android_id: ANDROID_ID });
    await challenge(p.id);
    expect((await verify({})).status).toBe(200);
    expect(await openDevices(p.id)).toHaveLength(3);
    await challenge(p.id);
    expect((await verify({ android_id: 'ffff' })).status).toBe(200);
    expect(await openDevices(p.id)).toHaveLength(4);
    for (const id of [noHash.deviceId, hashed.deviceId]) {
      const d = await prisma.device.findUniqueOrThrow({ where: { id } });
      expect(d.revokedAt).toBeNull();
    }
  });

  it.each([
    ['a1b2c3d4', 200],
    ['A1B2C3D4', 400],
    ['a1b2c3d4e5f607182', 400],
    ['', 400],
  ])('form: android_id %j gets %i', async (value, status) => {
    const p = await person();
    await challenge(p.id);
    expect((await verify({ android_id: value })).status).toBe(status);
  });

  it('crossed: the second login of the same phone gets 409 SESSION_CONFLICT, nothing written', async () => {
    const p = await person();
    const { prisma: db } = await import('../../../src/lib/db.js');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let firstWritten!: () => void;
    const written = new Promise<void>((r) => (firstWritten = r));
    const first = db.$transaction(async (tx) => {
      await issueSession(p.id, { ...device, android_id: ANDROID_ID }, tx);
      firstWritten();
      await gate;
    });
    await written;
    const second = issueSession(p.id, { ...device, android_id: ANDROID_ID }).then(
      () => null,
      (e: unknown) => e as { statusCode?: number; code?: string }
    );
    await new Promise((r) => setTimeout(r, 300));
    release();
    await first;
    const err = await second;
    expect(err).toMatchObject({ statusCode: 409, code: 'SESSION_CONFLICT' });
    expect(await openDevices(p.id)).toHaveLength(1);
    expect(await prisma.device.count({ where: { personId: p.id } })).toBe(1);
    expect(await prisma.refreshToken.count({ where: { personId: p.id } })).toBe(1);
  });

  it('other person: another account with the same android id keeps its session', async () => {
    const p = await person();
    const q = await person(OTHER_PHONE);
    const qSession = await issueSession(q.id, { ...device, android_id: ANDROID_ID });
    await challenge(p.id);
    expect((await verify({ android_id: ANDROID_ID })).status).toBe(200);
    const qDevice = await prisma.device.findUniqueOrThrow({ where: { id: qSession.deviceId } });
    expect(qDevice.revokedAt).toBeNull();
    const qTokens = await prisma.refreshToken.findMany({ where: { deviceId: qSession.deviceId } });
    expect(qTokens.every((t) => t.revokedAt === null)).toBe(true);
  });

  it('no raw id: absent from the answer, the logs and the devices row', async () => {
    const p = await person();
    await challenge(p.id);
    const res = await verify({ android_id: ANDROID_ID });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(ANDROID_ID);
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain(ANDROID_ID);
    const rows = await prisma.$queryRaw<unknown[]>`
      SELECT d.* FROM devices d WHERE d.person_id = ${p.id}::uuid`;
    expect(
      JSON.stringify(rows, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))
    ).not.toContain(ANDROID_ID);
  });
});
