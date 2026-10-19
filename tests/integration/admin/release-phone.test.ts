import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { prisma } from '../../setup';

const hook = vi.hoisted(() => ({ calls: [] as string[], fail: false }));

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
  getCount: () => Promise.resolve(0),
  resetKey: () => Promise.resolve(),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: () => Promise.resolve(),
}));

const { app } = await import('../../../src/app.js');
const { createTotpSecret, encryptSecret } = await import('../../../src/lib/totp.js');
const { signAdminToken } = await import('../../../src/lib/jwt.js');
const { hashOtp } = await import('../../../src/lib/otp.js');
const { newId } = await import('../../../src/shared/ids.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');
const { registerPhoneReleasedHandler } = await import(
  '../../../src/modules/person/phone-released.js'
);

registerPhoneReleasedHandler((event) => {
  hook.calls.push(event.phoneNumber);
  if (hook.fail) return Promise.reject(new Error('handler failed'));
  return Promise.resolve();
});

const REG = new Date('2026-01-01T00:00:00.000Z');
const TARGET = '0199d017-0000-7000-8000-000000000002';
const UNKNOWN_ID = '0199d017-0000-7000-8000-0000000000ff';
const TARGET_PHONE = '+237600017002';
const device = { platform: 'ANDROID', app_version: '1.0.0' } as const;

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
  await seedPerson(personId, `+23760027${String(adminSeq).padStart(4, '0')}`);
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

const release = (id: string, token: string | null, body: unknown = { reason: 'Former holder' }) => {
  const r = request(app).post(`/api/v1/admin/people/${id}/release-phone`);
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body as object);
};

async function counts() {
  return {
    actions: await prisma.adminAction.count(),
    notices: await prisma.notification.count(),
  };
}
const target = () => prisma.person.findUniqueOrThrow({ where: { id: TARGET } });

beforeEach(async () => {
  hook.calls = [];
  hook.fail = false;
  await seedPerson(TARGET, TARGET_PHONE);
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
});

