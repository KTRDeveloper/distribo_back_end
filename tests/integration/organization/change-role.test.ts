import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c009-0000-7000-8000-000000000001';
const MANAGER = '0199c009-0000-7000-8000-000000000002';
const SELLER = '0199c009-0000-7000-8000-000000000003';
const DRIVER = '0199c009-0000-7000-8000-000000000004';
const INVITED_PERSON = '0199c009-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c009-0000-7000-8000-000000000006';
const REVOKED_PERSON = '0199c009-0000-7000-8000-000000000007';

const ORG_A = '0199c009-0000-7000-8000-0000000000a1';
const ORG_B = '0199c009-0000-7000-8000-0000000000b1';

const OWNER_ROW = '0199c009-0000-7000-8000-0000000000a9';
const MANAGER_ROW = '0199c009-0000-7000-8000-0000000000a2';
const SELLER_ROW = '0199c009-0000-7000-8000-0000000000a3';
const DRIVER_ROW = '0199c009-0000-7000-8000-0000000000a4';
const INVITED_ROW = '0199c009-0000-7000-8000-0000000000a5';
const REVOKED_ROW = '0199c009-0000-7000-8000-0000000000a7';
const OTHER_OWNER_ROW = '0199c009-0000-7000-8000-0000000000b9';

const REG = new Date('2026-01-01T00:00:00.000Z');

type View = {
  id: string;
  person: { public_name: string | null; phone_number: string | null; registered: boolean };
  role: string;
  status: string;
  invited_at: string;
};

async function seedPerson(id: string, phone: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      ...(registered
        ? { phoneVerifiedAt: REG, passwordHash: 'test-password-hash', registeredAt: REG }
        : {}),
    },
  });
}

async function seedCollaboration(
  id: string,
  personId: string,
  organizationId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  status: 'ACTIVE' | 'INVITED' | 'REVOKED'
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

function patch(orgId: string, collaborationId: string, body: unknown, personId = OWNER) {
  return createAuthenticatedRequest(app, personId)
    .patch(`/api/v1/organizations/${orgId}/collaborators/${collaborationId}`)
    .send(body as object);
}

async function scopeVersionOf(personId: string) {
  return (await prisma.person.findUniqueOrThrow({ where: { id: personId } })).scopeVersion;
}

async function roleOf(collaborationId: string) {
  return (await prisma.collaboration.findUniqueOrThrow({ where: { id: collaborationId } })).role;
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009001');
  await seedPerson(MANAGER, '+237600009002');
  await seedPerson(SELLER, '+237600009003');
  await seedPerson(DRIVER, '+237600009004');
  await seedPerson(INVITED_PERSON, '+237600009005', false);
  await seedPerson(OTHER_OWNER, '+237600009006');
  await seedPerson(REVOKED_PERSON, '+237600009007');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B' } });
  await seedCollaboration(OWNER_ROW, OWNER, ORG_A, 'OWNER', 'ACTIVE');
  await seedCollaboration(MANAGER_ROW, MANAGER, ORG_A, 'MANAGER', 'ACTIVE');
  await seedCollaboration(SELLER_ROW, SELLER, ORG_A, 'SELLER', 'ACTIVE');
  await seedCollaboration(DRIVER_ROW, DRIVER, ORG_A, 'DRIVER', 'ACTIVE');
  await seedCollaboration(INVITED_ROW, INVITED_PERSON, ORG_A, 'SELLER', 'INVITED');
  await seedCollaboration(REVOKED_ROW, REVOKED_PERSON, ORG_A, 'SELLER', 'REVOKED');
  await seedCollaboration(OTHER_OWNER_ROW, OTHER_OWNER, ORG_B, 'OWNER', 'ACTIVE');
});

