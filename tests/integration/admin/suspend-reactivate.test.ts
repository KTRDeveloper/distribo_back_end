import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, type ErrorBody } from '../../helpers/body';
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

const { app } = await import('../../../src/app.js');
const { createTotpSecret, encryptSecret } = await import('../../../src/lib/totp.js');
const { signAdminToken, signAccessToken } = await import('../../../src/lib/jwt.js');
const { hashPassword } = await import('../../../src/lib/password.js');
const { newId } = await import('../../../src/shared/ids.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

const REG = new Date('2026-01-01T00:00:00.000Z');
const TARGET = '0199d014-0000-7000-8000-000000000002';
const OWNER = '0199d014-0000-7000-8000-000000000003';
const ORG_ID = '0199d014-0000-7000-8000-000000000011';
const UNKNOWN_ID = '0199d014-0000-7000-8000-0000000000ff';
const TARGET_PHONE = '+237600014002';
const PASSWORD = 'correct horse battery';

async function seedPerson(id: string, phone: string, extra: Record<string, unknown> = {}) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
      ...extra,
    },
  });
}

let adminSeq = 0;
async function seedAdmin(role: 'MODERATOR' | 'SUPER_ADMIN' = 'MODERATOR') {
  const personId = newId();
  adminSeq += 1;
  await seedPerson(personId, `+23760024${String(adminSeq).padStart(4, '0')}`);
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

const post = (path: string, token: string | null, body: unknown) => {
  const r = request(app).post(`/api/v1/admin/${path}`);
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body as object);
};
const personPath = (id: string, verb: 'suspend' | 'reactivate') => `people/${id}/${verb}`;
const orgPath = (id: string, verb: 'suspend' | 'reactivate') => `organizations/${id}/${verb}`;

const device = { platform: 'ANDROID', app_version: '1.0.0' } as const;
const login = () =>
  request(app).post('/api/v1/auth/login').send({ phone_number: TARGET_PHONE, password: PASSWORD });

beforeEach(async () => {
  store.clear();
  await seedPerson(TARGET, TARGET_PHONE, { passwordHash: await hashPassword(PASSWORD) });
  await seedPerson(OWNER, '+237600014003');
  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: 'Fixture Org',
      collaborations: {
        create: { id: newId(), personId: OWNER, role: 'OWNER', status: 'ACTIVE', acceptedAt: REG },
      },
    },
  });
});

describe('POST /api/v1/admin/people/{personId}/suspend and /reactivate', () => {
  it('person cycle: ACTIVE, SUSPENDED, ACTIVE, sessions ended, two journal rows, notices (AC-1, CM-33)', async () => {
    const admin = await seedAdmin();
    await issueSession(TARGET, device);
    await issueSession(TARGET, device);
    const before = await prisma.person.findUniqueOrThrow({ where: { id: TARGET } });

    const suspended = await post(personPath(TARGET, 'suspend'), admin.token, {
      reason: 'Abusive behaviour',
    });

    expect(suspended.status).toBe(204);
    const mid = await prisma.person.findUniqueOrThrow({ where: { id: TARGET } });
    expect(mid.status).toBe('SUSPENDED');
    expect(mid.scopeVersion).toBe(before.scopeVersion + 1);
    const tokens = await prisma.refreshToken.findMany({ where: { personId: TARGET } });
    expect(tokens).toHaveLength(2);
    expect(
      tokens.every((t) => t.revokedAt !== null && t.revokedReason === 'ACCOUNT_SUSPENDED')
    ).toBe(true);

    const reactivated = await post(personPath(TARGET, 'reactivate'), admin.token, {
      reason: 'Appeal accepted',
    });

    expect(reactivated.status).toBe(204);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: TARGET } })).status).toBe(
      'ACTIVE'
    );
    const rows = await prisma.adminAction.findMany({
      where: { targetPersonId: TARGET },
      orderBy: { occurredAt: 'asc' },
    });
    expect(rows.map((r) => r.action)).toEqual(['SUSPEND', 'REACTIVATE']);
    expect(rows.every((r) => r.reportId === null)).toBe(true);
    const notices = await prisma.notification.findMany({
      where: { recipientId: TARGET },
      orderBy: { createdAt: 'asc' },
    });
    expect(notices.map((n) => n.sourceEvent)).toEqual(['account.suspended', 'account.reactivated']);
  });

  it('sign in again: a suspended person is refused at login, a reactivated one passes (AC-4)', async () => {
    const admin = await seedAdmin();
    await post(personPath(TARGET, 'suspend'), admin.token, { reason: 'Abuse' });
    expect((await login()).status).toBe(403);

    await post(personPath(TARGET, 'reactivate'), admin.token, { reason: 'Cleared' });

    expect((await login()).status).toBe(202);
  });

  it('trace: every suspension and reactivation has a row with author, target and reason (AB-1, CWE-778)', async () => {
    const admin = await seedAdmin();

    await post(personPath(TARGET, 'suspend'), admin.token, { reason: 'Traceable suspend' });
    await post(personPath(TARGET, 'reactivate'), admin.token, { reason: 'Traceable reactivate' });

    const rows = await prisma.adminAction.findMany({
      where: { targetPersonId: TARGET },
      orderBy: { occurredAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      action: 'SUSPEND',
      administratorId: admin.administratorId,
      targetPersonId: TARGET,
      reason: 'Traceable suspend',
    });
    expect(rows[1]).toMatchObject({
      action: 'REACTIVATE',
      administratorId: admin.administratorId,
      targetPersonId: TARGET,
      reason: 'Traceable reactivate',
    });
  });
});