describe('POST /api/v1/admin/people/{personId}/release-phone', () => {
  it('release: number moved, handler ran once, journal row, notice, sessions kept (AC-1, CM-41, CM-04)', async () => {
    const admin = await seedAdmin();
    await issueSession(TARGET, device);
    const before = await target();

    const res = await release(TARGET, admin.token, { reason: 'Wrongly blocks the new holder' });

    expect(res.status).toBe(204);
    const after = await target();
    expect(after.phoneNumber).toBeNull();
    expect(after.releasedPhoneNumber).toBe(TARGET_PHONE);
    expect(after.phoneVerifiedAt).toBeNull();
    expect(after.scopeVersion).toBe(before.scopeVersion + 1);
    const tokens = await prisma.refreshToken.findMany({ where: { personId: TARGET } });
    expect(tokens).toHaveLength(1);
    expect(tokens.every((t) => t.revokedAt === null)).toBe(true);
    expect(hook.calls).toEqual([TARGET_PHONE]);
    const rows = await prisma.adminAction.findMany({ where: { targetPersonId: TARGET } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'RELEASE_PHONE',
      administratorId: admin.administratorId,
      targetPersonId: TARGET,
      reason: 'Wrongly blocks the new holder',
    });
    const notices = await prisma.notification.findMany({ where: { recipientId: TARGET } });
    expect(notices).toHaveLength(1);
    expect(notices[0].sourceEvent).toBe('admin.phone_released');
    expect(notices[0].content).not.toContain(TARGET_PHONE);

    await prisma.otpChallenge.create({
      data: {
        id: newId(),
        target: TARGET_PHONE,
        purpose: 'REGISTRATION',
        channel: 'SMS',
        codeHash: await hashOtp('123456'),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const registered = await request(app).post('/api/v1/auth/register').send({
      phone_number: TARGET_PHONE,
      code: '123456',
      full_name: 'Nouveau Titulaire',
      password: 'correct horse battery',
      device,
      new_holder: true,
    });
    expect(registered.status).toBe(201);
  });

  it('a repeat gives 409 NO_ACTIVE_NUMBER, with one journal row and one notice (AC-2)', async () => {
    const admin = await seedAdmin();
    await release(TARGET, admin.token);

    const again = await release(TARGET, admin.token);

    expect(again.status).toBe(409);
    expect(bodyOf<ErrorBody>(again).error.code).toBe('NO_ACTIVE_NUMBER');
    expect(await prisma.adminAction.count({ where: { targetPersonId: TARGET } })).toBe(1);
    expect(await prisma.notification.count({ where: { recipientId: TARGET } })).toBe(1);
    expect(hook.calls).toHaveLength(1);
  });
});

describe('refusals', () => {
  it('an unknown id gives 404 NOT_FOUND and nothing changes (AC-2)', async () => {
    const admin = await seedAdmin();
    const before = await counts();

    const res = await release(UNKNOWN_ID, admin.token);

    expect(res.status).toBe(404);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    expect(await counts()).toEqual(before);
  });

  it('an anonymized person gives 409 TARGET_ANONYMIZED and nothing changes (AC-2)', async () => {
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
    const before = await counts();

    const res = await release(TARGET, admin.token);

    expect(res.status).toBe(409);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('TARGET_ANONYMIZED');
    expect(await counts()).toEqual(before);
    expect(hook.calls).toEqual([]);
  });

  it('a guest gives 409 NO_ACTIVE_NUMBER and keeps the number (AC-2)', async () => {
    const admin = await seedAdmin();
    const guest = newId();
    await prisma.person.create({ data: { id: guest, phoneNumber: '+237600017003' } });
    const before = await counts();

    const res = await release(guest, admin.token);

    expect(res.status).toBe(409);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('NO_ACTIVE_NUMBER');
    expect((await prisma.person.findUniqueOrThrow({ where: { id: guest } })).phoneNumber).toBe(
      '+237600017003'
    );
    expect(await counts()).toEqual(before);
    expect(hook.calls).toEqual([]);
  });

  it('a registered person whose number is already released gives 409 NO_ACTIVE_NUMBER (AC-2)', async () => {
    const admin = await seedAdmin();
    await prisma.person.update({
      where: { id: TARGET },
      data: { phoneNumber: null, phoneVerifiedAt: null, releasedPhoneNumber: TARGET_PHONE },
    });
    const before = await counts();

    const res = await release(TARGET, admin.token);

    expect(res.status).toBe(409);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('NO_ACTIVE_NUMBER');
    expect(await counts()).toEqual(before);
  });

  it.each([
    ['an empty reason', { reason: '   ' }],
    ['a missing reason', {}],
    ['a reason over 2000 characters', { reason: 'x'.repeat(2001) }],
    ['an unknown field', { reason: 'Ok', status: 'ACTIVE' }],
  ])('%s gives 400 VALIDATION_ERROR and nothing changes (AC-2)', async (_name, body) => {
    const admin = await seedAdmin();
    const before = await counts();

    const res = await release(TARGET, admin.token, body);

    expect(res.status).toBe(400);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    expect((await target()).phoneNumber).toBe(TARGET_PHONE);
    expect(await counts()).toEqual(before);
  });

  it('a malformed id gives 400 VALIDATION_ERROR (AC-2)', async () => {
    const admin = await seedAdmin();
    const res = await release('not-a-uuid', admin.token);
    expect(res.status).toBe(400);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('no token gives 401 and the number is unchanged', async () => {
    const res = await release(TARGET, null);
    expect(res.status).toBe(401);
    expect((await target()).phoneNumber).toBe(TARGET_PHONE);
  });
});

describe('atomicity', () => {
  it('a failing handler gives 500 and undoes the release, the journal row and the notice (AC-3)', async () => {
    const admin = await seedAdmin();
    hook.fail = true;

    const res = await release(TARGET, admin.token);

    expect(res.status).toBe(500);
    const after = await target();
    expect(after.phoneNumber).toBe(TARGET_PHONE);
    expect(after.releasedPhoneNumber).toBeNull();
    expect(after.phoneVerifiedAt).not.toBeNull();
    expect(await prisma.adminAction.count({ where: { targetPersonId: TARGET } })).toBe(0);
    expect(await prisma.notification.count({ where: { recipientId: TARGET } })).toBe(0);
  });

  it('a journal insert that fails leaves the number in place (AB-2, CWE-778)', async () => {
    const admin = await seedAdmin();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION adm017_fail() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'journal insert refused'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER adm017_fail BEFORE INSERT ON admin_actions
       FOR EACH ROW EXECUTE FUNCTION adm017_fail()`
    );
    try {
      const res = await release(TARGET, admin.token);
      expect(res.status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER adm017_fail ON admin_actions');
      await prisma.$executeRawUnsafe('DROP FUNCTION adm017_fail()');
    }

    const after = await target();
    expect(after.phoneNumber).toBe(TARGET_PHONE);
    expect(after.releasedPhoneNumber).toBeNull();
    expect(await prisma.notification.count({ where: { recipientId: TARGET } })).toBe(0);
  });
});

describe('authorization', () => {
  it('a MODERATOR gets 403 and the number is unchanged (AB-1, C-29, CWE-269)', async () => {
    const moderator = await seedAdmin('MODERATOR');
    const before = await counts();

    const res = await release(TARGET, moderator.token);

    expect(res.status).toBe(403);
    expect((await target()).phoneNumber).toBe(TARGET_PHONE);
    expect(await counts()).toEqual(before);
    expect(hook.calls).toEqual([]);
  });
});
