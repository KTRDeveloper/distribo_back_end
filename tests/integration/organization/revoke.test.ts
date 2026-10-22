import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c010-0000-7000-8000-000000000001';
const MANAGER = '0199c010-0000-7000-8000-000000000002';
const SELLER = '0199c010-0000-7000-8000-000000000003';
const INVITED_PERSON = '0199c010-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c010-0000-7000-8000-000000000006';
const REVOKED_PERSON = '0199c010-0000-7000-8000-000000000007';

const ORG_A = '0199c010-0000-7000-8000-0000000000a1';
const ORG_B = '0199c010-0000-7000-8000-0000000000b1';

const OWNER_ROW = '0199c010-0000-7000-8000-0000000000a9';
const MANAGER_ROW = '0199c010-0000-7000-8000-0000000000a2';
const SELLER_ROW = '0199c010-0000-7000-8000-0000000000a3';
const INVITED_ROW = '0199c010-0000-7000-8000-0000000000a5';
const REVOKED_ROW = '0199c010-0000-7000-8000-0000000000a7';
const OTHER_OWNER_ROW = '0199c010-0000-7000-8000-0000000000b9';

const REG = new Date('2026-01-01T00:00:00.000Z');

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
  status: 'ACTIVE' | 'INVITED' | 'REVOKED',
  extra: { amountHeld?: bigint } = {}
) {
  await prisma.collaboration.create({
    data: {
      id,
      personId,
      organizationId,
      role,
      status,
      acceptedAt: status === 'ACTIVE' ? REG : null,
      ...extra,
    },
  });
}

function revoke(orgId: string, collaborationId: string, personId = OWNER) {
  return createAuthenticatedRequest(app, personId).delete(
    `/api/v1/organizations/${orgId}/collaborators/${collaborationId}`
  );
}

async function scopeVersionOf(personId: string) {
  return (await prisma.person.findUniqueOrThrow({ where: { id: personId } })).scopeVersion;
}

function rowOf(id: string) {
  return prisma.collaboration.findUniqueOrThrow({ where: { id } });
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600010001');
  await seedPerson(MANAGER, '+237600010002');
  await seedPerson(SELLER, '+237600010003');
  await seedPerson(INVITED_PERSON, '+237600010005', false);
  await seedPerson(OTHER_OWNER, '+237600010006');
  await seedPerson(REVOKED_PERSON, '+237600010007');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B' } });
  await seedCollaboration(OWNER_ROW, OWNER, ORG_A, 'OWNER', 'ACTIVE');
  await seedCollaboration(MANAGER_ROW, MANAGER, ORG_A, 'MANAGER', 'ACTIVE');
  await seedCollaboration(SELLER_ROW, SELLER, ORG_A, 'SELLER', 'ACTIVE', {
    amountHeld: 12500n,
  });
  await seedCollaboration(INVITED_ROW, INVITED_PERSON, ORG_A, 'SELLER', 'INVITED');
  await seedCollaboration(REVOKED_ROW, REVOKED_PERSON, ORG_A, 'SELLER', 'REVOKED');
  await seedCollaboration(OTHER_OWNER_ROW, OTHER_OWNER, ORG_B, 'OWNER', 'ACTIVE');
});

describe('DELETE /api/v1/organizations/:organizationId/collaborators/:collaborationId', () => {
  it('AC-1 revoke: 204, REVOKED, scope_version +1, collaborator notified', async () => {
    const before = await scopeVersionOf(SELLER);

    const response = await revoke(ORG_A, SELLER_ROW);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    const row = await rowOf(SELLER_ROW);
    expect(row.status).toBe('REVOKED');
    expect(await scopeVersionOf(SELLER)).toBe(before + 1);
    const notes = await prisma.notification.findMany({ where: { recipientId: SELLER } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      sourceEvent: 'collaboration.revoked',
      organizationId: ORG_A,
      relatedEntityType: 'collaboration',
      relatedEntityId: SELLER_ROW,
    });
  });

  it('AC-1 revokes an INVITED row without a scope bump or notification', async () => {
    const before = await scopeVersionOf(INVITED_PERSON);

    const response = await revoke(ORG_A, INVITED_ROW);

    expect(response.status).toBe(204);
    expect((await rowOf(INVITED_ROW)).status).toBe('REVOKED');
    expect(await scopeVersionOf(INVITED_PERSON)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-2 the revoked person gets 404 on the next organization call', async () => {
    const own = await createAuthenticatedRequest(app, SELLER).get(`/api/v1/organizations/${ORG_A}`);
    expect(own.status).toBe(200);

    expect((await revoke(ORG_A, SELLER_ROW)).status).toBe(204);

    const after = await createAuthenticatedRequest(app, SELLER).get(
      `/api/v1/organizations/${ORG_A}`
    );
    expect(after.status).toBe(404);
    expect(bodyOf<ErrorBody>(after).error.code).toBe('NOT_FOUND');
  });

  it('AC-3 amount_held is unchanged', async () => {
    await revoke(ORG_A, SELLER_ROW);

    expect((await rowOf(SELLER_ROW)).amountHeld).toBe(12500n);
  });

  it('AC-4 their own OWNER row answers 409 OWNER_PROTECTED and nothing changes', async () => {
    const before = await scopeVersionOf(OWNER);

    const response = await revoke(ORG_A, OWNER_ROW);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('OWNER_PROTECTED');
    const row = await rowOf(OWNER_ROW);
    expect(row.status).toBe('ACTIVE');
    expect(await scopeVersionOf(OWNER)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-4 an already REVOKED row answers 404 NOT_FOUND and nothing changes', async () => {
    const before = await scopeVersionOf(REVOKED_PERSON);

    const response = await revoke(ORG_A, REVOKED_ROW);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await scopeVersionOf(REVOKED_PERSON)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-4 a row of another business answers 404 NOT_FOUND and nothing changes', async () => {
    const response = await revoke(ORG_A, OTHER_OWNER_ROW);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect((await rowOf(OTHER_OWNER_ROW)).status).toBe('ACTIVE');
  });

  it('answers 400 for a malformed collaboration id', async () => {
    const response = await revoke(ORG_A, 'not-a-uuid');
    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    const { default: request } = await import('supertest');
    const response = await request(app).delete(
      `/api/v1/organizations/${ORG_A}/collaborators/${SELLER_ROW}`
    );
    expect(response.status).toBe(401);
  });
});

describe('security', () => {
  it('AB-1 a MANAGER gets 403 and the row is unchanged', async () => {
    const before = await scopeVersionOf(SELLER);

    const response = await revoke(ORG_A, SELLER_ROW, MANAGER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect((await rowOf(SELLER_ROW)).status).toBe('ACTIVE');
    expect(await scopeVersionOf(SELLER)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AB-2 the OWNER row id answers 409 and the organization keeps an ACTIVE OWNER', async () => {
    const response = await revoke(ORG_A, OWNER_ROW);

    expect(response.status).toBe(409);
    const owners = await prisma.collaboration.count({
      where: { organizationId: ORG_A, role: 'OWNER', status: 'ACTIVE' },
    });
    expect(owners).toBe(1);
  });

  it('an owner of business B revoking in business A gets 404', async () => {
    const response = await revoke(ORG_A, SELLER_ROW, OTHER_OWNER);
    expect(response.status).toBe(404);
    expect((await rowOf(SELLER_ROW)).status).toBe('ACTIVE');
  });
});
