import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: () => Promise.resolve({ allowed: true, remaining: 1 }),
}));
vi.mock('../../../src/lib/otp-delivery-queue.js', () => ({
  enqueueOtpDelivery: () => Promise.resolve(),
}));

const { app } = await import('../../../src/app.js');
const { findOrganizationsByPublicNumber } = await import(
  '../../../src/modules/organization/organization.repository.js'
);

const OWNER = '0199c027-0000-7000-8000-000000000001';
const MANAGER = '0199c027-0000-7000-8000-000000000002';
const SELLER = '0199c027-0000-7000-8000-000000000003';
const DRIVER = '0199c027-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c027-0000-7000-8000-000000000006';

const ORG_A = '0199c027-0000-7000-8000-0000000000a1';
const ORG_B = '0199c027-0000-7000-8000-0000000000b1';

const CONTACT_A = '0199c027-0000-7000-8000-0000000000d1';
const CONTACT_B = '0199c027-0000-7000-8000-0000000000d2';
const UNKNOWN = '0199c027-0000-7000-8000-0000000000d9';
const NEW_CONTACT = '0199c027-0000-7000-8000-0000000000d3';

const REG = new Date('2026-01-01T00:00:00.000Z');
const PHONE = '+237677027100';

type Contact = { id: string; verified_at: string | null; slot: number | null; value: string };

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

async function seedOrg(id: string, ownerId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({
      data: { id, name: 'Org ' + id.slice(-2), status: 'ACTIVE', maxCollaborators: null },
    });
    await tx.collaboration.create({
      data: {
        id: id.replace(/.$/, '9'),
        personId: ownerId,
        organizationId: id,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  });
}

async function seedMember(
  orgId: string,
  personId: string,
  role: 'MANAGER' | 'SELLER' | 'DRIVER',
  idEnd: string
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c027-0000-7000-8000-0000000000${idEnd}`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

function seedContact(id: string, organizationId: string, slot: number, verified: boolean) {
  return prisma.organizationContact.create({
    data: {
      id,
      organizationId,
      kind: 'PHONE',
      slot,
      value: PHONE,
      createdById: organizationId === ORG_A ? OWNER : OTHER_OWNER,
      ...(verified ? { verifiedAt: REG, verificationMethod: 'CODE' as const } : {}),
    },
  });
}

const remove = (orgId: string, contactId: string, personId = OWNER) =>
  createAuthenticatedRequest(app, personId).delete(
    `/api/v1/organizations/${orgId}/contacts/${contactId}`
  );

beforeEach(async () => {
  await seedPerson(OWNER, '+237600027001');
  await seedPerson(MANAGER, '+237600027002');
  await seedPerson(SELLER, '+237600027003');
  await seedPerson(DRIVER, '+237600027004');
  await seedPerson(OTHER_OWNER, '+237600027006');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER', 'a2');
  await seedMember(ORG_A, SELLER, 'SELLER', 'a3');
  await seedMember(ORG_A, DRIVER, 'DRIVER', 'a4');
  await seedOrg(ORG_B, OTHER_OWNER);
});

describe('DELETE /api/v1/organizations/:organizationId/contacts/:contactId', () => {
  it('AC-1 deletes a verified contact: 204, deleted_at set, the number finds no business', async () => {
    await seedContact(CONTACT_A, ORG_A, 1, true);
    const before = await prisma.organizationContact.findUniqueOrThrow({
      where: { id: CONTACT_A },
    });

    const response = await remove(ORG_A, CONTACT_A);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: CONTACT_A } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.serverUpdatedAt.getTime()).toBeGreaterThanOrEqual(before.serverUpdatedAt.getTime());
    expect(await findOrganizationsByPublicNumber(PHONE)).toEqual([]);
  });

  it('AC-2 frees the place: the same slot can be added again and starts pending', async () => {
    await seedContact(CONTACT_A, ORG_A, 1, true);
    expect((await remove(ORG_A, CONTACT_A)).status).toBe(204);

    const response = await createAuthenticatedRequest(app, OWNER)
      .post(`/api/v1/organizations/${ORG_A}/contacts`)
      .send({ id: NEW_CONTACT, kind: 'PHONE', slot: 1, value: PHONE });

    expect(response.status).toBe(201);
    const body = bodyOf<Contact>(response);
    expect(body).toMatchObject({ id: NEW_CONTACT, slot: 1, verified_at: null });
  });

  describe('AC-3 refusals', () => {
    it('answers 404 NOT_FOUND for an unknown contact', async () => {
      const response = await remove(ORG_A, UNKNOWN);

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    });

    it('answers 404 NOT_FOUND for a contact already deleted, and keeps its first deleted_at', async () => {
      await seedContact(CONTACT_A, ORG_A, 1, true);
      expect((await remove(ORG_A, CONTACT_A)).status).toBe(204);
      const first = await prisma.organizationContact.findUniqueOrThrow({
        where: { id: CONTACT_A },
      });

      const response = await remove(ORG_A, CONTACT_A);

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      const after = await prisma.organizationContact.findUniqueOrThrow({
        where: { id: CONTACT_A },
      });
      expect(after.deletedAt).toEqual(first.deletedAt);
    });

    it('answers 404 NOT_FOUND for a contact of another business and leaves it untouched', async () => {
      await seedContact(CONTACT_B, ORG_B, 1, true);

      const response = await remove(ORG_A, CONTACT_B);

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: CONTACT_B } });
      expect(row.deletedAt).toBeNull();
    });

    it('answers 404 when a person who is not a member of the business deletes', async () => {
      await seedContact(CONTACT_A, ORG_A, 1, true);

      const response = await remove(ORG_A, CONTACT_A, OTHER_OWNER);

      expect(response.status).toBe(404);
      const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: CONTACT_A } });
      expect(row.deletedAt).toBeNull();
    });

    it('answers 400 VALIDATION_ERROR for a contact id that is no UUID', async () => {
      const response = await remove(ORG_A, 'not-a-uuid');

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    });
  });

  it('answers 204 once and 404 once when two deletes race', async () => {
    await seedContact(CONTACT_A, ORG_A, 1, true);

    const [a, b] = await Promise.all([remove(ORG_A, CONTACT_A), remove(ORG_A, CONTACT_A)]);

    expect([a.status, b.status].sort()).toEqual([204, 404]);
  });

  it('AC-4 has no edit route: PATCH and PUT answer 404 NOT_FOUND', async () => {
    await seedContact(CONTACT_A, ORG_A, 1, false);
    const path = `/api/v1/organizations/${ORG_A}/contacts/${CONTACT_A}`;

    const patch = await createAuthenticatedRequest(app, OWNER).patch(path).send({ slot: 2 });
    const put = await createAuthenticatedRequest(app, OWNER).put(path).send({ slot: 2 });

    for (const response of [patch, put]) {
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
    const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: CONTACT_A } });
    expect(row.slot).toBe(1);
  });

  it.each([
    ['MANAGER', MANAGER],
    ['SELLER', SELLER],
    ['DRIVER', DRIVER],
  ])('AB-1 refuses a %s with 403 FORBIDDEN and leaves the contact untouched', async (_r, who) => {
    await seedContact(CONTACT_A, ORG_A, 1, true);

    const response = await remove(ORG_A, CONTACT_A, who);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    const row = await prisma.organizationContact.findUniqueOrThrow({ where: { id: CONTACT_A } });
    expect(row.deletedAt).toBeNull();
  });
});
