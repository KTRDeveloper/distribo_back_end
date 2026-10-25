import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody, type OpenApiDoc } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c005-0000-7000-8000-000000000001';
const MANAGER = '0199c005-0000-7000-8000-000000000002';
const ORG = '0199c005-0000-7000-8000-0000000000a1';
const SUB = '0199c005-0000-7000-8000-0000000000c1';
const GESTURE = '0199c005-0000-7000-8000-0000000000e1';

const REG = new Date('2026-01-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const URL = `/api/v1/organizations/${ORG}/subscription`;

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

async function seedCollaboration(
  id: string,
  personId: string,
  role: 'OWNER' | 'MANAGER'
): Promise<void> {
  await prisma.collaboration.create({
    data: { id, personId, organizationId: ORG, role, status: 'ACTIVE', acceptedAt: REG },
  });
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600005001');
  await seedPerson(MANAGER, '+237600005002');
  await prisma.organization.create({ data: { id: ORG, name: 'Org' } });
  await seedCollaboration('0199c005-0000-7000-8000-0000000000a9', OWNER, 'OWNER');
  await seedCollaboration('0199c005-0000-7000-8000-0000000000a2', MANAGER, 'MANAGER');
  await prisma.subscription.create({
    data: {
      id: SUB,
      organizationId: ORG,
      plan: 'BASIC',
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - DAY_MS),
      endsAt: new Date(Date.now() + 30 * DAY_MS),
    },
  });
});

describe('the subscription routes are removed', () => {
  it('AC-1 POST, DELETE and GET answer 404 NOT_FOUND and no row changes', async () => {
    const before = await prisma.subscription.findMany();

    const post = await createAuthenticatedRequest(app, OWNER)
      .post(URL)
      .send({ id: GESTURE, plan: 'PRO' });
    const del = await createAuthenticatedRequest(app, OWNER).delete(URL);
    const get = await createAuthenticatedRequest(app, MANAGER).get(URL);

    for (const response of [post, del, get]) {
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
    expect(await prisma.subscription.findMany()).toEqual(before);
  });

  it('AC-2 the owner closes the business: 200, CLOSED and the team is revoked', async () => {
    const response = await createAuthenticatedRequest(app, OWNER)
      .post(`/api/v1/organizations/${ORG}/close`)
      .send({ id: GESTURE });

    expect(response.status).toBe(200);
    expect(bodyOf<{ status: string }>(response)).toEqual({ status: 'CLOSED' });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: ORG } })).status).toBe(
      'CLOSED'
    );
    const manager = await prisma.collaboration.findFirstOrThrow({ where: { personId: MANAGER } });
    expect(manager.status).toBe('REVOKED');
  });

  it('AC-3 the documentation lists no path ending with /subscription', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');

    expect(response.status).toBe(200);
    const paths = Object.keys(bodyOf<OpenApiDoc>(response).paths);
    expect(paths.filter((path) => path.endsWith('/subscription'))).toEqual([]);
  });

  it('AB-1 an OWNER and a MANAGER cannot set a plan: 404, count unchanged, plan FREE', async () => {
    const countBefore = await prisma.subscription.count();

    for (const person of [OWNER, MANAGER]) {
      const response = await createAuthenticatedRequest(app, person)
        .post(URL)
        .send({ id: GESTURE, plan: 'ENTERPRISE' });

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }

    expect(await prisma.subscription.count()).toBe(countBefore);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: ORG } })).plan).toBe('FREE');
  });
});
