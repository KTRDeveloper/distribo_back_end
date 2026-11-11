import request from 'supertest';
import { generateSync } from 'otplib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../setup';

const store = new Map<string, number>();
const jobs: { to: string; message: string }[] = [];

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: (key: string, limit: number) => {
    const c = store.get(key) ?? 0;
    if (c >= limit) return Promise.resolve({ allowed: false, remaining: 0 });
    store.set(key, c + 1);
    return Promise.resolve({ allowed: true, remaining: limit - c - 1 });
  },
  getCount: (key: string) => Promise.resolve(store.get(key) ?? 0),
  secondsLeft: (_key: string, windowSeconds: number) => Promise.resolve(windowSeconds),
  resetKey: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: (d: { to: string; message: string }) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { createTotpSecret, decryptSecret, encryptSecret } = await import('../../../src/lib/totp.js');
const { seedAccount } = await import('../../helpers/database.js');
const { newId } = await import('../../../src/shared/ids.js');

const PASSWORD = 'fixture-admin-password-1';
const RECOVERY = 'secours@example.test';
const ALERT = "Ce n'était pas vous ? Bloquer";

type Body = { error?: { code: string }; otpauth_uri?: string; access_token?: string };

async function seedAdmin(
  opts: { role?: 'MODERATOR' | 'SUPER_ADMIN'; recovery?: boolean; admin?: boolean } = {}
) {
  const person = await seedAccount({
    email: `${newId()}@example.test`,
    password: PASSWORD,
    name: 'Fixture Admin',
  });
  const { secret } = createTotpSecret();
  const administratorId = newId();
  if (opts.admin !== false) {
    await prisma.administrator.create({
      data: {
        id: administratorId,
        personId: person.id,
        role: opts.role ?? 'MODERATOR',
        totpSecret: encryptSecret(secret),
        recoveryEmail: opts.recovery === false ? null : `${newId()}-${RECOVERY}`,
      },
    });
  }
  return { person, secret, administratorId };
}

const post = (path: 'request' | 'confirm', body: object) =>
  request(app).post(`/api/v1/admin/auth/totp-recovery/${path}`).send(body);
const codeSent = () => /(\d{6})/.exec(jobs[jobs.length - 1]?.message ?? '')?.[1] ?? '';
const wrongCode = () => (codeSent() === '000000' ? '111111' : '000000');
const errCode = (b: unknown) => (b as Body).error?.code;
const secretOf = async (administratorId: string) =>
  decryptSecret(
    (await prisma.administrator.findUniqueOrThrow({ where: { id: administratorId } })).totpSecret
  );
const totp = (secret: string) => generateSync({ secret });
const notificationsFor = (personId: string) =>
  prisma.notification.findMany({
    where: { recipientId: personId, sourceEvent: 'admin.totp_recovered' },
  });

beforeEach(() => {
  store.clear();
  jobs.length = 0;
});

