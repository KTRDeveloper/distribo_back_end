import { beforeEach, describe, expect, it, vi } from 'vitest';

const limiter = vi.hoisted(() => ({ counts: new Map<string, number>(), keys: [] as string[] }));

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: vi.fn((key: string, limit: number) => {
    limiter.keys.push(key);
    const count = (limiter.counts.get(key) ?? 0) + 1;
    limiter.counts.set(key, count);
    return Promise.resolve({ allowed: count <= limit, remaining: Math.max(limit - count, 0) });
  }),
  resetKey: vi.fn(() => Promise.resolve()),
}));

import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

type ReportBody = { id: string; status: string; reported_at: string };

const REPORTER = '0199d011-0000-7000-8000-000000000001';
const OTHER = '0199d011-0000-7000-8000-000000000002';
const OWNER = '0199d011-0000-7000-8000-000000000003';
const ORG_ID = '0199d011-0000-7000-8000-000000000011';
const UNKNOWN_ID = '0199d011-0000-7000-8000-0000000000ff';
const REG = new Date('2026-01-01T00:00:00.000Z');

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

/** Creates an organization with its ACTIVE OWNER in one statement (the owner rule is checked at commit). */
async function seedOrg(id: string, ownerId: string) {
  await prisma.organization.create({
    data: {
      id,
      name: 'Fixture Org',
      collaborations: {
        create: {
          id: newId(),
          personId: ownerId,
          role: 'OWNER',
          status: 'ACTIVE',
          acceptedAt: REG,
        },
      },
    },
  });
}

function post(body: object, personId = REPORTER) {
  return createAuthenticatedRequest(app, personId).post('/api/v1/reports').send(body);
}

const personReport = (extra: object = {}) => ({
  id: newId(),
  target_person_id: OTHER,
  reason: 'Abuse',
  description: 'Sent threatening messages',
  ...extra,
});

const reportCount = () => prisma.report.count();

beforeEach(async () => {
  limiter.counts.clear();
  limiter.keys.length = 0;
  await seedPerson(REPORTER, '+237600011001');
  await seedPerson(OTHER, '+237600011002');
  await seedPerson(OWNER, '+237600011003');
  await seedOrg(ORG_ID, OWNER);
});

