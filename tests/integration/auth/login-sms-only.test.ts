import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const jobs: { to: string; channel: string }[] = [];
vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
  getCount: () => Promise.resolve(0),
  resetKey: () => Promise.resolve(),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: { to: string; channel: string }) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { hashPassword } = await import('../../../src/lib/password.js');
const { hashOtp } = await import('../../../src/lib/otp.js');

const PHONE = '+237677126661';
const EMAIL = 'sms.only@example.com';
const PASSWORD = 'correct horse battery';
const CODE = '123456';
const device = { platform: 'ANDROID', model: 'Tecno Spark', app_version: '1.0.0' } as const;

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number = ${PHONE}`;
}
const person = async () =>
  prisma.person.create({
    data: {
      id: newId(),
      phoneNumber: PHONE,
      fullName: 'Béatrice Ngono',
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
      email: EMAIL,
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(PASSWORD),
    },
  });
const login = (body: object) => request(app).post('/api/v1/auth/login').send(body);
const verify = (body: object) => request(app).post('/api/v1/auth/login/verify').send(body);
const errCode = (res: { body: unknown }) => (res.body as { error?: { code: string } }).error?.code;

beforeEach(async () => {
  jobs.length = 0;
  await clean();
});
afterAll(clean);

describe('login is SMS only', () => {
  it('email code refused', async () => {
    await person();
    const res = await login({ phone_number: PHONE, password: PASSWORD, use_email: true });
    expect(res.status).toBe(400);
    expect(errCode(res)).toBe('VALIDATION_ERROR');
    expect(jobs).toHaveLength(0);
    expect(await prisma.otpChallenge.count()).toBe(0);
  });

  it('email sign-in refused', async () => {
    await person();
    const res = await login({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(400);
    expect(errCode(res)).toBe('VALIDATION_ERROR');
    expect(jobs).toHaveLength(0);
  });

  it.each([
    ['email', { email: EMAIL }],
    ['use_email', { phone_number: PHONE, use_email: true }],
    ['email and phone', { phone_number: PHONE, email: EMAIL }],
  ])('verify refused: %s', async (_n, extra) => {
    const p = await person();
    await prisma.otpChallenge.create({
      data: {
        id: newId(),
        personId: p.id,
        target: PHONE,
        purpose: 'LOGIN',
        channel: 'SMS',
        codeHash: await hashOtp(CODE),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    const res = await verify({ code: CODE, device, ...extra });
    expect(res.status).toBe(400);
    expect(errCode(res)).toBe('VALIDATION_ERROR');
    expect(await prisma.device.count({ where: { personId: p.id } })).toBe(0);
  });

  it('sms still works', async () => {
    const p = await person();
    const res = await login({ phone_number: PHONE, password: PASSWORD });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ sent: true, channel: 'SMS', expires_in: 600 });
    expect(jobs).toEqual([expect.objectContaining({ to: PHONE, channel: 'SMS' })]);
    const row = await prisma.otpChallenge.findFirstOrThrow({ where: { personId: p.id } });
    await prisma.otpChallenge.update({
      where: { id: row.id },
      data: { codeHash: await hashOtp(CODE) },
    });
    const v = await verify({ phone_number: PHONE, code: CODE, device });
    expect(v.status).toBe(200);
    expect((v.body as { access_token: string }).access_token).toBeTruthy();
  });

  it('email bypass', async () => {
    await person();
    const res = await login({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(400);
    expect(jobs).toHaveLength(0);
    expect(await prisma.otpChallenge.count()).toBe(0);
  });
});
