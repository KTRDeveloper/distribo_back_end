import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { prisma } from '../../setup';

const store = new Map<string, number>();
const jobs: { to: string; channel: string; message: string }[] = [];

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
  enqueueOtpDelivery: (d: { to: string; channel: string; message: string }) => {
    jobs.push(d);
    return Promise.resolve();
  },
}));
vi.mock('../../../src/lib/config-service.js', () => ({
  configService: { get: () => Promise.resolve(null) },
}));

const { app } = await import('../../../src/app.js');
const { createTotpSecret, encryptSecret } = await import('../../../src/lib/totp.js');
const { signAdminToken } = await import('../../../src/lib/jwt.js');
const { newId } = await import('../../../src/shared/ids.js');
const { hashPassword } = await import('../../../src/lib/password.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const REG = new Date('2026-01-01T00:00:00.000Z');
const TARGET = '0199d020-0000-7000-8000-000000000002';
const OTHER = '0199d020-0000-7000-8000-000000000003';
const HOLDER = '0199d020-0000-7000-8000-000000000004';
const TARGET_PHONE = '+237600020002';
const OTHER_PHONE = '+237600020003';
const NEW_PHONE = '+237600020005';
const OTHER_NEW_PHONE = '+237600020006';
const EMAIL = 'fixture.target@example.test';
const OTHER_EMAIL = 'fixture.other@example.test';
const PASSWORD = 'fixture-password-correct-horse';
const REASON = 'Lost SIM, identity checked by phone';

async function seedPerson(id: string, phone: string | null, extra: Record<string, unknown> = {}) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: phone ? REG : null,
      passwordHash: await hashPassword(PASSWORD),
      registeredAt: REG,
      ...extra,
    },
  });
}

let adminSeq = 0;
async function seedAdmin(role: 'MODERATOR' | 'SUPER_ADMIN' = 'SUPER_ADMIN') {
  const personId = newId();
  adminSeq += 1;
  await seedPerson(personId, `+23760039${String(adminSeq).padStart(4, '0')}`);
  const administratorId = newId();
  await prisma.administrator.create({
    data: {
      id: administratorId,
      personId,
      role,
      totpSecret: encryptSecret(createTotpSecret().secret),
    },
  });
  return { personId, administratorId, token: signAdminToken({ personId, administratorId, role }) };
}

const start = (id: string, token: string, phone: string) =>
  request(app)
    .post(`/api/v1/admin/people/${id}/restore-access/start`)
    .set('Authorization', `Bearer ${token}`)
    .send({ new_phone_number: phone });

const complete = (id: string, token: string | null, body: unknown) => {
  const r = request(app).post(`/api/v1/admin/people/${id}/restore-access/complete`);
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body as object);
};

/** The two codes the person was sent by the last start, read from the delivery queue. */
function sentCodes(): { email: string; sms: string } {
  const code = (channel: string) => {
    const job = [...jobs].reverse().find((j) => j.channel === channel);
    return /(\d{6})/.exec(job?.message ?? '')?.[1] ?? 'x';
  };
  return { email: code('EMAIL'), sms: code('SMS') };
}

const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

const verified = { email: EMAIL, emailVerifiedAt: REG };

async function startedRestoration() {
  const admin = await seedAdmin();
  const res = await start(TARGET, admin.token, NEW_PHONE);
  expect(res.status).toBe(204);
  return { admin, ...sentCodes() };
}

const body = (codes: { email: string; sms: string }, extra: Record<string, unknown> = {}) => ({
  new_phone_number: NEW_PHONE,
  email_code: codes.email,
  sms_code: codes.sms,
  reason: REASON,
  ...extra,
});

async function snapshot(personId: string) {
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
  return {
    phone: person.phoneNumber,
    released: person.releasedPhoneNumber,
    live: await prisma.refreshToken.count({ where: { personId, revokedAt: null } }),
    logs: await prisma.phoneNumberChangeLog.count({ where: { personId } }),
    actions: await prisma.adminAction.count({ where: { targetPersonId: personId } }),
    notices: await prisma.notification.count({ where: { recipientId: personId } }),
  };
}

const device = { platform: 'ANDROID' as const, app_version: '1.0.0' };

beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await seedPerson(TARGET, TARGET_PHONE, verified);
  await issueSession(TARGET, device);
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
});