describe('POST /api/v1/reports', () => {
  it('report person: stores a PENDING report with the caller as reporter (AC-1, C-28)', async () => {
    const body = personReport();

    const response = await post(body);

    expect(response.status).toBe(201);
    const view = bodyOf<ReportBody>(response);
    expect(Object.keys(view).sort()).toEqual(['id', 'reported_at', 'status']);
    expect(view.id).toBe(body.id);
    expect(view.status).toBe('PENDING');
    const row = await prisma.report.findUniqueOrThrow({ where: { id: body.id } });
    expect(row).toMatchObject({
      reporterId: REPORTER,
      targetPersonId: OTHER,
      targetOrganizationId: null,
      status: 'PENDING',
      reason: 'Abuse',
      description: 'Sent threatening messages',
      resolvedById: null,
      decision: null,
    });
    expect(view.reported_at).toBe(row.reportedAt.toISOString());
  });

  it('report organization: stores a PENDING report on the organization (AC-2)', async () => {
    const id = newId();

    const response = await post({
      id,
      target_organization_id: ORG_ID,
      reason: 'Fraud',
      description: 'Sells fake goods',
    });

    expect(response.status).toBe(201);
    const row = await prisma.report.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      reporterId: REPORTER,
      targetPersonId: null,
      targetOrganizationId: ORG_ID,
      status: 'PENDING',
    });
  });

  it('a member who is not the owner may report the organization (AC-2)', async () => {
    await prisma.collaboration.create({
      data: {
        id: newId(),
        personId: REPORTER,
        organizationId: ORG_ID,
        role: 'MANAGER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });

    const response = await post({
      id: newId(),
      target_organization_id: ORG_ID,
      reason: 'Fraud',
      description: 'Sells fake goods',
    });

    expect(response.status).toBe(201);
  });

  describe('refusals (AC-3)', () => {
    const refused = async (body: object, status: number, code: string, personId = REPORTER) => {
      const response = await post(body, personId);
      expect(response.status).toBe(status);
      expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
      expect(await reportCount()).toBe(0);
    };

    it('both targets: 400 VALIDATION_ERROR', async () => {
      await refused(personReport({ target_organization_id: ORG_ID }), 400, 'VALIDATION_ERROR');
    });

    it('no target: 400 VALIDATION_ERROR', async () => {
      await refused(
        { id: newId(), reason: 'Abuse', description: 'Details' },
        400,
        'VALIDATION_ERROR'
      );
    });

    it('unknown person: 404 NOT_FOUND', async () => {
      await refused(personReport({ target_person_id: UNKNOWN_ID }), 404, 'NOT_FOUND');
    });

    it('unknown organization: 404 NOT_FOUND', async () => {
      const body = {
        id: newId(),
        target_organization_id: UNKNOWN_ID,
        reason: 'Abuse',
        description: 'Details',
      };
      await refused(body, 404, 'NOT_FOUND');
    });

    it('the caller as target: 400 VALIDATION_ERROR', async () => {
      await refused(personReport({ target_person_id: REPORTER }), 400, 'VALIDATION_ERROR');
    });

    it("the caller's own organization as its owner: 400 VALIDATION_ERROR", async () => {
      const body = {
        id: newId(),
        target_organization_id: ORG_ID,
        reason: 'Abuse',
        description: 'Details',
      };
      await refused(body, 400, 'VALIDATION_ERROR', OWNER);
    });

    it.each([
      ['empty reason', { reason: '' }],
      ['blank reason', { reason: '   ' }],
      ['empty description', { description: '' }],
      ['reason over 100', { reason: 'r'.repeat(101) }],
      ['description over 2000', { description: 'd'.repeat(2001) }],
      ['unknown field', { note: 'x' }],
      ['non UUIDv7 id', { id: 'not-a-uuid' }],
    ])('%s: 400 VALIDATION_ERROR', async (_name, extra) => {
      await refused(personReport(extra), 400, 'VALIDATION_ERROR');
    });

    it('accepts the maximum lengths', async () => {
      const response = await post(
        personReport({ reason: 'r'.repeat(100), description: 'd'.repeat(2000) })
      );
      expect(response.status).toBe(201);
    });

    it('an unauthenticated request: 401', async () => {
      const response = await post(personReport()).set('Authorization', 'Bearer nope');
      expect(response.status).toBe(401);
      expect(await reportCount()).toBe(0);
    });

    it('an 11th report in one day: 429 RATE_LIMITED, nothing stored (AB-2)', async () => {
      for (let i = 0; i < 10; i += 1) {
        expect((await post(personReport())).status).toBe(201);
      }

      const eleventh = await post(personReport());

      expect(eleventh.status).toBe(429);
      expect(bodyOf<ErrorBody>(eleventh).error.code).toBe('RATE_LIMITED');
      expect(await reportCount()).toBe(10);
    });

    it('the limit is per person (AB-2)', async () => {
      limiter.counts.set(`report:${REPORTER}`, 10);

      const other = await post(personReport({ target_person_id: REPORTER }), OTHER);

      expect(other.status).toBe(201);
    });
  });

  it('repeat: the same id twice stores one report and returns the first answer (AC-4)', async () => {
    const body = personReport();

    const first = await post(body);
    const second = await post(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await reportCount()).toBe(1);
    expect(limiter.counts.get(`report:${REPORTER}`)).toBe(1);
  });

  describe('server fields (AB-1, CWE-915)', () => {
    it.each([
      ['status', { status: 'RESOLVED' }],
      ['decision', { decision: 'DISMISSED' }],
      ['resolved_by_id', { resolved_by_id: OTHER }],
      ['reporter_id', { reporter_id: OTHER }],
    ])('a body carrying %s: 400, nothing stored', async (_name, extra) => {
      const response = await post(personReport(extra));

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await reportCount()).toBe(0);
    });
  });
});
