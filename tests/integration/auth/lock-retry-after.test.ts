import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

// Same atomic counter as the Redis script, plus an expiry per key so a lock can be shortened
// by moving the key's end time instead of waiting.
const store = new Map<string, { count: number; expiresAt: number }>();
const live = (key: string) => {
  const e = store.get(key);
  if (e && e.expiresAt <= Date.now()) store.delete(key);
  return store.get(key);
};
vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number, windowSeconds: number) => {
    const c = live(key)?.count ?? 0;
    if (c >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    store.set(key, { count: c + 1, expiresAt: Date.now() + windowSeconds * 1000 });
    return Promise.resolve({ allowed: true, remaining: limit - c - 1 });
  },
  getCount: (key: string) => Promise.resolve(live(key)?.count ?? 0),
  secondsLeft: (key: string, windowSeconds: number) => {
    const e = live(key);
    return Promise.resolve(
      e ? Math.max(1, Math.ceil((e.expiresAt - Date.now()) / 1000)) : windowSeconds
    );
  },
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
const { hashPassword } = await import('../../../src/lib/password.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const PHONE = '+237677123495';
const PASSWORD = 'old-password-correct-horse';
const WRONG = 'wrong-wrong-wrong';
const NEW = 'brand-new-battery-staple';
const dev = { platform: 'ANDROID' as const, app_version: '1.0.0' };
const LOGIN_KEY = `login:fail:${PHONE}`;
let personId = '';

async function clean() {
  await prisma.$executeRaw`DELETE FROM refresh_tokens WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM devices WHERE person_id IN (SELECT id FROM people WHERE phone_number = ${PHONE})`;
  await prisma.$executeRaw`DELETE FROM otp_challenges WHERE target = ${PHONE}`;
  await prisma.$executeRaw`DELETE FROM people WHERE phone_number = ${PHONE}`;
}
beforeEach(async () => {
  store.clear();
  await clean();
  personId = newId();
  await prisma.person.create({
    data: {
      id: personId,
      fullName: 'Lock Header',
      phoneNumber: PHONE,
      registeredAt: new Date(),
      phoneVerifiedAt: new Date(),
      passwordHash: await hashPassword(PASSWORD),
    },
  });
});
afterAll(clean);

const login = (password: string) =>
  request(app).post('/api/v1/auth/login').send({ phone_number: PHONE, password });
const lockLogin = async () => {
  for (let i = 0; i < 5; i++) expect((await login(WRONG)).status).toBe(401);
};
const retryAfter = (res: { headers: Record<string, unknown> }) => Number(res.headers['retry-after']);
/** Moves the end of a lock `ms` closer, as if that time had passed. */
const age = (key: string, ms: number) => {
  const e = store.get(key);
  if (e) e.expiresAt -= ms;
};

describe('lock refusals carry Retry-After', () => {
  it('header: the 6th login is 429 LOGIN_LOCKED with Retry-After between 1 and 60', async () => {
    await lockLogin();
    const res = await login(WRONG);
    expect(res.status).toBe(429);
    expect((res.body as { error: { code: string } }).error.code).toBe('LOGIN_LOCKED');
    expect(retryAfter(res)).toBeGreaterThanOrEqual(1);
    expect(retryAfter(res)).toBeLessThanOrEqual(60);
  });

  it('falling: the right password is refused and Retry-After is lower after 2 seconds', async () => {
    await lockLogin();
    const first = await login(PASSWORD);
    expect(first.status).toBe(429);
    age(LOGIN_KEY, 2000);
    const second = await login(PASSWORD);
    expect(second.status).toBe(429);
    expect(retryAfter(second)).toBeLessThan(retryAfter(first));
  });

  it('after lock: the right password passes and the counter is back to zero', async () => {
    await lockLogin();
    age(LOGIN_KEY, 61_000);
    expect((await login(PASSWORD)).status).toBe(202);
    expect(store.has(LOGIN_KEY)).toBe(false);
  });

  it('sms reset: a locked number resets with the code and the new password passes at once', async () => {
    await lockLogin();
    await prisma.otpChallenge.create({
      data: {
        id: newId(),
        personId,
        target: PHONE,
        purpose: 'PASSWORD_RESET',
        channel: 'SMS',
        codeHash: await hashOtp('123456'),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    const reset = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({ phone_number: PHONE, code: '123456', new_password: NEW, device: dev });
    expect(reset.status).toBe(200);
    expect((await login(NEW)).status).toBe(202);
  });

  describe('other locks (AC-5)', () => {
    it('a password change', async () => {
      const s = await issueSession(personId, dev);
      const change = () =>
        request(app)
          .post('/api/v1/auth/password/change')
          .set('Authorization', `Bearer ${s.accessToken}`)
          .send({ current_password: WRONG, new_password: NEW });
      for (let i = 0; i < 5; i++) expect((await change()).status).toBe(401);
      const res = await change();
      expect(res.status).toBe(429);
      expect((res.body as { error: { code: string } }).error.code).toBe('LOGIN_LOCKED');
      expect(retryAfter(res)).toBeGreaterThanOrEqual(1);
      expect(retryAfter(res)).toBeLessThanOrEqual(60);
    });

    it('an account deletion', async () => {
      const s = await issueSession(personId, dev);
      const del = () =>
        request(app)
          .delete('/api/v1/users/me')
          .set('Authorization', `Bearer ${s.accessToken}`)
          .send({ password: WRONG });
      for (let i = 0; i < 5; i++) expect((await del()).status).toBe(401);
      const res = await del();
      expect(res.status).toBe(429);
      expect((res.body as { error: { code: string } }).error.code).toBe('LOGIN_LOCKED');
      expect(retryAfter(res)).toBeGreaterThanOrEqual(1);
      expect(retryAfter(res)).toBeLessThanOrEqual(60);
    });

    it('an admin login', async () => {
      const adminLogin = () =>
        request(app)
          .post('/api/v1/admin/auth/login')
          .send({ phone_number: PHONE, password: WRONG, totp_code: '000000' });
      for (let i = 0; i < 5; i++) expect((await adminLogin()).status).toBe(401);
      const res = await adminLogin();
      expect(res.status).toBe(429);
      expect((res.body as { error: { code: string } }).error.code).toBe('LOGIN_LOCKED');
      expect(retryAfter(res)).toBeGreaterThanOrEqual(1);
      expect(retryAfter(res)).toBeLessThanOrEqual(60);
    });
  });

  it('hammering: 20 more tries never extend the lock', async () => {
    await lockLogin();
    const first = retryAfter(await login(WRONG));
    for (let i = 0; i < 20; i++) {
      const res = await login(i % 2 ? PASSWORD : WRONG);
      expect(res.status).toBe(429);
      expect(retryAfter(res)).toBeLessThanOrEqual(first);
    }
    expect(first).toBeLessThanOrEqual(60);
  });
});
