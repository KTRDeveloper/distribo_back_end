import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { prisma } from '../../setup';

const { app } = await import('../../../src/app.js');
const { createTotpSecret, encryptSecret } = await import('../../../src/lib/totp.js');
const { signAdminToken, signAccessToken } = await import('../../../src/lib/jwt.js');
const { newId } = await import('../../../src/shared/ids.js');

type ReportItem = {
  id: string;
  reporter: { public_name: string | null; phone_number: string | null; registered: boolean };
  target_person: {
    public_name: string | null;
    phone_number: string | null;
    registered: boolean;
  } | null;
  target_organization: { id: string; name: string; status: string } | null;
  reason: string;
  description: string;
  status: string;
  decision: string | null;
  resolved_by_id: string | null;
  reported_at: string;
  resolved_at: string | null;
};
type ListBody = { items: ReportItem[]; next_cursor: string | null };

const REG = new Date('2026-01-01T00:00:00.000Z');
const REPORTER = '0199d012-0000-7000-8000-000000000001';
const TARGET = '0199d012-0000-7000-8000-000000000002';
const OWNER = '0199d012-0000-7000-8000-000000000003';
const ORG_ID = '0199d012-0000-7000-8000-000000000011';
const UNKNOWN_ID = '0199d012-0000-7000-8000-0000000000ff';

