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

const PHONE = '+237677125551';
const EMAIL = 'released.holder@example.com';
const PASSWORD = 'correct horse battery';
const device = { platform: 'ANDROID', model: 'Tecno Spark', app_version: '1.0.0' } as const;

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM people WHERE email = ${EMAIL} OR phone_number = ${PHONE}`;
}
async function person(data: Record<string, unknown> = {}) {
  return prisma.person.create({
    data: {
      id: newId(),
      releasedPhoneNumber: PHONE,
      fullName: 'Béatrice Ngono',
      registeredAt: new Date(),
      email: EMAIL,
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(PASSWORD),
      ...data,
    },
  });
}
const login = (body: object) => request(app).post('/api/v1/auth/login').send(body);
const errCode = (res: { body: unknown }) => (res.body as { error?: { code: string } }).error?.code;

beforeEach(async () => {
  jobs.length = 0;
  await clean();
});
afterAll(clean);

describe('login by email is gone', () => {
  it.each([
    ['unverified', { emailVerifiedAt: null }, EMAIL, PASSWORD],
    [
      'active number',
      { phoneNumber: PHONE, phoneVerifiedAt: new Date(), releasedPhoneNumber: null },
      EMAIL,
      PASSWORD,
    ],
    ['unknown', {}, 'nobody@example.com', PASSWORD],
    ['wrong password', {}, EMAIL, 'wrong password here'],
    ['right credentials', {}, EMAIL, PASSWORD],
    ['upper case', {}, EMAIL.toUpperCase(), PASSWORD],
  ])('email sign-in refused: %s', async (_n, data, email, password) => {
    await person(data);
    const res = await login({ email, password });
    expect(res.status).toBe(400);
    expect(errCode(res)).toBe('VALIDATION_ERROR');
    expect(jobs).toHaveLength(0);
    expect(await prisma.otpChallenge.count()).toBe(0);
  });

  it('one identifier', async () => {
    await person();
    for (const body of [
      { email: EMAIL, phone_number: PHONE, password: PASSWORD },
      { password: PASSWORD },
    ]) {
      const res = await login(body);
      expect(res.status).toBe(400);
      expect(errCode(res)).toBe('VALIDATION_ERROR');
    }
    const v = await request(app)
      .post('/api/v1/auth/login/verify')
      .send({ email: EMAIL, phone_number: PHONE, code: '123456', device });
    expect(v.status).toBe(400);
  });
});
