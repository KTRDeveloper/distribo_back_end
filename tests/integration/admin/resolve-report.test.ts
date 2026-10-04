import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { prisma } from '../../setup';

const { app } = await import('../../../src/app.js');
const { createTotpSecret, encryptSecret } = await import('../../../src/lib/totp.js');
const { signAdminToken, signAccessToken } = await import('../../../src/lib/jwt.js');
const { newId } = await import('../../../src/shared/ids.js');
const { issueSession } = await import('../../../src/modules/auth/session.service.js');

type ReportBody = {
  id: string;
  status: string;
  decision: string | null;
  resolved_by_id: string | null;
  resolved_at: string | null;
  target_person: { registered: boolean } | null;
  target_organization: { id: string; status: string } | null;
};

const REG = new Date('2026-01-01T00:00:00.000Z');
const REPORTER = '0199d013-0000-7000-8000-000000000001';
const TARGET = '0199d013-0000-7000-8000-000000000002';
const OWNER = '0199d013-0000-7000-8000-000000000003';
const ORG_ID = '0199d013-0000-7000-8000-000000000011';
const UNKNOWN_ID = '0199d013-0000-7000-8000-0000000000ff';

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
  await seedPerson(personId, `+23760014${String(adminSeq).padStart(4, '0')}`);
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

async function seedReport(
  target: { person?: string; organization?: string } = { person: TARGET },
  extra: Partial<{ status: 'PENDING' | 'RESOLVED'; decision: 'DISMISSED' | 'SUSPENSION' }> = {}
) {
  return prisma.report.create({
    data: {
      id: newId(),
      reporterId: REPORTER,
      targetPersonId: target.person ?? null,
      targetOrganizationId: target.organization ?? null,
      reason: 'Reason',
      description: 'Description',
      status: extra.status ?? 'PENDING',
      decision: extra.decision,
    },
  });
}

const resolve = (reportId: string, token: string | null, body: unknown) => {
  const r = request(app).post(`/api/v1/admin/reports/${reportId}/resolve`);
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body as object);
};

const device = { platform: 'ANDROID', app_version: '1.0.0' } as const;

