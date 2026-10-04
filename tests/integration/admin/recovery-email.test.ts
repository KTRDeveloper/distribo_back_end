import request from 'supertest';
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
const { createTotpSecret, encryptSecret } = await import('../../../src/lib/totp.js');
const { signAccessToken, signAdminToken } = await import('../../../src/lib/jwt.js');
const { seedAccount } = await import('../../helpers/database.js');
const { newId } = await import('../../../src/shared/ids.js');

const OWN_EMAIL = 'moderateur@example.test';
const RECOVERY = 'secours@example.test';

type Body = { error?: { code: string } };

async function seedAdmin() {
  const person = await seedAccount({
    email: OWN_EMAIL.replace('@', `${newId().slice(-6)}@`),
    password: 'fixture-admin-password-1',
    name: 'Fixture Admin',
  });
  const administratorId = newId();
  await prisma.administrator.create({
    data: {
      id: administratorId,
      personId: person.id,
      role: 'MODERATOR',
      totpSecret: encryptSecret(createTotpSecret().secret),
    },
  });
  const token = signAdminToken({ personId: person.id, administratorId, role: 'MODERATOR' });
  return { person, administratorId, token };
}

const post = (path: string, token: string | null, body: object) => {
  const r = request(app).post(`/api/v1/admin/recovery-email/${path}`);
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body);
};
const codeSent = () => /(\d{6})/.exec(jobs[jobs.length - 1]?.message ?? '')?.[1] ?? '';
const wrongCode = () => (codeSent() === '000000' ? '111111' : '000000');
const errCode = (b: unknown) => (b as Body).error?.code;
const stored = async (administratorId: string) =>
  (await prisma.administrator.findUniqueOrThrow({ where: { id: administratorId } })).recoveryEmail;

beforeEach(() => {
  store.clear();
  jobs.length = 0;
});

describe('administrator recovery email', () => {
  it('register: a right code stores the address (AC-1, C-33)', async () => {
    const a = await seedAdmin();

    const asked = await post('request', a.token, { email: RECOVERY });
    expect(asked.status).toBe(204);
    expect(jobs.at(-1)?.to).toBe(RECOVERY);
    const res = await post('confirm', a.token, { email: RECOVERY, code: codeSent() });

    expect(res.status).toBe(204);
    expect(await stored(a.administratorId)).toBe(RECOVERY);
  });

  describe('refusals leave recovery_email unchanged (AC-2, C-29)', () => {
    it('the person own email, whatever the case: 400 VALIDATION_ERROR, no code sent', async () => {
      const a = await seedAdmin();
      const own = (await prisma.person.findUniqueOrThrow({ where: { id: a.person.id } })).email!;

      const res = await post('request', a.token, { email: own.toUpperCase() });

      expect(res.status).toBe(400);
      expect(errCode(res.body)).toBe('VALIDATION_ERROR');
      expect(jobs).toHaveLength(0);
      expect(await stored(a.administratorId)).toBeNull();
    });

    it('a wrong code: 400 OTP_INVALID', async () => {
      const a = await seedAdmin();
      await post('request', a.token, { email: RECOVERY });

      const res = await post('confirm', a.token, { email: RECOVERY, code: wrongCode() });

      expect(res.status).toBe(400);
      expect(errCode(res.body)).toBe('OTP_INVALID');
      expect(await stored(a.administratorId)).toBeNull();
    });

    it('an expired code: 400 OTP_INVALID', async () => {
      const a = await seedAdmin();
      await post('request', a.token, { email: RECOVERY });
      await prisma.$executeRaw`UPDATE otp_challenges SET expires_at = now() - interval '1 minute'`;

      const res = await post('confirm', a.token, { email: RECOVERY, code: codeSent() });

      expect(res.status).toBe(400);
      expect(errCode(res.body)).toBe('OTP_INVALID');
      expect(await stored(a.administratorId)).toBeNull();
    });

    it('a code sent to another address: 400 OTP_INVALID', async () => {
      const a = await seedAdmin();
      await post('request', a.token, { email: RECOVERY });

      const res = await post('confirm', a.token, {
        email: 'attaquant@example.test',
        code: codeSent(),
      });

      expect(res.status).toBe(400);
      expect(errCode(res.body)).toBe('OTP_INVALID');
      expect(await stored(a.administratorId)).toBeNull();
    });

    it('a normal access token: 401', async () => {
      const a = await seedAdmin();
      const normal = signAccessToken({ personId: a.person.id, deviceId: newId() });

      const asked = await post('request', normal, { email: RECOVERY });
      const confirmed = await post('confirm', normal, { email: RECOVERY, code: '123456' });

      expect(asked.status).toBe(401);
      expect(confirmed.status).toBe(401);
      expect(jobs).toHaveLength(0);
      expect(await stored(a.administratorId)).toBeNull();
    });

    it('no token: 401', async () => {
      const res = await post('request', null, { email: RECOVERY });
      expect(res.status).toBe(401);
    });
  });

  it('not saved early: only the request leaves recovery_email empty (AC-3)', async () => {
    const a = await seedAdmin();

    const res = await post('request', a.token, { email: RECOVERY });

    expect(res.status).toBe(204);
    expect(await stored(a.administratorId)).toBeNull();
  });

  it('planting: a stolen session cannot save an address without the code (AB-1, CWE-345)', async () => {
    const a = await seedAdmin();

    const noRequest = await post('confirm', a.token, {
      email: 'attaquant@example.test',
      code: '123456',
    });
    const noCode = await post('confirm', a.token, { email: 'attaquant@example.test' });
    const direct = await post('request', a.token, {
      email: 'attaquant@example.test',
      recovery_email: 'x@example.test',
    });

    expect(noRequest.status).toBe(400);
    expect(noCode.status).toBe(400);
    expect(direct.status).toBe(400);
    expect(await stored(a.administratorId)).toBeNull();
  });

  it("another administrator's code cannot register the address for me (C-33, v5.0.0-6.5.1)", async () => {
    const a = await seedAdmin();
    const b = await seedAdmin();
    await post('request', b.token, { email: RECOVERY });

    const res = await post('confirm', a.token, { email: RECOVERY, code: codeSent() });

    expect(res.status).toBe(400);
    expect(errCode(res.body)).toBe('OTP_INVALID');
    expect(await stored(a.administratorId)).toBeNull();
  });

  it('a code works once only (C-33)', async () => {
    const a = await seedAdmin();
    await post('request', a.token, { email: RECOVERY });
    const code = codeSent();
    await post('confirm', a.token, { email: RECOVERY, code });
    await prisma.administrator.update({
      where: { id: a.administratorId },
      data: { recoveryEmail: null },
    });

    const again = await post('confirm', a.token, { email: RECOVERY, code });

    expect(again.status).toBe(400);
    expect(await stored(a.administratorId)).toBeNull();
  });
});
