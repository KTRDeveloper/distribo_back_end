import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const failure = vi.hoisted(() => ({ journalInsert: false }));

vi.mock('../../../src/modules/relationship/relationship.repository.js', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('../../../src/modules/relationship/relationship.repository.js')
    >();
  return {
    ...original,
    insertReassignment: (...args: Parameters<typeof original.insertReassignment>) => {
      if (failure.journalInsert) return Promise.reject(new Error('forced journal failure'));
      return original.insertReassignment(...args);
    },
  };
});

const OWNER = '0199c0d0-0000-7000-8000-000000000001';
const MANAGER = '0199c0d0-0000-7000-8000-000000000002';
const SELLER = '0199c0d0-0000-7000-8000-000000000003';
const DRIVER = '0199c0d0-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0d0-0000-7000-8000-000000000005';
const WRONG = '0199c0d0-0000-7000-8000-000000000006';
const RIGHT = '0199c0d0-0000-7000-8000-000000000007';
const TAKEN = '0199c0d0-0000-7000-8000-000000000008';
const ORG = '0199c0d0-0000-7000-8000-0000000000a1';
const ORG_OTHER = '0199c0d0-0000-7000-8000-0000000000a2';
const ORG_CUSTOMER = '0199c0d0-0000-7000-8000-0000000000a3';

const WRONG_PHONE = '+237600009701';
const RIGHT_PHONE = '+237600009702';
const TAKEN_PHONE = '+237600009703';
const NEW_PHONE = '+237600009799';

const REG = new Date('2026-01-01T00:00:00.000Z');

async function seedPerson(id: string, phone: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: registered ? 'Fixture Person' : null,
      phoneNumber: phone,
      ...(registered
        ? { phoneVerifiedAt: REG, passwordHash: 'test-password-hash', registeredAt: REG }
        : {}),
    },
  });
}

async function seedMember(orgId: string, personId: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: newId(),
      personId,
      organizationId: orgId,
      role: role as 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedRelationship(
  data: {
    supplierOrganizationId?: string;
    customerPersonId?: string | null;
    customerOrganizationId?: string | null;
    customerLabel?: string;
    balance?: bigint;
  } = {}
) {
  const id = newId();
  await prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: ORG,
      createdById: OWNER,
      creditLimit: 0n,
      status: 'ACTIVE',
      ...data,
    },
  });
  return id;
}

