import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const CALLER = '0199c0c0-0000-7000-8000-000000000201';
const OTHER = '0199c0c0-0000-7000-8000-000000000202';
const OWNER = '0199c0c0-0000-7000-8000-000000000203';
const ORG = '0199c0c0-0000-7000-8000-0000000002a1';

const REG = new Date('2026-01-01T00:00:00.000Z');
const MARK = new Date('2026-02-01T00:00:00.000Z');

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

async function seedRelationship(customerPersonId: string, contestedAt: Date | null = MARK) {
  const id = newId();
  await prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: ORG,
      customerPersonId,
      status: 'ACTIVE',
      creditLimit: 0n,
      createdById: OWNER,
      contestedAt,
    },
  });
  return id;
}

const uncontest = (relationshipId: string, body: object = {}, personId = CALLER) =>
  createAuthenticatedRequest(app, personId)
    .post(`/api/v1/suppliers/${relationshipId}/uncontest`)
    .send({ id: newId(), ...body });

const row = (id: string) => prisma.customerRelationship.findUniqueOrThrow({ where: { id } });
const scope = async (id: string) =>
  (await prisma.person.findUniqueOrThrow({ where: { id } })).scopeVersion;

beforeEach(async () => {
  await seedPerson(CALLER, '+237600009601');
  await seedPerson(OTHER, '+237600009602');
  await seedPerson(OWNER, '+237600009603');
  await prisma.organization.create({ data: { id: ORG, name: 'Org', status: 'ACTIVE' } });
  await prisma.collaboration.create({
    data: {
      id: newId(),
      personId: OWNER,
      organizationId: ORG,
      role: 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
});

describe('POST /api/v1/suppliers/:relationshipId/uncontest', () => {
  it('AC-1 clears the mark with no notification, journal row or scope bump', async () => {
    const id = await seedRelationship(CALLER);
    const before = await scope(CALLER);

    const response = await uncontest(id);

    expect(response.status).toBe(204);
    const cleared = await row(id);
    expect(cleared.contestedAt).toBeNull();
    expect(cleared.customerPersonId).toBe(CALLER);
    expect(await scope(CALLER)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.customerRelationshipReassignment.count()).toBe(0);
  });

  it('AC-2 answers 409 NOT_CONTESTED for a relationship that is not contested', async () => {
    const id = await seedRelationship(CALLER, null);

    const response = await uncontest(id);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_CONTESTED');
    expect((await row(id)).contestedAt).toBeNull();
  });

  it('AC-2 answers 404 NOT_FOUND for the relationship of another person', async () => {
    const id = await seedRelationship(OTHER);

    const response = await uncontest(id);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect((await row(id)).contestedAt).toEqual(MARK);
  });

  it('AC-2 answers 404 for an unknown relationship', async () => {
    expect((await uncontest(newId())).status).toBe(404);
  });

  it('AC-2 answers 400 VALIDATION_ERROR for an unknown body field', async () => {
    const id = await seedRelationship(CALLER);

    const response = await uncontest(id, { contested_at: null });

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect((await row(id)).contestedAt).toEqual(MARK);
  });

  it('AC-3 answers 204 again for the same gesture id and changes nothing else', async () => {
    const id = await seedRelationship(CALLER);
    const gestureId = newId();
    const send = () =>
      createAuthenticatedRequest(app, CALLER)
        .post(`/api/v1/suppliers/${id}/uncontest`)
        .send({ id: gestureId });

    expect((await send()).status).toBe(204);
    // A new contestation after the first answer: a replay must not clear it again.
    await prisma.customerRelationship.update({ where: { id }, data: { contestedAt: MARK } });

    const second = await send();

    expect(second.status).toBe(204);
    expect((await row(id)).contestedAt).toEqual(MARK);
  });

  it('AB-1 refuses the supplier owner with 404 and keeps the mark', async () => {
    const id = await seedRelationship(CALLER);

    const response = await uncontest(id, {}, OWNER);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect((await row(id)).contestedAt).toEqual(MARK);
  });
});
