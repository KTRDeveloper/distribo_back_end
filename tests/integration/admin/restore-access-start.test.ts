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

const REG = new Date('2026-01-01T00:00:00.000Z');
const TARGET = '0199d019-0000-7000-8000-000000000002';
const HOLDER = '0199d019-0000-7000-8000-000000000003';
const UNKNOWN_ID = '0199d019-0000-7000-8000-0000000000ff';
const TARGET_PHONE = '+237600019002';
const HOLDER_PHONE = '+237600019003';
const NEW_PHONE = '+237600019004';
const EMAIL = 'fixture.person@example.test';

async function seedPerson(id: string, phone: string | null, extra: Record<string, unknown> = {}) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: phone ? REG : null,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
      ...extra,
    },
  });
}

let adminSeq = 0;
async function seedAdmin(role: 'MODERATOR' | 'SUPER_ADMIN' = 'SUPER_ADMIN') {
  const personId = newId();
  adminSeq += 1;
  await seedPerson(personId, `+23760029${String(adminSeq).padStart(4, '0')}`);
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

const start = (
  id: string,
  token: string | null,
  body: unknown = { new_phone_number: NEW_PHONE }
) => {
  const r = request(app).post(`/api/v1/admin/people/${id}/restore-access/start`);
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body as object);
};

const verified = { email: EMAIL, emailVerifiedAt: REG };

async function challenges() {
  return prisma.otpChallenge.findMany({ orderBy: { createdAt: 'asc' } });
}
async function expectNothingSent() {
  expect(jobs).toEqual([]);
  expect(await challenges()).toEqual([]);
}

beforeEach(async () => {
  store.clear();
  jobs.length = 0;
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await seedPerson(TARGET, TARGET_PHONE, verified);
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
});