describe('PATCH /api/v1/organizations/:organizationId/collaborators/:collaborationId', () => {
  it('AC-1 changes SELLER to MANAGER: 200, scope_version +1, collaborator notified', async () => {
    const before = await scopeVersionOf(SELLER);

    const response = await patch(ORG_A, SELLER_ROW, { role: 'MANAGER' });

    expect(response.status).toBe(200);
    const body = bodyOf<View>(response);
    expect(Object.keys(body).sort()).toEqual(['id', 'invited_at', 'person', 'role', 'status']);
    expect(body).toMatchObject({
      id: SELLER_ROW,
      role: 'MANAGER',
      status: 'ACTIVE',
      person: { phone_number: '+237600009003', registered: true },
    });
    expect(await roleOf(SELLER_ROW)).toBe('MANAGER');
    expect(await scopeVersionOf(SELLER)).toBe(before + 1);
    const rows = await prisma.notification.findMany({ where: { recipientId: SELLER } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceEvent: 'collaboration.role_changed',
      readStatus: 'UNREAD',
      organizationId: ORG_A,
      relatedEntityType: 'collaboration',
      relatedEntityId: SELLER_ROW,
    });
  });

  it('AC-2 refuses the OWNER row with 409 OWNER_PROTECTED and changes nothing', async () => {
    const before = await scopeVersionOf(OWNER);

    const response = await patch(ORG_A, OWNER_ROW, { role: 'MANAGER' });

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('OWNER_PROTECTED');
    expect(await roleOf(OWNER_ROW)).toBe('OWNER');
    expect(await scopeVersionOf(OWNER)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-2 refuses role OWNER in the body with 400 VALIDATION_ERROR', async () => {
    const response = await patch(ORG_A, SELLER_ROW, { role: 'OWNER' });

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await roleOf(SELLER_ROW)).toBe('SELLER');
  });

  it('AC-2 answers 404 for a REVOKED collaborator and changes nothing', async () => {
    const before = await scopeVersionOf(REVOKED_PERSON);

    const response = await patch(ORG_A, REVOKED_ROW, { role: 'DRIVER' });

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await roleOf(REVOKED_ROW)).toBe('SELLER');
    expect(await scopeVersionOf(REVOKED_PERSON)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-2 answers 404 for a collaboration of another business and changes nothing', async () => {
    const response = await patch(ORG_A, OTHER_OWNER_ROW, { role: 'MANAGER' });

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await roleOf(OTHER_OWNER_ROW)).toBe('OWNER');
  });

  it('answers 404 for an unknown collaboration', async () => {
    const response = await patch(ORG_A, '0199c009-0000-7000-8000-0000000000ff', {
      role: 'MANAGER',
    });
    expect(response.status).toBe(404);
  });

  it('answers 400 for a malformed collaboration id', async () => {
    const response = await patch(ORG_A, 'not-a-uuid', { role: 'MANAGER' });
    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('AC-3 changes the role of an INVITED target without a scope bump or notification', async () => {
    const before = await scopeVersionOf(INVITED_PERSON);

    const response = await patch(ORG_A, INVITED_ROW, { role: 'DRIVER' });

    expect(response.status).toBe(200);
    expect(bodyOf<View>(response)).toMatchObject({ role: 'DRIVER', status: 'INVITED' });
    expect(await roleOf(INVITED_ROW)).toBe('DRIVER');
    expect(await scopeVersionOf(INVITED_PERSON)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('requires authentication', async () => {
    const { default: request } = await import('supertest');
    const response = await request(app)
      .patch(`/api/v1/organizations/${ORG_A}/collaborators/${SELLER_ROW}`)
      .send({ role: 'MANAGER' });
    expect(response.status).toBe(401);
  });
});

describe('security', () => {
  it.each([
    ['MANAGER on their own row', MANAGER, MANAGER_ROW],
    ['MANAGER on another row', MANAGER, SELLER_ROW],
    ['SELLER on their own row', SELLER, SELLER_ROW],
    ['DRIVER on another row', DRIVER, SELLER_ROW],
  ])('AB-1 %s gets 403 and nothing changes', async (_label, personId, rowId) => {
    const roleBefore = await roleOf(rowId);

    const response = await patch(ORG_A, rowId, { role: 'DRIVER' }, personId);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await roleOf(rowId)).toBe(roleBefore);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('an owner of business B patching business A gets 404', async () => {
    const response = await patch(ORG_A, SELLER_ROW, { role: 'MANAGER' }, OTHER_OWNER);
    expect(response.status).toBe(404);
    expect(await roleOf(SELLER_ROW)).toBe('SELLER');
  });

  it.each([
    ['status', { status: 'REVOKED' }],
    ['person_id', { person_id: OWNER }],
    ['amount_held', { amount_held: 100 }],
    ['id', { id: '0199c009-0000-7000-8000-0000000000c1' }],
  ])('AB-2 rejects mass assignment of %s with 400', async (_label, extra) => {
    const before = await scopeVersionOf(SELLER);

    const response = await patch(ORG_A, SELLER_ROW, { role: 'MANAGER', ...extra });

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await roleOf(SELLER_ROW)).toBe('SELLER');
    expect(await scopeVersionOf(SELLER)).toBe(before);
  });

  it('rejects a missing role with 400', async () => {
    const response = await patch(ORG_A, SELLER_ROW, {});
    expect(response.status).toBe(400);
  });
});