describe('POST /api/v1/admin/organizations/{organizationId}/suspend and /reactivate', () => {
  it('organization cycle: ACTIVE, SUSPENDED, ACTIVE, two journal rows, owner notices (AC-2)', async () => {
    const admin = await seedAdmin();

    const suspended = await post(orgPath(ORG_ID, 'suspend'), admin.token, { reason: 'Fraud' });
    expect(suspended.status).toBe(204);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: ORG_ID } })).status).toBe(
      'SUSPENDED'
    );

    const reactivated = await post(orgPath(ORG_ID, 'reactivate'), admin.token, {
      reason: 'Cleared',
    });
    expect(reactivated.status).toBe(204);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: ORG_ID } })).status).toBe(
      'ACTIVE'
    );

    const rows = await prisma.adminAction.findMany({
      where: { targetOrganizationId: ORG_ID },
      orderBy: { occurredAt: 'asc' },
    });
    expect(rows.map((r) => r.action)).toEqual(['SUSPEND', 'REACTIVATE']);
    expect(rows[0]).toMatchObject({
      administratorId: admin.administratorId,
      targetPersonId: null,
      reportId: null,
      reason: 'Fraud',
    });
    const notices = await prisma.notification.findMany({
      where: { recipientId: OWNER },
      orderBy: { createdAt: 'asc' },
    });
    expect(notices.map((n) => n.sourceEvent)).toEqual(['account.suspended', 'account.reactivated']);
    expect(notices.every((n) => n.organizationId === ORG_ID)).toBe(true);
  });
});

