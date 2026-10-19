import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
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
  enqueueOtpDelivery: () => Promise.resolve(),
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { newId } = await import('../../../src/shared/ids.js');
const { hashOtp } = await import('../../../src/lib/otp.js');
const { hashPassword, verifyPassword } = await import('../../../src/lib/password.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');
const { logger } = await import('../../../src/lib/logger.js');

const PHONE = '+237677123480';
const OLD = 'old-password-correct-horse';
const NEW = 'brand-new-battery-staple';
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };
let personId = '';

async function clean() {
  await prisma.$executeRaw`DELETE FROM refresh_tokens WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM devices WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM otp_challenges WHERE target = ${PHONE}`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number = ${PHONE}`;
}
async function code(
  purpose: 'PASSWORD_RESET' | 'REGISTRATION' = 'PASSWORD_RESET',
  expiresAt = new Date(Date.now() + 600000)
) {
  await prisma.otpChallenge.create({
    data: {
      id: newId(),
      personId,
      target: PHONE,
      purpose,
      channel: 'SMS',
      codeHash: await hashOtp('123456'),
      expiresAt,
    },
  });
}
beforeEach(async () => {
  store.clear();
  await clean();
  personId = newId();
  await prisma.person.create({
    data: {
      id: personId,
      phoneNumber: PHONE,
      fullName: 'Reset Person',
      registeredAt: new Date(),
      passwordHash: await hashPassword(OLD),
      phoneVerifiedAt: new Date(),
    },
  });
});
afterAll(clean);

const confirm = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/auth/password-reset/confirm').send(body);
const good = { phone_number: PHONE, code: '123456', new_password: NEW, device: dev };
const hashNow = async () =>
  (await prisma.person.findUniqueOrThrow({ where: { id: personId } })).passwordHash ?? '';
const errCode = (b: unknown) => (b as { error: { code: string } }).error.code;

describe('password reset confirm', () => {
  it('reset', async () => {
    await code();
    const res = await confirm(good);
    expect(res.status).toBe(200);
    expect(await verifyPassword(await hashNow(), NEW)).toBe(true);
    expect(await verifyPassword(await hashNow(), OLD)).toBe(false);
  });

  it('sessions end', async () => {
    const a = await issueSession(personId, dev);
    const b = await issueSession(personId, dev);
    await code();
    expect((await confirm(good)).status).toBe(200);
    for (const s of [a, b]) {
      const t = await prisma.refreshToken.findMany({ where: { deviceId: s.deviceId } });
      expect(t.length).toBeGreaterThan(0);
      expect(t.every((x) => x.revokedReason === 'PASSWORD_RESET')).toBe(true);
      expect(
        (await request(app).post('/api/v1/auth/refresh').send({ refresh_token: s.refreshToken }))
          .status
      ).toBe(401);
    }
  });

  it('refusals', async () => {
    const before = await hashNow();
    await code();
    let r = await confirm({ ...good, code: '000000' });
    expect([r.status, errCode(r.body)]).toEqual([400, 'OTP_INVALID']);

    await prisma.otpChallenge.deleteMany({ where: { target: PHONE } });
    await code('PASSWORD_RESET', new Date(Date.now() - 1000));
    r = await confirm(good);
    expect([r.status, errCode(r.body)]).toEqual([400, 'OTP_EXPIRED']);

    await prisma.otpChallenge.deleteMany({ where: { target: PHONE } });
    await code('REGISTRATION');
    r = await confirm(good);
    expect([r.status, errCode(r.body)]).toEqual([400, 'OTP_INVALID']);

    await code();
    r = await confirm({ ...good, new_password: '1234567' });
    expect([r.status, errCode(r.body)]).toEqual([400, 'WEAK_PASSWORD']);

    r = await confirm({ ...good, phone_number: '+237677123481' });
    expect([r.status, errCode(r.body)]).toEqual([400, 'OTP_INVALID']);
    expect(await hashNow()).toBe(before);
  });

  it('weak keeps code', async () => {
    await code();
    expect((await confirm({ ...good, new_password: '1234567' })).status).toBe(400);
    expect((await confirm(good)).status).toBe(200);
  });

  it('lock cleared', async () => {
    store.set(`login:fail:${PHONE}`, 5);
    await code();
    expect((await confirm(good)).status).toBe(200);
    expect(store.get(`login:fail:${PHONE}`) ?? 0).toBe(0);
  });

  it('no code', async () => {
    const before = await hashNow();
    await code();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await confirm({ ...good, code: '999999' })).status);
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses[5]).toBe(429);
    expect((await confirm(good)).status).toBe(429);
    expect((await confirm({ ...good, code: undefined })).status).toBe(400);
    expect(await hashNow()).toBe(before);
  });

  it('no secrets in logs', async () => {
    const lines: string[] = [];
    const grab = (...a: unknown[]) => lines.push(JSON.stringify(a));
    const spies = (['info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(logger, m).mockImplementation(grab as never)
    );
    await code();
    await confirm({ ...good, code: '000000' });
    await confirm(good);
    spies.forEach((s) => s.mockRestore());
    const all = lines.join('\n');
    expect(all).not.toContain(NEW);
    expect(all).not.toContain('123456');
    expect(all).not.toContain('000000');
  });
});
