import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c011-0000-7000-8000-000000000001';
const MANAGER = '0199c011-0000-7000-8000-000000000002';
const SELLER = '0199c011-0000-7000-8000-000000000003';
const RELEASED = '0199c011-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c011-0000-7000-8000-000000000006';
const REVOKED_PERSON = '0199c011-0000-7000-8000-000000000007';

const ORG_A = '0199c011-0000-7000-8000-0000000000a1';
const ORG_B = '0199c011-0000-7000-8000-0000000000b1';

const OWNER_ROW = '0199c011-0000-7000-8000-0000000000a9';
const MANAGER_ROW = '0199c011-0000-7000-8000-0000000000a2';
const SELLER_ROW = '0199c011-0000-7000-8000-0000000000a3';
const RELEASED_ROW = '0199c011-0000-7000-8000-0000000000a4';
const OTHER_OWNER_ROW = '0199c011-0000-7000-8000-0000000000b9';
const REVOKED_ROW = '0199c011-0000-7000-8000-0000000000a7';

const REG = new Date('2026-01-01T00:00:00.000Z');

async function seedPerson(id: string, phone: string | null) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      releasedPhoneNumber: phone === null ? '+237600011099' : null,
      ...(phone !== null ? { phoneVerifiedAt: REG } : {}),
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

async function seedCollaboration(
  id: string,
  personId: string,
  organizationId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
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
      isPublicContact: role === 'OWNER',
    },
  });
}

function patch(orgId: string, body: unknown, personId = SELLER) {
  return createAuthenticatedRequest(app, personId)
    .patch(`/api/v1/organizations/${orgId}/collaborators/me`)
    .send(body as object);
}

async function flagOf(id: string) {
  return (await prisma.collaboration.findUniqueOrThrow({ where: { id } })).isPublicContact;
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600011001');
  await seedPerson(MANAGER, '+237600011002');
  await seedPerson(SELLER, '+237600011003');
  await seedPerson(RELEASED, null);
  await seedPerson(OTHER_OWNER, '+237600011006');
  await seedPerson(REVOKED_PERSON, '+237600011007');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B' } });
  await seedCollaboration(OWNER_ROW, OWNER, ORG_A, 'OWNER', 'ACTIVE');
  await seedCollaboration(MANAGER_ROW, MANAGER, ORG_A, 'MANAGER', 'ACTIVE');
  await seedCollaboration(SELLER_ROW, SELLER, ORG_A, 'SELLER', 'ACTIVE');
  await seedCollaboration(RELEASED_ROW, RELEASED, ORG_A, 'SELLER', 'ACTIVE');
  await seedCollaboration(REVOKED_ROW, REVOKED_PERSON, ORG_A, 'SELLER', 'REVOKED');
  await seedCollaboration(OTHER_OWNER_ROW, OTHER_OWNER, ORG_B, 'OWNER', 'ACTIVE');
});

describe('PATCH /api/v1/organizations/:organizationId/collaborators/me', () => {
  it('AC-1 turns the flag on then off for the caller', async () => {
    expect(await flagOf(SELLER_ROW)).toBe(false);

    const on = await patch(ORG_A, { is_public_contact: true });
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ is_public_contact: true });
    expect(await flagOf(SELLER_ROW)).toBe(true);

    const off = await patch(ORG_A, { is_public_contact: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ is_public_contact: false });
    expect(await flagOf(SELLER_ROW)).toBe(false);
  });

  it('AC-1 the owner can turn their own flag off and on', async () => {
    const off = await patch(ORG_A, { is_public_contact: false }, OWNER);
    expect(off.status).toBe(200);
    expect(await flagOf(OWNER_ROW)).toBe(false);
    const on = await patch(ORG_A, { is_public_contact: true }, OWNER);
    expect(on.body).toEqual({ is_public_contact: true });
    expect(await flagOf(OWNER_ROW)).toBe(true);
  });

  it('AC-2 turning on without an active number answers 409 NO_ACTIVE_NUMBER', async () => {
    const response = await patch(ORG_A, { is_public_contact: true }, RELEASED);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NO_ACTIVE_NUMBER');
    expect(await flagOf(RELEASED_ROW)).toBe(false);
  });

  it('AC-2 turning off without an active number is allowed', async () => {
    const response = await patch(ORG_A, { is_public_contact: false }, RELEASED);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ is_public_contact: false });
  });

  it.each([
    ['extra key', { is_public_contact: true, role: 'OWNER' }],
    ['no key', {}],
    ['other key only', { role: 'OWNER' }],
    ['not a boolean', { is_public_contact: 'true' }],
    ['null', { is_public_contact: null }],
  ])('AC-3 strict body (%s) answers 400 VALIDATION_ERROR', async (_name, body) => {
    const response = await patch(ORG_A, body);

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await flagOf(SELLER_ROW)).toBe(false);
  });

  it('a non-member, a revoked member and an unknown organization get 404', async () => {
    expect((await patch(ORG_B, { is_public_contact: true })).status).toBe(404);
    expect((await patch(ORG_A, { is_public_contact: true }, REVOKED_PERSON)).status).toBe(404);
    expect(
      (await patch('0199c011-0000-7000-8000-0000000000ff', { is_public_contact: true })).status
    ).toBe(404);
  });

  it('requires authentication', async () => {
    const { default: request } = await import('supertest');
    const response = await request(app)
      .patch(`/api/v1/organizations/${ORG_A}/collaborators/me`)
      .send({ is_public_contact: true });
    expect(response.status).toBe(401);
  });

  it('AB-1 the owner or a manager cannot change another collaborator flag', async () => {
    const before = await flagOf(SELLER_ROW);

    // `me` always targets the caller's own row, whatever the role or the body
    await patch(ORG_A, { is_public_contact: true }, OWNER);
    await patch(ORG_A, { is_public_contact: true }, MANAGER);
    expect(await flagOf(SELLER_ROW)).toBe(before);

    // no route takes another collaborator's id for this flag
    for (const personId of [OWNER, MANAGER]) {
      const byId = await createAuthenticatedRequest(app, personId)
        .patch(`/api/v1/organizations/${ORG_A}/collaborators/${SELLER_ROW}`)
        .send({ is_public_contact: true });
      expect(byId.status).toBeGreaterThanOrEqual(400);
      expect(byId.status).toBeLessThan(500);
    }
    // a person id or collaboration id in the body is refused
    const withId = await patch(ORG_A, { is_public_contact: true, person_id: SELLER }, MANAGER);
    expect(withId.status).toBe(400);
    expect(await flagOf(SELLER_ROW)).toBe(before);
  });
});
