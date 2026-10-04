import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c017-0000-7000-8000-000000000001';
const MANAGER = '0199c017-0000-7000-8000-000000000002';
const OTHER_OWNER = '0199c017-0000-7000-8000-000000000006';

const ORG_A = '0199c017-0000-7000-8000-0000000000a1';
const ORG_B = '0199c017-0000-7000-8000-0000000000b1';

const OWNER_ROW = '0199c017-0000-7000-8000-0000000000a9';
const MANAGER_ROW = '0199c017-0000-7000-8000-0000000000a2';
const OTHER_OWNER_ROW = '0199c017-0000-7000-8000-0000000000b9';

const SUB_A = '0199c017-0000-7000-8000-0000000000d1';

const GESTURE = '0199c017-0000-7000-8000-0000000000c1';

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

async function seedCollaboration(
  id: string,
  personId: string,
  organizationId: string,
  role: 'OWNER' | 'MANAGER',
  status: 'ACTIVE' | 'REVOKED'
) {
  await prisma.collaboration.create({
    data: {
      id,
      personId,
      organizationId,
      role,
      status,
      acceptedAt: status === 'ACTIVE' ? REG : null,
    },
  });
}

function reopen(orgId: string, body: Record<string, unknown> = { id: GESTURE }, personId = OWNER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/reopen`)
    .send(body);
}

function statusOf(orgId: string) {
  return prisma.organization.findUniqueOrThrow({ where: { id: orgId } }).then((org) => org.status);
}

function rowOf(id: string) {
  return prisma.collaboration.findUniqueOrThrow({ where: { id } });
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600170001');
  await seedPerson(MANAGER, '+237600170002');
  await seedPerson(OTHER_OWNER, '+237600170006');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A', status: 'CLOSED' } });
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B', status: 'CLOSED' } });
  await seedCollaboration(OWNER_ROW, OWNER, ORG_A, 'OWNER', 'ACTIVE');
  await seedCollaboration(MANAGER_ROW, MANAGER, ORG_A, 'MANAGER', 'REVOKED');
  await seedCollaboration(OTHER_OWNER_ROW, OTHER_OWNER, ORG_B, 'OWNER', 'ACTIVE');
  await prisma.subscription.create({
    data: {
      id: SUB_A,
      organizationId: ORG_A,
      plan: 'BASIC',
      status: 'EXPIRED',
      startsAt: new Date('2026-02-01T00:00:00.000Z'),
      endsAt: new Date('2026-03-01T00:00:00.000Z'),
    },
  });
});

describe('POST /api/v1/organizations/:organizationId/reopen', () => {
  it('AC-1 reopen: 200, ACTIVE, revoked collaborators and the subscription stay as they were', async () => {
    const response = await reopen(ORG_A);

    expect(response.status).toBe(200);
    expect(bodyOf<{ status: string }>(response)).toEqual({ status: 'ACTIVE' });
    expect(await statusOf(ORG_A)).toBe('ACTIVE');
    expect((await rowOf(MANAGER_ROW)).status).toBe('REVOKED');
    expect((await rowOf(OWNER_ROW)).status).toBe('ACTIVE');
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: SUB_A } })).status).toBe(
      'EXPIRED'
    );
    expect(await statusOf(ORG_B)).toBe('CLOSED');
  });

  it.each(['ACTIVE', 'SUSPENDED'] as const)(
    'AC-2 refusal: %s answers 409 ORGANIZATION_NOT_CLOSED and changes nothing',
    async (status) => {
      await prisma.organization.update({ where: { id: ORG_A }, data: { status } });

      const response = await reopen(ORG_A);

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_CLOSED');
      expect(await statusOf(ORG_A)).toBe(status);
    }
  );

  it.each([
    ['a missing gesture id', {}],
    ['a malformed gesture id', { id: 'nope' }],
    ['an unknown field', { id: GESTURE, status: 'ACTIVE' }],
  ])('%s: 400 VALIDATION_ERROR and nothing changes', async (_label, body) => {
    const response = await reopen(ORG_A, body);

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await statusOf(ORG_A)).toBe('CLOSED');
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${ORG_A}/reopen`)
      .send({ id: GESTURE });
    expect(response.status).toBe(401);
  });
});

describe('security', () => {
  it('AB-1 the owner cannot lift a moderation suspension: 409 and it stays SUSPENDED', async () => {
    await prisma.organization.update({ where: { id: ORG_A }, data: { status: 'SUSPENDED' } });

    const response = await reopen(ORG_A);

    expect(response.status).toBe(409);
    expect(await statusOf(ORG_A)).toBe('SUSPENDED');
  });

  it('AB-2 a MANAGER gets 403 and the status is unchanged', async () => {
    await prisma.collaboration.update({ where: { id: MANAGER_ROW }, data: { status: 'ACTIVE' } });

    const response = await reopen(ORG_A, { id: GESTURE }, MANAGER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await statusOf(ORG_A)).toBe('CLOSED');
  });
});
