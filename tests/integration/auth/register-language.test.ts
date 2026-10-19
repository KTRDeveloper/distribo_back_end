import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: () => Promise.resolve(),
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { hashOtp } = await import('../../../src/lib/otp.js');
const { newId } = await import('../../../src/shared/ids.js');

const PHONE = '+237677123461';
const CODE = '123456';
const PASSWORD = 'correct horse battery';
const device = { platform: 'ANDROID', app_version: '1.0.0' };
const valid = {
  phone_number: PHONE,
  code: CODE,
  full_name: 'Béatrice Ngono',
  password: PASSWORD,
  device,
};
const post = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/auth/register').send(body);
const count = () => prisma.person.count({ where: { phoneNumber: PHONE } });
const row = () => prisma.person.findFirstOrThrow({ where: { phoneNumber: PHONE } });

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
async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM refresh_tokens WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM devices WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number = ${PHONE}`;
}
beforeEach(clean);
afterAll(clean);

describe('register with preferred_language', () => {
  it.each([
    ['EN', 'EN'],
    ['FR', 'FR'],
    [undefined, null],
  ])('language stored: sent %s -> stored %s', async (sent, stored) => {
    await seedCode();
    const res = await post(sent === undefined ? valid : { ...valid, preferred_language: sent });
    expect(res.status).toBe(201);
    expect((await row()).preferredLanguage).toBe(stored);
  });

  it('guest completed', async () => {
    const id = newId();
    await prisma.person.create({ data: { id, phoneNumber: PHONE } });
    await seedCode();
    const res = await post({ ...valid, preferred_language: 'EN' });
    expect(res.status).toBe(201);
    const r = await row();
    expect(r.id).toBe(id);
    expect(r.registeredAt).not.toBeNull();
    expect(r.preferredLanguage).toBe('EN');
    expect(await count()).toBe(1);
  });

  it.each([['fr'], ['DE'], [''], ['x'.repeat(1000)]])(
    'invalid language %s is refused',
    async (value) => {
      await seedCode();
      const res = await post({ ...valid, preferred_language: value });
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
      expect(await count()).toBe(0);
    }
  );

  it('weak password keeps the code', async () => {
    await seedCode();
    const weak = await post({ ...valid, password: '1234567', preferred_language: 'FR' });
    expect(weak.status).toBe(400);
    expect((weak.body as { error: { code: string } }).error.code).toBe('WEAK_PASSWORD');
    const ok = await post({ ...valid, preferred_language: 'FR' });
    expect(ok.status).toBe(201);
  });

  it('free text is refused and nothing is stored (AB-1)', async () => {
    await seedCode();
    const res = await post({ ...valid, preferred_language: '<script>alert(1)</script>' });
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it('a guest language is kept when the field is absent (regression guard)', async () => {
    await prisma.person.create({
      data: { id: newId(), phoneNumber: PHONE, preferredLanguage: 'EN' },
    });
    await seedCode();
    const res = await post(valid);
    expect(res.status).toBe(201);
    expect((await row()).preferredLanguage).toBe('EN');
  });
});
