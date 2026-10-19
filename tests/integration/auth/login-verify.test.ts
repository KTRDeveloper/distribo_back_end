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
const { logger } = await import('../../../src/lib/logger.js');
const info = vi.spyOn(logger, 'info');
const { newId } = await import('../../../src/shared/ids.js');
const { hashOtp } = await import('../../../src/lib/otp.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const PHONE = '+237677124456';
const EMAIL = 'verify.login@example.com';
const CODE = '123456';
const device = { platform: 'ANDROID', model: 'Tecno Spark', app_version: '1.0.0' } as const;

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number = ${PHONE}`;
}
async function person(data: Record<string, unknown> = {}) {
  return prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: PHONE,
      fullName: 'Béatrice Ngono',
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
      email: EMAIL,
      emailVerifiedAt: new Date(),
      passwordHash: 'x',
      ...data,
    },
  });
}
async function challenge(
  personId: string,
  o: { purpose?: string; target?: string; expired?: boolean; consumed?: boolean } = {}
) {
  const target = o.target ?? PHONE;
  await prisma.otpChallenge.create({
    data: {
      id: newId(),
      personId,
      target,
      purpose: (o.purpose ?? 'LOGIN') as 'LOGIN',
      channel: target === PHONE ? 'SMS' : 'EMAIL',
      codeHash: await hashOtp(CODE),
      expiresAt: new Date(Date.now() + (o.expired ? -1000 : 600000)),
      ...(o.consumed ? { consumedAt: new Date() } : {}),
    },
  });
}
const verify = (extra: object = {}) =>
  request(app)
    .post('/api/v1/auth/login/verify')
    .send({ phone_number: PHONE, code: CODE, device, ...extra });
const devices = (id: string) => prisma.device.count({ where: { personId: id } });

beforeEach(async () => {
  info.mockClear();
  await clean();
});
afterAll(clean);

describe('login verify', () => {
  it('sign in', async () => {
    const p = await person();
    await challenge(p.id);
    const res = await verify();
    expect(res.status).toBe(200);
    const b = res.body as { access_token: string; refresh_token: string; token_type: string };
    expect(b.access_token).toBeTruthy();
    expect(b.refresh_token).toBeTruthy();
    expect(b.token_type).toBe('Bearer');
    expect(await devices(p.id)).toBe(1);
  });

  it('bad codes', async () => {
    const p = await person();
    await challenge(p.id);
    expect((await verify({ code: '000000' })).body).toMatchObject({
      error: { code: 'OTP_INVALID' },
    });
    await clean();
    const q = await person();
    await challenge(q.id, { expired: true });
    expect((await verify()).body).toMatchObject({ error: { code: 'OTP_EXPIRED' } });
    await clean();
    const r = await person();
    await challenge(r.id, { consumed: true });
    expect((await verify()).status).toBe(400);
    expect(await devices(r.id)).toBe(0);
  });

  it('alert', async () => {
    const p = await person();
    await issueSession(p.id, { ...device, model: 'Old A' });
    await issueSession(p.id, { ...device, model: 'Old B' });
    await challenge(p.id);
    const res = await verify({ device: { ...device, model: 'Pixel 9' } });
    expect(res.status).toBe(200);
    const rows = await prisma.notification.findMany({ where: { recipientId: p.id } });
    expect(rows).toHaveLength(2);
    for (const n of rows) {
      expect(n.sourceEvent).toBe('device.new_login');
      expect(n.content).toContain('Pixel 9');
    }
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login_succeeded', personId: p.id }),
      expect.any(String)
    );
  });

  it('first device', async () => {
    const p = await person();
    await challenge(p.id);
    await verify();
    expect(await prisma.notification.count({ where: { recipientId: p.id } })).toBe(0);
  });

  it('email channel', async () => {
    const p = await person();
    await challenge(p.id, { target: EMAIL });
    const res = await verify({ use_email: true });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(await devices(p.id)).toBe(0);
  });

  it('suspended', async () => {
    const p = await person({ status: 'SUSPENDED' });
    await challenge(p.id);
    const res = await verify();
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'ACCOUNT_SUSPENDED' } });
    expect(await devices(p.id)).toBe(0);
  });

  it('wrong purpose', async () => {
    const p = await person();
    await challenge(p.id, { purpose: 'REGISTRATION' });
    await challenge(p.id, { purpose: 'PASSWORD_RESET' });
    const res = await verify();
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'OTP_INVALID' } });
    expect(await devices(p.id)).toBe(0);
  });
});