describe('POST /api/v1/admin/people/{personId}/restore-access/start', () => {
  it('two codes: 204, one EMAIL and one SMS challenge for the person, no journal row (AC-1, CM-40)', async () => {
    const admin = await seedAdmin();
    const actionsBefore = await prisma.adminAction.count();

    const res = await start(TARGET, admin.token);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const rows = await challenges();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          personId: TARGET,
          purpose: 'ACCESS_RESTORE',
          channel: 'EMAIL',
          target: EMAIL,
        }),
        expect.objectContaining({
          personId: TARGET,
          purpose: 'ACCESS_RESTORE',
          channel: 'SMS',
          target: NEW_PHONE,
        }),
      ])
    );
    expect(jobs.map((j) => [j.channel, j.to]).sort()).toEqual([
      ['EMAIL', EMAIL],
      ['SMS', NEW_PHONE],
    ]);
    expect(await prisma.adminAction.count()).toBe(actionsBefore);
    const person = await prisma.person.findUniqueOrThrow({ where: { id: TARGET } });
    expect(person.phoneNumber).toBe(TARGET_PHONE);
  });

  it('accepts a number written locally and sends to its +237 form (AC-1, normalizeE164)', async () => {
    const admin = await seedAdmin();

    const res = await start(TARGET, admin.token, { new_phone_number: '600019004' });

    expect(res.status).toBe(204);
    expect(jobs.map((j) => j.to)).toContain(NEW_PHONE);
  });

  describe('refusals (AC-2)', () => {
    it('an unknown id: 404 NOT_FOUND, nothing sent', async () => {
      const admin = await seedAdmin();
      const res = await start(UNKNOWN_ID, admin.token);
      expect(res.status).toBe(404);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
      await expectNothingSent();
    });

    it('a guest: 404 NOT_FOUND, nothing sent', async () => {
      const admin = await seedAdmin();
      await prisma.person.create({
        data: { id: HOLDER, phoneNumber: HOLDER_PHONE, email: EMAIL, emailVerifiedAt: null },
      });
      const res = await start(HOLDER, admin.token);
      expect(res.status).toBe(404);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
      await expectNothingSent();
    });

    it('an anonymized person: 409 TARGET_ANONYMIZED, nothing sent', async () => {
      const admin = await seedAdmin();
      await prisma.person.update({
        where: { id: TARGET },
        data: {
          status: 'ANONYMIZED',
          anonymizedAt: REG,
          phoneNumber: null,
          phoneVerifiedAt: null,
          releasedPhoneNumber: TARGET_PHONE,
        },
      });
      const res = await start(TARGET, admin.token);
      expect(res.status).toBe(409);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('TARGET_ANONYMIZED');
      await expectNothingSent();
    });

    it('a suspended person: 409 INVALID_STATE, nothing sent', async () => {
      const admin = await seedAdmin();
      await prisma.person.update({ where: { id: TARGET }, data: { status: 'SUSPENDED' } });
      const res = await start(TARGET, admin.token);
      expect(res.status).toBe(409);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('INVALID_STATE');
      await expectNothingSent();
    });

    it('a number held by someone else: 409 PHONE_TAKEN, nothing sent', async () => {
      const admin = await seedAdmin();
      await seedPerson(HOLDER, NEW_PHONE);
      const res = await start(TARGET, admin.token);
      expect(res.status).toBe(409);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('PHONE_TAKEN');
      await expectNothingSent();
    });

    it("the person's own number: 400 SAME_NUMBER, nothing sent", async () => {
      const admin = await seedAdmin();
      const res = await start(TARGET, admin.token, { new_phone_number: TARGET_PHONE });
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('SAME_NUMBER');
      await expectNothingSent();
    });

    it.each(['+33612345678', '+237222123456', 'not a number'])(
      'a number outside +237 mobiles (%s): 400 VALIDATION_ERROR, nothing sent',
      async (value) => {
        const admin = await seedAdmin();
        const res = await start(TARGET, admin.token, { new_phone_number: value });
        expect(res.status).toBe(400);
        expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
        await expectNothingSent();
      }
    );

    it('unknown field, missing number or bad id: 400 VALIDATION_ERROR, nothing sent', async () => {
      const admin = await seedAdmin();
      for (const body of [{}, { new_phone_number: NEW_PHONE, extra: 1 }]) {
        const res = await start(TARGET, admin.token, body);
        expect(res.status).toBe(400);
        expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
      }
      const bad = await start('not-a-uuid', admin.token);
      expect(bad.status).toBe(400);
      await expectNothingSent();
    });
  });

  it('too soon: the same start twice within a minute gives 429 OTP_RATE_LIMITED (AC-3)', async () => {
    const admin = await seedAdmin();

    const first = await start(TARGET, admin.token);
    const second = await start(TARGET, admin.token);

    expect(first.status).toBe(204);
    expect(second.status).toBe(429);
    expect(bodyOf<ErrorBody>(second).error.code).toBe('OTP_RATE_LIMITED');
    expect(jobs).toHaveLength(2);
  });

  describe('abuse cases', () => {
    it('no verified email: saved but not verified, and none, give 409 NO_VERIFIED_EMAIL (AB-1, CWE-287)', async () => {
      const admin = await seedAdmin();
      await prisma.person.update({
        where: { id: TARGET },
        data: { email: EMAIL, emailVerifiedAt: null },
      });
      const unverified = await start(TARGET, admin.token);
      expect(unverified.status).toBe(409);
      expect(bodyOf<ErrorBody>(unverified).error.code).toBe('NO_VERIFIED_EMAIL');
      await expectNothingSent();

      await prisma.person.update({
        where: { id: TARGET },
        data: { email: null, emailVerifiedAt: null },
      });
      const none = await start(TARGET, admin.token);
      expect(none.status).toBe(409);
      expect(bodyOf<ErrorBody>(none).error.code).toBe('NO_VERIFIED_EMAIL');
      await expectNothingSent();
    });

    it('a moderator: 403, nothing sent (AB-2, CWE-269)', async () => {
      const moderator = await seedAdmin('MODERATOR');
      const res = await start(TARGET, moderator.token);
      expect(res.status).toBe(403);
      await expectNothingSent();
    });

    it('no token: 401, nothing sent (v5.0.0-8.2.1)', async () => {
      const res = await start(TARGET, null);
      expect(res.status).toBe(401);
      await expectNothingSent();
    });
  });
});