describe('administrator authenticator recovery', () => {
  it('recovery: new secret works, the old one fails, the URI is returned (AC-1, CM-34)', async () => {
    const a = await seedAdmin();
    const admin = await prisma.administrator.findUniqueOrThrow({
      where: { id: a.administratorId },
    });

    const asked = await post('request', { phone_number: a.person.phoneNumber, password: PASSWORD });
    expect(asked.status).toBe(202);
    expect(jobs.at(-1)?.to).toBe(admin.recoveryEmail);
    const res = await post('confirm', {
      phone_number: a.person.phoneNumber,
      password: PASSWORD,
      code: codeSent(),
    });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body as object)).toEqual(['otpauth_uri']);
    const fresh = await secretOf(a.administratorId);
    expect(fresh).not.toBe(a.secret);
    expect((res.body as Body).otpauth_uri).toContain(fresh);
    expect((res.body as Body).otpauth_uri).toMatch(/^otpauth:\/\/totp\//);
    const login = (secret: string) =>
      request(app)
        .post('/api/v1/admin/auth/login')
        .send({ phone_number: a.person.phoneNumber, password: PASSWORD, totp_code: totp(secret) });
    expect((await login(a.secret)).status).toBe(401);
    expect((await login(fresh)).status).toBe(200);
  });

  it('trace and alerts: one journal row, one notification for the admin and each other super admin (AC-2, AB-2)', async () => {
    const a = await seedAdmin({ role: 'SUPER_ADMIN' });
    const otherSuper = await seedAdmin({ role: 'SUPER_ADMIN' });
    const moderator = await seedAdmin({ role: 'MODERATOR' });
    const removedSuper = await seedAdmin({ role: 'SUPER_ADMIN' });
    await prisma.administrator.update({
      where: { id: removedSuper.administratorId },
      data: { removedAt: new Date() },
    });

    await post('request', { phone_number: a.person.phoneNumber, password: PASSWORD });
    const res = await post('confirm', {
      phone_number: a.person.phoneNumber,
      password: PASSWORD,
      code: codeSent(),
    });

    expect(res.status).toBe(200);
    const rows = await prisma.adminAction.findMany({
      where: { action: 'RECOVER_2FA', targetPersonId: a.person.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      administratorId: a.administratorId,
      reason: 'totp recovery',
    });
    for (const p of [a.person, otherSuper.person]) {
      const notes = await notificationsFor(p.id);
      expect(notes).toHaveLength(1);
      expect(notes[0]?.content).toContain(ALERT);
    }
    expect(await notificationsFor(moderator.person.id)).toHaveLength(0);
    expect(await notificationsFor(removedSuper.person.id)).toHaveLength(0);
  });

  describe('nothing happens (AC-3, C-33)', () => {
    it('an administrator without a recovery email: 202 and no code', async () => {
      const a = await seedAdmin({ recovery: false });

      const res = await post('request', { phone_number: a.person.phoneNumber, password: PASSWORD });

      expect(res.status).toBe(202);
      expect(jobs).toHaveLength(0);
    });

    it('a person who is not an administrator: 202 and no code', async () => {
      const a = await seedAdmin({ admin: false });

      const res = await post('request', { phone_number: a.person.phoneNumber, password: PASSWORD });

      expect(res.status).toBe(202);
      expect(jobs).toHaveLength(0);
    });

    it('a wrong password: 401 INVALID_CREDENTIALS and no code', async () => {
      const a = await seedAdmin();

      const res = await post('request', {
        phone_number: a.person.phoneNumber,
        password: 'not-the-right-password',
      });

      expect(res.status).toBe(401);
      expect(errCode(res.body)).toBe('INVALID_CREDENTIALS');
      expect(jobs).toHaveLength(0);
    });

    it('an unknown number: 401 like a wrong password', async () => {
      const res = await post('request', { phone_number: '+237600000000', password: PASSWORD });

      expect(res.status).toBe(401);
      expect(jobs).toHaveLength(0);
    });

    it('a suspended administrator: 202 and no code', async () => {
      const a = await seedAdmin();
      await prisma.person.update({ where: { id: a.person.id }, data: { status: 'SUSPENDED' } });

      const res = await post('request', { phone_number: a.person.phoneNumber, password: PASSWORD });

      expect(res.status).toBe(202);
      expect(jobs).toHaveLength(0);
    });
  });

  it('no session: the confirm answer holds no token and sets no cookie (AC-4)', async () => {
    const a = await seedAdmin();
    await post('request', { phone_number: a.person.phoneNumber, password: PASSWORD });

    const res = await post('confirm', {
      phone_number: a.person.phoneNumber,
      password: PASSWORD,
      code: codeSent(),
    });

    expect(res.status).toBe(200);
    expect((res.body as Body).access_token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/token/);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  describe('bad code (AC-5)', () => {
    it('a wrong code: 400 OTP_INVALID and the secret is unchanged', async () => {
      const a = await seedAdmin();
      await post('request', { phone_number: a.person.phoneNumber, password: PASSWORD });

      const res = await post('confirm', {
        phone_number: a.person.phoneNumber,
        password: PASSWORD,
        code: wrongCode(),
      });

      expect(res.status).toBe(400);
      expect(errCode(res.body)).toBe('OTP_INVALID');
      expect(await secretOf(a.administratorId)).toBe(a.secret);
    });

    it('a reused code: 400 OTP_INVALID and the second secret never replaces the first', async () => {
      const a = await seedAdmin();
      await post('request', { phone_number: a.person.phoneNumber, password: PASSWORD });
      const code = codeSent();
      const body = { phone_number: a.person.phoneNumber, password: PASSWORD, code };
      expect((await post('confirm', body)).status).toBe(200);
      const afterFirst = await secretOf(a.administratorId);

      const res = await post('confirm', body);

      expect(res.status).toBe(400);
      expect(errCode(res.body)).toBe('OTP_INVALID');
      expect(await secretOf(a.administratorId)).toBe(afterFirst);
      expect(await prisma.adminAction.count({ where: { action: 'RECOVER_2FA' } })).toBe(1);
    });

    it('an expired code: 400 OTP_INVALID', async () => {
      const a = await seedAdmin();
      await post('request', { phone_number: a.person.phoneNumber, password: PASSWORD });
      await prisma.$executeRaw`UPDATE otp_challenges SET expires_at = now() - interval '1 minute'`;

      const res = await post('confirm', {
        phone_number: a.person.phoneNumber,
        password: PASSWORD,
        code: codeSent(),
      });

      expect(res.status).toBe(400);
      expect(errCode(res.body)).toBe('OTP_INVALID');
      expect(await secretOf(a.administratorId)).toBe(a.secret);
    });
  });

  describe('back door (AB-1, CWE-288)', () => {
    it('the password alone cannot confirm: no code was issued, the secret is unchanged', async () => {
      const a = await seedAdmin();

      const res = await post('confirm', {
        phone_number: a.person.phoneNumber,
        password: PASSWORD,
        code: '123456',
      });

      expect(res.status).toBe(400);
      expect(errCode(res.body)).toBe('OTP_INVALID');
      expect(await secretOf(a.administratorId)).toBe(a.secret);
    });

    it('a right code with a wrong password: 401 and the secret is unchanged', async () => {
      const a = await seedAdmin();
      await post('request', { phone_number: a.person.phoneNumber, password: PASSWORD });

      const res = await post('confirm', {
        phone_number: a.person.phoneNumber,
        password: 'not-the-right-password',
        code: codeSent(),
      });

      expect(res.status).toBe(401);
      expect(await secretOf(a.administratorId)).toBe(a.secret);
      expect(await prisma.adminAction.count({ where: { action: 'RECOVER_2FA' } })).toBe(0);
    });

    it("another person's code cannot be used for this administrator", async () => {
      const a = await seedAdmin();
      const b = await seedAdmin();
      await post('request', { phone_number: b.person.phoneNumber, password: PASSWORD });
      const bRecovery = (
        await prisma.administrator.findUniqueOrThrow({ where: { id: b.administratorId } })
      ).recoveryEmail;
      await prisma.administrator.update({
        where: { id: a.administratorId },
        data: { recoveryEmail: bRecovery },
      });

      const res = await post('confirm', {
        phone_number: a.person.phoneNumber,
        password: PASSWORD,
        code: codeSent(),
      });

      expect(res.status).toBe(400);
      expect(await secretOf(a.administratorId)).toBe(a.secret);
    });

    it('after five failed attempts the account is locked: 429 LOGIN_LOCKED', async () => {
      const a = await seedAdmin();
      for (let i = 0; i < 5; i += 1) {
        await post('request', { phone_number: a.person.phoneNumber, password: 'wrong-password-x' });
      }

      const res = await post('request', { phone_number: a.person.phoneNumber, password: PASSWORD });

      expect(res.status).toBe(429);
      expect(errCode(res.body)).toBe('LOGIN_LOCKED');
      expect(jobs).toHaveLength(0);
    });
  });

  it('unknown fields are refused: 400 VALIDATION_ERROR', async () => {
    const res = await post('request', {
      phone_number: '+237600000000',
      password: PASSWORD,
      role: 'SUPER_ADMIN',
    });

    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe('VALIDATION_ERROR');
  });
});