const correct = (relationshipId: string, body: object, personId = OWNER, organizationId = ORG) =>
  createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/customers/${relationshipId}/correct-number`)
    .send({ id: newId(), ...body });

const contest = (relationshipId: string, personId: string) =>
  createAuthenticatedRequest(app, personId)
    .post(`/api/v1/suppliers/${relationshipId}/contest`)
    .send({ id: newId() });

const row = (id: string) => prisma.customerRelationship.findUniqueOrThrow({ where: { id } });
const scope = async (id: string) =>
  (await prisma.person.findUniqueOrThrow({ where: { id } })).scopeVersion;
const journal = (id: string) =>
  prisma.customerRelationshipReassignment.findMany({ where: { customerRelationshipId: id } });

beforeEach(async () => {
  failure.journalInsert = false;
  await seedPerson(OWNER, '+237600009711');
  await seedPerson(MANAGER, '+237600009712');
  await seedPerson(SELLER, '+237600009713');
  await seedPerson(DRIVER, '+237600009714');
  await seedPerson(OTHER_OWNER, '+237600009715');
  await seedPerson(WRONG, WRONG_PHONE);
  await seedPerson(RIGHT, RIGHT_PHONE);
  await seedPerson(TAKEN, TAKEN_PHONE);
  await prisma.organization.create({ data: { id: ORG, name: 'Org', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: ORG_OTHER, name: 'Other', status: 'ACTIVE' } });
  await prisma.organization.create({
    data: { id: ORG_CUSTOMER, name: 'Customer org', status: 'ACTIVE' },
  });
  await seedMember(ORG, OWNER, 'OWNER');
  await seedMember(ORG, MANAGER, 'MANAGER');
  await seedMember(ORG, SELLER, 'SELLER');
  await seedMember(ORG, DRIVER, 'DRIVER');
  await seedMember(ORG_OTHER, OTHER_OWNER, 'OWNER');
  await seedMember(ORG_CUSTOMER, OTHER_OWNER, 'OWNER');
  await seedMember(ORG_CUSTOMER, MANAGER, 'MANAGER');
});

describe('POST /api/v1/organizations/:organizationId/customers/:relationshipId/correct-number', () => {
  it('AC-1 correct: repointed, one journal row, balance kept, scope +1 each, notification', async () => {
    const id = await seedRelationship({ customerPersonId: WRONG, balance: 7500n });
    const wrongScope = await scope(WRONG);
    const rightScope = await scope(RIGHT);

    const response = await correct(id, { phone_number: RIGHT_PHONE, reason: 'Typo' });

    expect(response.status).toBe(200);
    const body = bodyOf<{
      id: string;
      balance: number;
      customer: { person: { phone_number: string } };
    }>(response);
    expect(body.id).toBe(id);
    expect(body.balance).toBe(7500);
    expect(body.customer.person.phone_number).toBe(RIGHT_PHONE);
    expect(await row(id)).toMatchObject({ customerPersonId: RIGHT, balance: 7500n });
    const rows = await journal(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      previousPersonId: WRONG,
      newPersonId: RIGHT,
      reassignedById: OWNER,
      reason: 'Typo',
    });
    expect(await scope(WRONG)).toBe(wrongScope + 1);
    expect(await scope(RIGHT)).toBe(rightScope + 1);
    const notifications = await prisma.notification.findMany({
      where: { sourceEvent: 'customer.added' },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      recipientId: RIGHT,
      organizationId: ORG,
      relatedEntityId: id,
    });
  });

  it('creates a guest for an unknown number and notifies nobody', async () => {
    const id = await seedRelationship({ customerPersonId: WRONG });

    const response = await correct(id, { phone_number: NEW_PHONE }, MANAGER);

    expect(response.status).toBe(200);
    const created = await prisma.person.findFirstOrThrow({ where: { phoneNumber: NEW_PHONE } });
    expect(created.registeredAt).toBeNull();
    expect((await row(id)).customerPersonId).toBe(created.id);
    expect((await journal(id))[0]?.reassignedById).toBe(MANAGER);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-2 existing live relationship: 409 RELATIONSHIP_EXISTS and nothing changes', async () => {
    const id = await seedRelationship({ customerPersonId: WRONG });
    await seedRelationship({ customerPersonId: RIGHT });
    const before = await scope(WRONG);

    const response = await correct(id, { phone_number: RIGHT_PHONE });

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('RELATIONSHIP_EXISTS');
    expect((await row(id)).customerPersonId).toBe(WRONG);
    expect(await journal(id)).toHaveLength(0);
    expect(await scope(WRONG)).toBe(before);
  });

  it('refuses the number the relationship already points to', async () => {
    const id = await seedRelationship({ customerPersonId: WRONG });

    const response = await correct(id, { phone_number: WRONG_PHONE });

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('RELATIONSHIP_EXISTS');
  });

  describe('contested record', () => {
    it('AC-1 another number: repointed, one journal entry, mark cleared', async () => {
      const id = await seedRelationship({ customerPersonId: TAKEN, balance: 4000n });
      expect((await contest(id, TAKEN)).status).toBe(204);
      expect((await row(id)).contestedAt).not.toBeNull();

      const response = await correct(id, { phone_number: RIGHT_PHONE, reason: 'Wrong person' });

      expect(response.status).toBe(200);
      expect(await row(id)).toMatchObject({
        customerPersonId: RIGHT,
        contestedAt: null,
        balance: 4000n,
      });
      expect(await journal(id)).toHaveLength(1);
    });

    it('AC-2 the contester own number: 409 SAME_NUMBER and nothing changes', async () => {
      const id = await seedRelationship({ customerPersonId: TAKEN });
      expect((await contest(id, TAKEN)).status).toBe(204);
      const before = await row(id);
      const scopeBefore = await scope(TAKEN);

      const response = await correct(id, { phone_number: TAKEN_PHONE, reason: 'It is them' });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('SAME_NUMBER');
      expect(await row(id)).toEqual(before);
      expect(await journal(id)).toHaveLength(0);
      expect(await scope(TAKEN)).toBe(scopeBefore);
    });

    it('AC-3 the old confirm_same_customer field: 400 VALIDATION_ERROR', async () => {
      const id = await seedRelationship({ customerPersonId: TAKEN });
      expect((await contest(id, TAKEN)).status).toBe(204);

      const response = await correct(id, {
        phone_number: RIGHT_PHONE,
        confirm_same_customer: true,
      });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect((await row(id)).customerPersonId).toBe(TAKEN);
      expect((await row(id)).contestedAt).not.toBeNull();
    });

    it('AB-1 a MANAGER pushing the debt back: refused, mark and customer kept', async () => {
      const id = await seedRelationship({ customerPersonId: TAKEN });
      expect((await contest(id, TAKEN)).status).toBe(204);

      const bare = await correct(id, { phone_number: TAKEN_PHONE }, MANAGER);
      const extra = await correct(
        id,
        { phone_number: TAKEN_PHONE, confirm_same_customer: true, reason: 'Same' },
        MANAGER
      );

      expect(bare.status).toBe(409);
      expect(bodyOf<ErrorBody>(bare).error.code).toBe('SAME_NUMBER');
      expect(extra.status).toBe(400);
      expect(await row(id)).toMatchObject({ customerPersonId: TAKEN });
      expect((await row(id)).contestedAt).not.toBeNull();
      expect(await journal(id)).toHaveLength(0);
    });

    it('a target with a live relationship stays refused and the mark stays', async () => {
      const id = await seedRelationship({ customerPersonId: TAKEN });
      await seedRelationship({ customerPersonId: RIGHT });
      expect((await contest(id, TAKEN)).status).toBe(204);

      const response = await correct(id, { phone_number: RIGHT_PHONE });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('RELATIONSHIP_EXISTS');
      expect((await row(id)).contestedAt).not.toBeNull();
    });
  });

  describe('AC-4 refusals', () => {
    it.each([
      ['a SELLER caller', SELLER, 403, 'FORBIDDEN'],
      ['a DRIVER caller', DRIVER, 403, 'FORBIDDEN'],
    ])('%s', async (_name, caller, status, code) => {
      const id = await seedRelationship({ customerPersonId: WRONG });

      const response = await correct(id, { phone_number: RIGHT_PHONE }, caller);

      expect(response.status).toBe(status);
      expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
      expect((await row(id)).customerPersonId).toBe(WRONG);
    });

    it('a MANAGER on their own customer record: 403 OWN_RECORD', async () => {
      const id = await seedRelationship({ customerPersonId: MANAGER });

      const response = await correct(id, { phone_number: RIGHT_PHONE }, MANAGER);

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
      expect((await row(id)).customerPersonId).toBe(MANAGER);
    });

    it('a MANAGER of the customer organization: 403 OWN_RECORD', async () => {
      const id = await seedRelationship({ customerOrganizationId: ORG_CUSTOMER });

      const response = await correct(id, { phone_number: RIGHT_PHONE }, MANAGER);

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
    });

    it('a counter: 409 NOT_A_PERSON_CUSTOMER', async () => {
      const id = await seedRelationship({ customerLabel: 'Comptoir' });

      const response = await correct(id, { phone_number: RIGHT_PHONE });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_A_PERSON_CUSTOMER');
    });

    it('an organization customer: 409 NOT_A_PERSON_CUSTOMER', async () => {
      const id = await seedRelationship({ customerOrganizationId: ORG_CUSTOMER });

      const response = await correct(id, { phone_number: RIGHT_PHONE });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_A_PERSON_CUSTOMER');
    });

    it.each([
      ['an unknown field', { phone_number: RIGHT_PHONE, customer_person_id: RIGHT }],
      ['no phone number', {}],
      ['a malformed phone number', { phone_number: 'abc' }],
      ['the removed confirmation field', { phone_number: RIGHT_PHONE, confirm_same_customer: true }],
    ])('%s: 400 VALIDATION_ERROR', async (_name, body) => {
      const id = await seedRelationship({ customerPersonId: WRONG });

      const response = await correct(id, body);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect((await row(id)).customerPersonId).toBe(WRONG);
    });

    it('a relationship of another supplier: 404', async () => {
      const id = await seedRelationship({ customerPersonId: WRONG });

      const response = await correct(id, { phone_number: RIGHT_PHONE }, OTHER_OWNER, ORG_OTHER);

      expect(response.status).toBe(404);
      expect((await row(id)).customerPersonId).toBe(WRONG);
    });
  });

  it('is atomic: a journal failure leaves the relationship, scopes and notifications unchanged', async () => {
    const id = await seedRelationship({ customerPersonId: WRONG });
    const before = [await scope(WRONG), await scope(RIGHT)];
    failure.journalInsert = true;

    const response = await correct(id, { phone_number: RIGHT_PHONE });

    expect(response.status).toBe(500);
    expect((await row(id)).customerPersonId).toBe(WRONG);
    expect([await scope(WRONG), await scope(RIGHT)]).toEqual(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AB-1 innocent person: the journal names the author; the moved person can contest, take it back and contest again', async () => {
    const id = await seedRelationship({ customerPersonId: WRONG, balance: 90000n });

    expect((await correct(id, { phone_number: RIGHT_PHONE })).status).toBe(200);

    const rows = await journal(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ newPersonId: RIGHT, reassignedById: OWNER });
    expect((await contest(id, RIGHT)).status).toBe(204);
    const takenBack = await createAuthenticatedRequest(app, RIGHT)
      .post(`/api/v1/suppliers/${id}/uncontest`)
      .send({ id: newId() });
    expect(takenBack.status).toBe(204);
    expect((await contest(id, RIGHT)).status).toBe(204);
    expect((await row(id)).balance).toBe(90000n);
    expect((await row(id)).customerPersonId).toBe(RIGHT);
  });
});
