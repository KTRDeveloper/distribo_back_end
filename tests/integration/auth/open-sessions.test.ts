import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const { newId } = await import('../../../src/shared/ids.js');
const { hashOtp } = await import('../../../src/lib/otp.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const PHONE = '+237677124461';
const OTHER_PHONE = '+237677124462';
const CODE = '123456';
const ANDROID_ID = 'a1b2c3d4';
const device = { platform: 'ANDROID', model: 'Tecno Spark', app_version: '1.0.0' } as const;

async function clean() {
  await prisma.$executeRaw`DELETE FROM notifications`;
  await prisma.$executeRaw`DELETE FROM refresh_tokens`;
  await prisma.$executeRaw`DELETE FROM devices`;
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
const expire = (deviceId: string) =>
  prisma.refreshToken.updateMany({
    where: { deviceId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
async function login(personId: string, extra: object = {}) {
  await prisma.otpChallenge.create({
    data: {
      id: newId(),
      personId,
      target: PHONE,
      purpose: 'LOGIN',
      channel: 'SMS',
      codeHash: await hashOtp(CODE),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  return request(app)
    .post('/api/v1/auth/login/verify')
    .send({ phone_number: PHONE, code: CODE, device: { ...device, ...extra } });
}
const alerted = async (personId: string) =>
  (await prisma.notification.findMany({ where: { recipientId: personId } })).map(
    (n) => n.relatedEntityId
  );
const list = async (accessToken: string) => {
  const r = await request(app)
    .get('/api/v1/auth/devices')
    .set({ Authorization: `Bearer ${accessToken}` });
  expect(r.status).toBe(200);
  return (r.body as { items: Array<{ id: string }> }).items.map((i) => i.id);
};

beforeEach(clean);
afterAll(clean);

describe('open sessions', () => {
  it('expired: an expired session leaves the list', async () => {
    const p = await person();
    const d1 = await issueSession(p.id, device);
    const d2 = await issueSession(p.id, device);
    const d3 = await issueSession(p.id, device);
    await expire(d2.deviceId);
    expect(await list(d3.accessToken)).toEqual([d3.deviceId, d1.deviceId]);
  });

  it('alert: the other open sessions are alerted, the expired one is not', async () => {
    const p = await person();
    const d1 = await issueSession(p.id, device);
    const d2 = await issueSession(p.id, device);
    await expire(d2.deviceId);
    expect((await login(p.id)).status).toBe(200);
    expect(await alerted(p.id)).toEqual([d1.deviceId]);
  });

  it('replaced: the replaced session gets no alert, the other one does', async () => {
    const p = await person();
    const d1 = await issueSession(p.id, device);
    const d3 = await issueSession(p.id, { ...device, android_id: ANDROID_ID });
    expect((await login(p.id, { android_id: ANDROID_ID })).status).toBe(200);
    expect(await alerted(p.id)).toEqual([d1.deviceId]);
    const old = await prisma.device.findUniqueOrThrow({ where: { id: d3.deviceId } });
    expect(old.revokedAt).not.toBeNull();
  });

  it('recognized phone: the new session is never alerted about itself', async () => {
    const p = await person();
    await issueSession(p.id, { ...device, android_id: ANDROID_ID });
    expect((await login(p.id, { android_id: ANDROID_ID })).status).toBe(200);
    expect(await alerted(p.id)).toEqual([]);
  });

  it('other person: no device of another person is listed or alerted', async () => {
    const p = await person();
    const q = await person(OTHER_PHONE);
    const qDev = await issueSession(q.id, device);
    const pDev = await issueSession(p.id, device);
    expect(await list(pDev.accessToken)).toEqual([pDev.deviceId]);
    expect((await login(p.id)).status).toBe(200);
    expect(await alerted(q.id)).toEqual([]);
    expect(await alerted(p.id)).toEqual([pDev.deviceId]);
    expect(qDev.deviceId).not.toBe(pDev.deviceId);
  });
});