describe('refusals', () => {
  async function counts() {
    return {
      actions: await prisma.adminAction.count(),
      notices: await prisma.notification.count(),
    };
  }

  it('suspending a SUSPENDED person gives 409 INVALID_STATE and nothing changes (AC-3)', async () => {
    const admin = await seedAdmin();
    await prisma.person.update({ where: { id: TARGET }, data: { status: 'SUSPENDED' } });
    const before = await counts();

    const res = await post(personPath(TARGET, 'suspend'), admin.token, { reason: 'Again' });

    expect(res.status).toBe(409);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('INVALID_STATE');
    expect(await counts()).toEqual(before);
  });

  it('suspending a SUSPENDED organization gives 409 INVALID_STATE (AC-3)', async () => {
    const admin = await seedAdmin();
    await prisma.organization.update({ where: { id: ORG_ID }, data: { status: 'SUSPENDED' } });

    const res = await post(orgPath(ORG_ID, 'suspend'), admin.token, { reason: 'Again' });

    expect(res.status).toBe(409);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('INVALID_STATE');
    expect(await prisma.adminAction.count()).toBe(0);
  });

  it('reactivating an ACTIVE person gives 409 INVALID_STATE and nothing changes (AC-3)', async () => {
    const admin = await seedAdmin();

    const res = await post(personPath(TARGET, 'reactivate'), admin.token, { reason: 'Why' });

    expect(res.status).toBe(409);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('INVALID_STATE');
    expect(await counts()).toEqual({ actions: 0, notices: 0 });
  });

  it('reactivating an ACTIVE organization gives 409 INVALID_STATE (AC-3)', async () => {
    const admin = await seedAdmin();

    const res = await post(orgPath(ORG_ID, 'reactivate'), admin.token, { reason: 'Why' });

    expect(res.status).toBe(409);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('INVALID_STATE');
    expect(await prisma.adminAction.count()).toBe(0);
  });

  it('reactivating a CLOSED organization gives 409 INVALID_STATE and it stays CLOSED (AC-3)', async () => {
    const admin = await seedAdmin();
    await prisma.organization.update({ where: { id: ORG_ID }, data: { status: 'CLOSED' } });

    const res = await post(orgPath(ORG_ID, 'reactivate'), admin.token, { reason: 'Reopen' });

    expect(res.status).toBe(409);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('INVALID_STATE');
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: ORG_ID } })).status).toBe(
      'CLOSED'
    );
    expect(await prisma.adminAction.count()).toBe(0);
  });

  it.each(['suspend', 'reactivate'] as const)(
    'an ANONYMIZED person on %s gives 409 TARGET_ANONYMIZED and nothing changes (AC-3)',
    async (verb) => {
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

      const res = await post(personPath(TARGET, verb), admin.token, { reason: 'Ok' });

      expect(res.status).toBe(409);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('TARGET_ANONYMIZED');
      expect((await prisma.person.findUniqueOrThrow({ where: { id: TARGET } })).status).toBe(
        'ANONYMIZED'
      );
      expect(await prisma.adminAction.count()).toBe(0);
    }
  );

  it.each([
    ['an empty reason', { reason: '   ' }],
    ['a missing reason', {}],
    ['a reason over 2000 characters', { reason: 'x'.repeat(2001) }],
    ['an unknown field', { reason: 'Ok', status: 'ACTIVE' }],
  ])('%s gives 400 VALIDATION_ERROR and nothing changes (AC-3)', async (_name, body) => {
    const admin = await seedAdmin();

    const person = await post(personPath(TARGET, 'suspend'), admin.token, body);
    const org = await post(orgPath(ORG_ID, 'suspend'), admin.token, body);

    for (const res of [person, org]) {
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    }
    expect((await prisma.person.findUniqueOrThrow({ where: { id: TARGET } })).status).toBe(
      'ACTIVE'
    );
    expect(await prisma.adminAction.count()).toBe(0);
  });

  it('a malformed id gives 400 VALIDATION_ERROR (AC-3)', async () => {
    const admin = await seedAdmin();
    const res = await post('people/not-a-uuid/suspend', admin.token, { reason: 'Ok' });
    expect(res.status).toBe(400);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['person suspend', personPath(UNKNOWN_ID, 'suspend')],
    ['person reactivate', personPath(UNKNOWN_ID, 'reactivate')],
    ['organization suspend', orgPath(UNKNOWN_ID, 'suspend')],
    ['organization reactivate', orgPath(UNKNOWN_ID, 'reactivate')],
  ])('an unknown id on %s gives 404 NOT_FOUND (AC-3)', async (_name, path) => {
    const admin = await seedAdmin();

    const res = await post(path, admin.token, { reason: 'Ok' });

    expect(res.status).toBe(404);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    expect(await prisma.adminAction.count()).toBe(0);
  });

  it('two parallel suspensions: exactly one wins and one journal row exists (CWE-362)', async () => {
    const admin = await seedAdmin();

    const [a, b] = await Promise.all([
      post(personPath(TARGET, 'suspend'), admin.token, { reason: 'First' }),
      post(personPath(TARGET, 'suspend'), admin.token, { reason: 'Second' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([204, 409]);
    expect(await prisma.adminAction.count({ where: { targetPersonId: TARGET } })).toBe(1);
  });
});

describe('authorization', () => {
  it.each([
    ['person suspend', personPath(TARGET, 'suspend')],
    ['person reactivate', personPath(TARGET, 'reactivate')],
    ['organization suspend', orgPath(ORG_ID, 'suspend')],
    ['organization reactivate', orgPath(ORG_ID, 'reactivate')],
  ])(
    'a customer token on %s gives 401 and nothing changes (AB-2, WSTG-ATHZ-03)',
    async (_n, path) => {
      const customer = signAccessToken({ personId: OWNER, deviceId: newId() });

      const res = await post(path, customer, { reason: 'Ok' });

      expect(res.status).toBe(401);
      expect(await prisma.adminAction.count()).toBe(0);
      expect((await prisma.person.findUniqueOrThrow({ where: { id: TARGET } })).status).toBe(
        'ACTIVE'
      );
    }
  );

  it('no token gives 401', async () => {
    const res = await post(personPath(TARGET, 'suspend'), null, { reason: 'Ok' });
    expect(res.status).toBe(401);
  });
});