describe('POST /api/v1/admin/people/{personId}/restore-access/complete', () => {
  it('restore: right codes move the account, sign the devices out and journal it (AC-1, CM-40)', async () => {
    const { admin, ...codes } = await startedRestoration();
    expect((await snapshot(TARGET)).live).toBe(1);

    const res = await complete(TARGET, admin.token, body(codes));

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const person = await prisma.person.findUniqueOrThrow({ where: { id: TARGET } });
    expect(person.phoneNumber).toBe(NEW_PHONE);
    expect(person.releasedPhoneNumber).toBeNull();
    expect(person.phoneVerifiedAt!.getTime()).toBeGreaterThan(REG.getTime());
    const logs = await prisma.phoneNumberChangeLog.findMany({ where: { personId: TARGET } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ oldPhoneNumber: TARGET_PHONE, newPhoneNumber: NEW_PHONE });
    expect(await prisma.refreshToken.count({ where: { personId: TARGET, revokedAt: null } })).toBe(
      0
    );
    const actions = await prisma.adminAction.findMany({ where: { targetPersonId: TARGET } });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      action: 'RESTORE_ACCESS',
      administratorId: admin.administratorId,
      reason: REASON,
    });
    const notices = await prisma.notification.findMany({ where: { recipientId: TARGET } });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ sourceEvent: 'admin.access_restored' });
    expect(notices[0].content).toContain('Le support a rendu');

    const signIn = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone_number: NEW_PHONE, password: PASSWORD });
    expect(signIn.status).toBe(202);
    const oldNumber = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone_number: TARGET_PHONE, password: PASSWORD });
    expect(oldNumber.status).not.toBe(202);
  });

  it('accepts the new number written locally (AC-1, normalizeE164)', async () => {
    const { admin, ...codes } = await startedRestoration();
    const res = await complete(TARGET, admin.token, body(codes, { new_phone_number: '600020005' }));
    expect(res.status).toBe(204);
    expect((await snapshot(TARGET)).phone).toBe(NEW_PHONE);
  });

  describe('refusals (AC-2)', () => {
    it('a wrong code: 400 OTP_INVALID, nothing changes', async () => {
      const { admin, ...codes } = await startedRestoration();
      const before = await snapshot(TARGET);
      const res = await complete(
        TARGET,
        admin.token,
        body({ email: codes.email, sms: wrong(codes.sms) })
      );
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('OTP_INVALID');
      expect(await snapshot(TARGET)).toEqual(before);
    });

    it('a used code: the same codes twice give 400 OTP_INVALID the second time', async () => {
      const { admin, ...codes } = await startedRestoration();
      expect((await complete(TARGET, admin.token, body(codes))).status).toBe(204);
      const before = await snapshot(TARGET);
      // The second call is refused by the checks of ADM-019 (the number is now the person's own).
      const again = await complete(TARGET, admin.token, body(codes));
      expect(again.status).toBe(400);
      expect(await snapshot(TARGET)).toEqual(before);
    });

    it('a consumed SMS code is refused with 400 OTP_INVALID', async () => {
      const { admin, ...codes } = await startedRestoration();
      await prisma.otpChallenge.updateMany({
        where: { personId: TARGET, channel: 'SMS' },
        data: { consumedAt: new Date() },
      });
      const res = await complete(TARGET, admin.token, body(codes));
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('OTP_INVALID');
      expect((await snapshot(TARGET)).phone).toBe(TARGET_PHONE);
    });

    it('an expired code: 400 OTP_EXPIRED, nothing changes', async () => {
      const { admin, ...codes } = await startedRestoration();
      await prisma.otpChallenge.updateMany({
        where: { personId: TARGET, channel: 'EMAIL' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const before = await snapshot(TARGET);
      const res = await complete(TARGET, admin.token, body(codes));
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('OTP_EXPIRED');
      expect(await snapshot(TARGET)).toEqual(before);
    });

    it('a number taken meanwhile: 409 PHONE_TAKEN, nothing changes', async () => {
      const { admin, ...codes } = await startedRestoration();
      await seedPerson(HOLDER, NEW_PHONE);
      const before = await snapshot(TARGET);
      const res = await complete(TARGET, admin.token, body(codes));
      expect(res.status).toBe(409);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('PHONE_TAKEN');
      expect(await snapshot(TARGET)).toEqual(before);
    });

    it('five wrong tries lock the code: 429 OTP_LOCKED', async () => {
      const { admin, ...codes } = await startedRestoration();
      const bad = body({ email: wrong(codes.email), sms: codes.sms });
      for (let i = 0; i < 5; i += 1) {
        expect((await complete(TARGET, admin.token, bad)).status).toBe(400);
      }
      const res = await complete(TARGET, admin.token, body(codes));
      expect(res.status).toBe(429);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('OTP_LOCKED');
      expect((await snapshot(TARGET)).phone).toBe(TARGET_PHONE);
    });

    it.each([
      ['an empty reason', { reason: '' }],
      ['a blank reason', { reason: '   ' }],
      ['a missing reason', { reason: undefined }],
      ['an unknown field', { extra: 1 }],
      ['a missing code', { sms_code: undefined }],
    ])('%s: 400 VALIDATION_ERROR, nothing changes', async (_name, change) => {
      const { admin, ...codes } = await startedRestoration();
      const before = await snapshot(TARGET);
      const res = await complete(TARGET, admin.token, body(codes, change));
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
      expect(await snapshot(TARGET)).toEqual(before);
    });

    it('the checks of ADM-019 run again: unknown 404, no verified email 409, suspended 409', async () => {
      const { admin, ...codes } = await startedRestoration();
      const unknown = await complete(
        '0199d020-0000-7000-8000-0000000000ff',
        admin.token,
        body(codes)
      );
      expect(unknown.status).toBe(404);

      await prisma.person.update({ where: { id: TARGET }, data: { status: 'SUSPENDED' } });
      const suspended = await complete(TARGET, admin.token, body(codes));
      expect(suspended.status).toBe(409);
      expect(bodyOf<ErrorBody>(suspended).error.code).toBe('INVALID_STATE');

      await prisma.person.update({
        where: { id: TARGET },
        data: { status: 'ACTIVE', emailVerifiedAt: null },
      });
      const noEmail = await complete(TARGET, admin.token, body(codes));
      expect(noEmail.status).toBe(409);
      expect(bodyOf<ErrorBody>(noEmail).error.code).toBe('NO_VERIFIED_EMAIL');
      expect((await snapshot(TARGET)).phone).toBe(TARGET_PHONE);
    });
  });

  describe('atomic (AC-3)', () => {
    it('a journal insert that fails leaves the number and the sessions in place', async () => {
      const { admin, ...codes } = await startedRestoration();
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION adm020_fail() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'journal insert refused'; END; $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER adm020_fail BEFORE INSERT ON admin_actions
         FOR EACH ROW EXECUTE FUNCTION adm020_fail()`
      );
      const before = await snapshot(TARGET);
      try {
        const res = await complete(TARGET, admin.token, body(codes));
        expect(res.status).toBe(500);
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER adm020_fail ON admin_actions');
        await prisma.$executeRawUnsafe('DROP FUNCTION adm020_fail()');
      }
      expect(await snapshot(TARGET)).toEqual(before);
      expect(before.live).toBe(1);
      expect(before.phone).toBe(TARGET_PHONE);
    });
  });

  describe('abuse cases', () => {
    it('one proof is not enough: a wrong code on either side gives 400, then the right pair works (AB-1, CWE-287)', async () => {
      const { admin, ...codes } = await startedRestoration();
      const before = await snapshot(TARGET);

      const emailWrong = await complete(
        TARGET,
        admin.token,
        body({ email: wrong(codes.email), sms: codes.sms })
      );
      const smsWrong = await complete(
        TARGET,
        admin.token,
        body({ email: codes.email, sms: wrong(codes.sms) })
      );

      expect(emailWrong.status).toBe(400);
      expect(smsWrong.status).toBe(400);
      expect(await snapshot(TARGET)).toEqual(before);
      // A right code is not spent by a request whose other code was wrong.
      expect((await complete(TARGET, admin.token, body(codes))).status).toBe(204);
    });

    it('the email code cannot stand for the SMS code and the reverse (AB-1, v5.0.0-6.4.4)', async () => {
      const { admin, ...codes } = await startedRestoration();
      const res = await complete(TARGET, admin.token, body({ email: codes.sms, sms: codes.email }));
      expect(res.status).toBe(400);
      expect((await snapshot(TARGET)).phone).toBe(TARGET_PHONE);
    });

    it('codes of another restoration: person A codes posted for person B give 400 OTP_INVALID (AB-2, CWE-639)', async () => {
      await seedPerson(OTHER, OTHER_PHONE, { email: OTHER_EMAIL, emailVerifiedAt: REG });
      await issueSession(OTHER, device);
      const admin = await seedAdmin();
      expect((await start(TARGET, admin.token, NEW_PHONE)).status).toBe(204);
      const codesA = sentCodes();
      expect((await start(OTHER, admin.token, OTHER_NEW_PHONE)).status).toBe(204);
      const beforeA = await snapshot(TARGET);
      const beforeB = await snapshot(OTHER);

      const res = await complete(OTHER, admin.token, {
        ...body(codesA),
        new_phone_number: OTHER_NEW_PHONE,
      });

      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('OTP_INVALID');
      expect(await snapshot(TARGET)).toEqual(beforeA);
      expect(await snapshot(OTHER)).toEqual(beforeB);
    });

    it('a code bound to another person is refused even when the target matches (v5.0.0-6.6.2)', async () => {
      const { admin, ...codes } = await startedRestoration();
      await prisma.otpChallenge.updateMany({
        where: { personId: TARGET },
        data: { personId: null },
      });
      const res = await complete(TARGET, admin.token, body(codes));
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('OTP_INVALID');
      expect((await snapshot(TARGET)).phone).toBe(TARGET_PHONE);
    });

    it('a moderator gets 403 and nothing changes (AB-3, CWE-269)', async () => {
      const { ...codes } = await startedRestoration();
      const moderator = await seedAdmin('MODERATOR');
      const before = await snapshot(TARGET);
      const res = await complete(TARGET, moderator.token, body(codes));
      expect(res.status).toBe(403);
      expect(await snapshot(TARGET)).toEqual(before);
    });

    it('no token: 401 (v5.0.0-8.2.1)', async () => {
      const codes = await startedRestoration();
      const res = await complete(TARGET, null, body(codes));
      expect(res.status).toBe(401);
    });
  });
});