async function seedPerson(id: string, phone: string, name = 'Fixture Person') {
  await prisma.person.create({
    data: {
      id,
      fullName: name,
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

let adminSeq = 0;
async function seedAdmin(role: 'MODERATOR' | 'SUPER_ADMIN' = 'MODERATOR') {
  const personId = newId();
  adminSeq += 1;
  await seedPerson(personId, `+23760013${String(adminSeq).padStart(4, '0')}`, 'Fixture Admin');
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

let seq = 0;
async function seedReport(
  at: string,
  extra: Partial<{
    id: string;
    status: 'PENDING' | 'RESOLVED';
    targetPersonId: string | null;
    targetOrganizationId: string | null;
    decision: 'DISMISSED' | 'SUSPENSION';
    resolvedById: string;
    resolvedAt: Date;
  }> = {}
) {
  seq += 1;
  const orgTarget = extra.targetOrganizationId !== undefined && extra.targetOrganizationId !== null;
  return prisma.report.create({
    data: {
      id: extra.id ?? newId(),
      reporterId: REPORTER,
      targetPersonId: orgTarget ? null : (extra.targetPersonId ?? TARGET),
      targetOrganizationId: extra.targetOrganizationId ?? null,
      reason: `Reason ${seq}`,
      description: `Description ${seq}`,
      status: extra.status ?? 'PENDING',
      decision: extra.decision,
      resolvedById: extra.resolvedById,
      resolvedAt: extra.resolvedAt,
      reportedAt: new Date(at),
    },
  });
}

const get = (url: string, token: string | null) => {
  const r = request(app).get(url);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

beforeEach(async () => {
  await seedPerson(REPORTER, '+237600012001', 'Reporter Fixture');
  await seedPerson(TARGET, '+237600012002', 'Target Fixture');
  await seedPerson(OWNER, '+237600012003');
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

describe('GET /api/v1/admin/reports', () => {
  it('list: status=PENDING returns the pending reports oldest first (AC-1)', async () => {
    const admin = await seedAdmin();
    const p3 = await seedReport('2026-03-03T00:00:00.000Z');
    const p1 = await seedReport('2026-03-01T00:00:00.000Z');
    const p2 = await seedReport('2026-03-02T00:00:00.000Z');
    await seedReport('2026-03-04T00:00:00.000Z', {
      status: 'RESOLVED',
      decision: 'DISMISSED',
      resolvedById: admin.administratorId,
      resolvedAt: REG,
    });
    await seedReport('2026-03-05T00:00:00.000Z', {
      status: 'RESOLVED',
      decision: 'DISMISSED',
      resolvedById: admin.administratorId,
      resolvedAt: REG,
    });

    const res = await get('/api/v1/admin/reports?status=PENDING', admin.token);

    expect(res.status).toBe(200);
    const body = bodyOf<ListBody>(res);
    expect(body.items.map((i) => i.id)).toEqual([p1.id, p2.id, p3.id]);
    expect(body.next_cursor).toBeNull();
  });

  it('list: without a status filter, newest first and both statuses', async () => {
    const admin = await seedAdmin();
    const a = await seedReport('2026-03-01T00:00:00.000Z');
    const b = await seedReport('2026-03-02T00:00:00.000Z', {
      status: 'RESOLVED',
      decision: 'DISMISSED',
      resolvedById: admin.administratorId,
      resolvedAt: REG,
    });

    const res = await get('/api/v1/admin/reports', admin.token);

    expect(res.status).toBe(200);
    expect(bodyOf<ListBody>(res).items.map((i) => i.id)).toEqual([b.id, a.id]);
  });

  it('list: status=RESOLVED is newest first and only resolved', async () => {
    const admin = await seedAdmin();
    await seedReport('2026-03-01T00:00:00.000Z');
    const r1 = await seedReport('2026-03-02T00:00:00.000Z', {
      status: 'RESOLVED',
      decision: 'DISMISSED',
      resolvedById: admin.administratorId,
      resolvedAt: REG,
    });
    const r2 = await seedReport('2026-03-03T00:00:00.000Z', {
      status: 'RESOLVED',
      decision: 'SUSPENSION',
      resolvedById: admin.administratorId,
      resolvedAt: REG,
    });

    const res = await get('/api/v1/admin/reports?status=RESOLVED', admin.token);

    expect(bodyOf<ListBody>(res).items.map((i) => i.id)).toEqual([r2.id, r1.id]);
  });

  it('list: pages with limit and cursor, with no repeat and no gap (project rules)', async () => {
    const admin = await seedAdmin();
    const ids: string[] = [];
    for (const day of ['01', '02', '03', '04', '05']) {
      ids.push((await seedReport(`2026-03-${day}T00:00:00.000Z`)).id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const url: string = `/api/v1/admin/reports?status=PENDING&limit=2${
        cursor ? `&cursor=${cursor}` : ''
      }`;
      const res = await get(url, admin.token);
      expect(res.status).toBe(200);
      const body = bodyOf<ListBody>(res);
      seen.push(...body.items.map((i) => i.id));
      cursor = body.next_cursor;
    }

    expect(seen).toEqual(ids);
    expect(cursor).toBeNull();
  });

  it('list: an unknown status, a limit above 100, a bad cursor or an unknown parameter is 400', async () => {
    const admin = await seedAdmin();
    for (const qs of ['status=OTHER', 'limit=101', 'limit=0', 'cursor=!!', 'foo=1']) {
      const res = await get(`/api/v1/admin/reports?${qs}`, admin.token);
      expect(res.status, qs).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('GET /api/v1/admin/reports/{reportId}', () => {
  it('open: shows the reporter, the person target and the text with explicit fields (AC-2)', async () => {
    const admin = await seedAdmin();
    const report = await seedReport('2026-03-01T00:00:00.000Z');

    const res = await get(`/api/v1/admin/reports/${report.id}`, admin.token);

    expect(res.status).toBe(200);
    const item = bodyOf<ReportItem>(res);
    expect(Object.keys(item).sort()).toEqual([
      'decision',
      'description',
      'id',
      'reason',
      'reported_at',
      'reporter',
      'resolved_at',
      'resolved_by_id',
      'status',
      'target_organization',
      'target_person',
    ]);
    expect(item).toMatchObject({
      id: report.id,
      reporter: {
        public_name: 'Reporter Fixture',
        phone_number: '+237600012001',
        registered: true,
      },
      target_person: {
        public_name: 'Target Fixture',
        phone_number: '+237600012002',
        registered: true,
      },
      target_organization: null,
      reason: report.reason,
      description: report.description,
      status: 'PENDING',
      decision: null,
      resolved_by_id: null,
      reported_at: '2026-03-01T00:00:00.000Z',
      resolved_at: null,
    });
    expect(Object.keys(item.reporter).sort()).toEqual([
      'phone_number',
      'public_name',
      'registered',
    ]);
  });

  it('open: an organization target shows id, name and status; a resolved report its decision', async () => {
    const admin = await seedAdmin();
    const resolvedAt = new Date('2026-03-09T00:00:00.000Z');
    const report = await seedReport('2026-03-01T00:00:00.000Z', {
      targetOrganizationId: ORG_ID,
      status: 'RESOLVED',
      decision: 'DISMISSED',
      resolvedById: admin.administratorId,
      resolvedAt,
    });

    const res = await get(`/api/v1/admin/reports/${report.id}`, admin.token);

    expect(res.status).toBe(200);
    expect(bodyOf<ReportItem>(res)).toMatchObject({
      target_person: null,
      target_organization: { id: ORG_ID, name: 'Fixture Org', status: 'ACTIVE' },
      status: 'RESOLVED',
      decision: 'DISMISSED',
      resolved_by_id: admin.administratorId,
      resolved_at: resolvedAt.toISOString(),
    });
  });

  it('unknown id: a missing report is 404 and a malformed id is 400 (AC-4)', async () => {
    const admin = await seedAdmin();

    const missing = await get(`/api/v1/admin/reports/${UNKNOWN_ID}`, admin.token);
    const malformed = await get('/api/v1/admin/reports/not-a-uuid', admin.token);

    expect(missing.status).toBe(404);
    expect(bodyOf<ErrorBody>(missing).error.code).toBe('NOT_FOUND');
    expect(malformed.status).toBe(400);
    expect(bodyOf<ErrorBody>(malformed).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('access', () => {
  it.each([
    ['an admin token', 200],
    ['a normal access token', 401],
    ['no token', 401],
  ])('%s: list and open answer %i (AC-3)', async (label, status) => {
    const admin = await seedAdmin();
    const report = await seedReport('2026-03-01T00:00:00.000Z');
    const token =
      label === 'an admin token'
        ? admin.token
        : label === 'no token'
          ? null
          : signAccessToken({
              personId: REPORTER,
              deviceId: '018f0000-0000-7000-8000-000000000001',
            });

    const list = await get('/api/v1/admin/reports', token);
    const open = await get(`/api/v1/admin/reports/${report.id}`, token);

    expect(list.status).toBe(status);
    expect(open.status).toBe(status);
  });

  it('a removed administrator is refused at once (v5.0.0-8.2.1)', async () => {
    const admin = await seedAdmin();
    await prisma.administrator.update({
      where: { id: admin.administratorId },
      data: { removedAt: new Date() },
    });

    const res = await get('/api/v1/admin/reports', admin.token);

    expect(res.status).toBe(401);
  });

  it('a customer token never returns a report (AB-1, WSTG-ATHZ-03)', async () => {
    await seedReport('2026-03-01T00:00:00.000Z');
    const customer = signAccessToken({
      personId: TARGET,
      deviceId: '018f0000-0000-7000-8000-000000000001',
    });

    const res = await get('/api/v1/admin/reports', customer);

    expect(res.status).toBe(401);
    expect(res.text).not.toContain('Description');
    expect(res.text).not.toContain('items');
  });
});