beforeEach(async () => {
  await seedPerson(REPORTER, '+237600013001');
  await seedPerson(TARGET, '+237600013002');
  await seedPerson(OWNER, '+237600013003');
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

describe('POST /api/v1/admin/reports/{reportId}/resolve', () => {
  it('dismiss: the report is RESOLVED with DISMISSED and one DISMISS_REPORT row exists (AC-1, CM-33)', async () => {
    const admin = await seedAdmin();
    const report = await seedReport();

    const res = await resolve(report.id, admin.token, {
      decision: 'DISMISSED',
      reason: 'No abuse found',
    });

    expect(res.status).toBe(200);
    const body = bodyOf<ReportBody>(res);
    expect(body.status).toBe('RESOLVED');
    expect(body.decision).toBe('DISMISSED');
    expect(body.resolved_by_id).toBe(admin.administratorId);
    expect(body.resolved_at).not.toBeNull();
    const stored = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(stored.status).toBe('RESOLVED');
    expect(stored.resolvedById).toBe(admin.administratorId);
    expect(stored.resolvedAt).not.toBeNull();
    const rows = await prisma.adminAction.findMany({ where: { reportId: report.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'DISMISS_REPORT',
      administratorId: admin.administratorId,
      reason: 'No abuse found',
    });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: TARGET } })).status).toBe(
      'ACTIVE'
    );
  });

  it('suspend person: status, sessions revoked, scope_version, journal and notice (AC-2, CM-33)', async () => {
    const admin = await seedAdmin();
    const report = await seedReport();
    await issueSession(TARGET, device);
    await issueSession(TARGET, device);
    const before = await prisma.person.findUniqueOrThrow({ where: { id: TARGET } });

    const res = await resolve(report.id, admin.token, {
      decision: 'SUSPENSION',
      reason: 'Repeated abuse',
    });

    expect(res.status).toBe(200);
    expect(bodyOf<ReportBody>(res).decision).toBe('SUSPENSION');
    const person = await prisma.person.findUniqueOrThrow({ where: { id: TARGET } });
    expect(person.status).toBe('SUSPENDED');
    expect(person.scopeVersion).toBe(before.scopeVersion + 1);
    const tokens = await prisma.refreshToken.findMany({ where: { personId: TARGET } });
    expect(tokens).toHaveLength(2);
    expect(
      tokens.every((t) => t.revokedAt !== null && t.revokedReason === 'ACCOUNT_SUSPENDED')
    ).toBe(true);
    const devices = await prisma.device.findMany({ where: { personId: TARGET } });
    expect(devices.every((d) => d.revokedAt !== null)).toBe(true);
    const rows = await prisma.adminAction.findMany({ where: { reportId: report.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'SUSPEND',
      targetPersonId: TARGET,
      administratorId: admin.administratorId,
    });
    const notices = await prisma.notification.findMany({ where: { recipientId: TARGET } });
    expect(notices.map((n) => n.sourceEvent)).toEqual(['account.suspended']);
  });

  it('suspend organization: status, journal and owner notice (AC-3)', async () => {
    const admin = await seedAdmin();
    const report = await seedReport({ organization: ORG_ID });

    const res = await resolve(report.id, admin.token, {
      decision: 'SUSPENSION',
      reason: 'Fraudulent business',
    });

    expect(res.status).toBe(200);
    expect(bodyOf<ReportBody>(res).target_organization?.status).toBe('SUSPENDED');
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: ORG_ID } })).status).toBe(
      'SUSPENDED'
    );
    const rows = await prisma.adminAction.findMany({ where: { reportId: report.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'SUSPEND',
      targetOrganizationId: ORG_ID,
      targetPersonId: null,
    });
    const notices = await prisma.notification.findMany({ where: { recipientId: OWNER } });
    expect(notices.map((n) => n.sourceEvent)).toEqual(['account.suspended']);
    expect(notices[0]?.organizationId).toBe(ORG_ID);
  });

  it('an already SUSPENDED target stays suspended and the decision is recorded (CM-33)', async () => {
    const admin = await seedAdmin();
    await prisma.person.update({ where: { id: TARGET }, data: { status: 'SUSPENDED' } });
    const report = await seedReport();

    const res = await resolve(report.id, admin.token, { decision: 'SUSPENSION', reason: 'Again' });

    expect(res.status).toBe(200);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: TARGET } })).status).toBe(
      'SUSPENDED'
    );
    expect(await prisma.adminAction.count({ where: { reportId: report.id } })).toBe(1);
  });

  describe('refusals', () => {
    it('a report already RESOLVED gives 409 ALREADY_RESOLVED and nothing changes (AC-4)', async () => {
      const admin = await seedAdmin();
      const report = await seedReport(
        { person: TARGET },
        { status: 'RESOLVED', decision: 'DISMISSED' }
      );

      const res = await resolve(report.id, admin.token, {
        decision: 'SUSPENSION',
        reason: 'Too late',
      });

      expect(res.status).toBe(409);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('ALREADY_RESOLVED');
      expect((await prisma.person.findUniqueOrThrow({ where: { id: TARGET } })).status).toBe(
        'ACTIVE'
      );
      expect(await prisma.adminAction.count()).toBe(0);
    });

    it.each([
      ['an empty reason', { decision: 'DISMISSED', reason: '   ' }],
      ['a reason over 2000 characters', { decision: 'DISMISSED', reason: 'x'.repeat(2001) }],
      ['decision "BAN"', { decision: 'BAN', reason: 'Nope' }],
      ['an unknown field', { decision: 'DISMISSED', reason: 'Ok', status: 'PENDING' }],
    ])('%s gives 400 VALIDATION_ERROR and nothing changes (AC-4)', async (_name, body) => {
      const admin = await seedAdmin();
      const report = await seedReport();

      const res = await resolve(report.id, admin.token, body);

      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
      const stored = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
      expect(stored.status).toBe('PENDING');
      expect(await prisma.adminAction.count()).toBe(0);
    });

    it('an unknown report gives 404 NOT_FOUND (AC-4)', async () => {
      const admin = await seedAdmin();

      const res = await resolve(UNKNOWN_ID, admin.token, { decision: 'DISMISSED', reason: 'Ok' });

      expect(res.status).toBe(404);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    });

    it('an ANONYMIZED person target gives 409 TARGET_ANONYMIZED and nothing changes (AC-4, C-28)', async () => {
      const admin = await seedAdmin();
      await prisma.person.update({
        where: { id: TARGET },
        data: {
          status: 'ANONYMIZED',
          anonymizedAt: REG,
          phoneNumber: null,
          phoneVerifiedAt: null,
          releasedPhoneNumber: '+237600013002',
        },
      });
      const report = await seedReport();

      const res = await resolve(report.id, admin.token, { decision: 'SUSPENSION', reason: 'Ok' });

      expect(res.status).toBe(409);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('TARGET_ANONYMIZED');
      expect((await prisma.person.findUniqueOrThrow({ where: { id: TARGET } })).status).toBe(
        'ANONYMIZED'
      );
      expect((await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).status).toBe(
        'PENDING'
      );
      expect(await prisma.adminAction.count()).toBe(0);
    });
  });

  it('atomic: when the journal insert fails the report and the target are unchanged (AC-5, CWE-362)', async () => {
    const admin = await seedAdmin();
    const report = await seedReport();
    await issueSession(TARGET, device);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION adm013_fail() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'journal insert refused'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER adm013_fail BEFORE INSERT ON admin_actions
       FOR EACH ROW EXECUTE FUNCTION adm013_fail()`
    );
    try {
      const res = await resolve(report.id, admin.token, { decision: 'SUSPENSION', reason: 'Ok' });
      expect(res.status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER adm013_fail ON admin_actions');
      await prisma.$executeRawUnsafe('DROP FUNCTION adm013_fail()');
    }

    const stored = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(stored.status).toBe('PENDING');
    expect(stored.resolvedById).toBeNull();
    expect((await prisma.person.findUniqueOrThrow({ where: { id: TARGET } })).status).toBe(
      'ACTIVE'
    );
    const tokens = await prisma.refreshToken.findMany({ where: { personId: TARGET } });
    expect(tokens.every((t) => t.revokedAt === null)).toBe(true);
    expect(await prisma.notification.count({ where: { recipientId: TARGET } })).toBe(0);
  });

  it('trace: every suspension has a SUSPEND row with administrator, target, report and reason (AB-1, CWE-778)', async () => {
    const admin = await seedAdmin();
    const report = await seedReport();

    await resolve(report.id, admin.token, { decision: 'SUSPENSION', reason: 'Traceable reason' });

    const row = await prisma.adminAction.findFirstOrThrow({ where: { reportId: report.id } });
    expect(row).toMatchObject({
      action: 'SUSPEND',
      administratorId: admin.administratorId,
      targetPersonId: TARGET,
      reportId: report.id,
      reason: 'Traceable reason',
    });
  });

  it('two parallel resolutions: exactly one wins and one journal row exists (AC-4, CWE-362)', async () => {
    const admin = await seedAdmin();
    const report = await seedReport();

    const [a, b] = await Promise.all([
      resolve(report.id, admin.token, { decision: 'DISMISSED', reason: 'First' }),
      resolve(report.id, admin.token, { decision: 'SUSPENSION', reason: 'Second' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.adminAction.count({ where: { reportId: report.id } })).toBe(1);
  });

  it('customer token: 401 and nothing changes (AB-2, WSTG-ATHZ-03)', async () => {
    const report = await seedReport();
    const customer = signAccessToken({ personId: REPORTER, deviceId: newId() });

    const res = await resolve(report.id, customer, { decision: 'SUSPENSION', reason: 'Ok' });

    expect(res.status).toBe(401);
    expect((await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).status).toBe(
      'PENDING'
    );
    expect(await prisma.adminAction.count()).toBe(0);
  });

  it('no token: 401', async () => {
    const report = await seedReport();
    const res = await resolve(report.id, null, { decision: 'DISMISSED', reason: 'Ok' });
    expect(res.status).toBe(401);
  });
});
