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
const { logger } = await import('../../../src/lib/logger.js');

const PHONE = '+237677123457';
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

async function seedCode(expiresAt = new Date(Date.now() + 600_000)) {
  await prisma.otpChallenge.create({
    data: {
      id: newId(),
      target: PHONE,
      purpose: 'REGISTRATION',
      channel: 'SMS',
      codeHash: await hashOtp(CODE),
      expiresAt,
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

describe('register', () => {
  it('new person', async () => {
    await seedCode();
    const res = await post(valid);
    expect(res.status).toBe(201);
    const b = res.body as Record<string, unknown> & { person: { id: string; full_name: string } };
    expect(b.token_type).toBe('Bearer');
    expect(typeof b.access_token).toBe('string');
    expect(typeof b.refresh_token).toBe('string');
    expect(b.person.full_name).toBe('Béatrice Ngono');
    const row = await prisma.person.findFirstOrThrow({ where: { phoneNumber: PHONE } });
    expect(row.id).toBe(b.person.id);
    expect(row.registeredAt).not.toBeNull();
    expect(row.phoneVerifiedAt).not.toBeNull();
    expect(row.passwordHash?.startsWith('$argon2id$')).toBe(true);
  });

  it('guest completed', async () => {
    const id = newId();
    await prisma.person.create({ data: { id, phoneNumber: PHONE } });
    await seedCode();
    const res = await post(valid);
    expect(res.status).toBe(201);
    expect((res.body as { person: { id: string } }).person.id).toBe(id);
    expect(await count()).toBe(1);
  });

  it('registered holder', async () => {
    const id = newId();
    await prisma.person.create({
      data: {
        id,
        phoneNumber: PHONE,
        fullName: 'Old Name',
        passwordHash: '$argon2id$x',
        registeredAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    });
    await seedCode();
    const res = await post(valid);
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('ACCOUNT_EXISTS');
    const row = await prisma.person.findUniqueOrThrow({ where: { id } });
    expect(row.fullName).toBe('Old Name');
    expect(row.passwordHash).toBe('$argon2id$x');
  });

  const refusals: [string, Record<string, unknown>, string, boolean][] = [
    ['wrong code', { code: '000000' }, 'OTP_INVALID', true],
    ['expired code', {}, 'OTP_EXPIRED', false],
    ['password 1234567', { password: '1234567' }, 'WEAK_PASSWORD', true],
    ['password 12345678', { password: '12345678' }, 'WEAK_PASSWORD', true],
    ['empty name', { full_name: '' }, 'VALIDATION_ERROR', true],
    ['101 char name', { full_name: 'a'.repeat(101) }, 'VALIDATION_ERROR', true],
    ['platform WINDOWS', { device: { ...device, platform: 'WINDOWS' } }, 'VALIDATION_ERROR', true],
  ];
  it.each(refusals)('refuses %s', async (_n, over, errCode, fresh) => {
    await seedCode(fresh ? undefined : new Date(Date.now() - 1000));
    const res = await post({ ...valid, ...over });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(errCode);
    expect(await count()).toBe(0);
  });

  it('wrong owner: no code, no person', async () => {
    const res = await post(valid);
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it.each(['id', 'status', 'registered_at', 'scope_version'])('rejects %s', async (field) => {
    await seedCode();
    const res = await post({ ...valid, [field]: 'x' });
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it('no secrets in logs', async () => {
    const spies = (['info', 'warn', 'error', 'debug'] as const).map((l) => vi.spyOn(logger, l));
    await seedCode();
    await post(valid);
    await post({ ...valid, code: '999999' });
    const out = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(out).not.toContain(PASSWORD);
    expect(out).not.toContain(CODE);
    spies.forEach((s) => s.mockRestore());
  });
});
