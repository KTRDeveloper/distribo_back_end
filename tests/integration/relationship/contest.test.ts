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

const CALLER = '0199c0c0-0000-7000-8000-000000000101';
const OTHER = '0199c0c0-0000-7000-8000-000000000102';
const OWNER = '0199c0c0-0000-7000-8000-000000000103';
const MANAGER = '0199c0c0-0000-7000-8000-000000000104';
const SELLER = '0199c0c0-0000-7000-8000-000000000105';
const SUPPLIER_PERSON = '0199c0c0-0000-7000-8000-000000000106';
const OTHER_OWNER = '0199c0c0-0000-7000-8000-000000000107';
const ORG = '0199c0c0-0000-7000-8000-0000000001a1';
const ORG_OTHER = '0199c0c0-0000-7000-8000-0000000001a2';
const CALLER_PHONE = '+237600009501';

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

async function seedMember(orgId: string, personId: string, role: 'OWNER' | 'MANAGER' | 'SELLER') {
  await prisma.collaboration.create({
    data: { id: newId(), personId, organizationId: orgId, role, status: 'ACTIVE', acceptedAt: REG },
  });
}

async function seedRelationship(
  customerPersonId: string,
  status: 'ACTIVE' | 'ENDED' = 'ACTIVE',
  organizationId = ORG
) {
  const id = newId();
  await prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: organizationId,
      customerPersonId,
      status,
      endedByParty: status === 'ENDED' ? 'CUSTOMER' : null,
      creditLimit: 0n,
      createdById: OWNER,
    },
  });
  return id;
}

const contest = (relationshipId: string, body: object = {}, personId = CALLER) =>
  createAuthenticatedRequest(app, personId)
    .post(`/api/v1/suppliers/${relationshipId}/contest`)
    .send({ id: newId(), ...body });

const row = (id: string) => prisma.customerRelationship.findUniqueOrThrow({ where: { id } });
const scope = async (id: string) =>
  (await prisma.person.findUniqueOrThrow({ where: { id } })).scopeVersion;

beforeEach(async () => {
  failure.journalInsert = false;
  await seedPerson(CALLER, CALLER_PHONE);
  await seedPerson(OTHER, '+237600009502');
  await seedPerson(OWNER, '+237600009503');
  await seedPerson(MANAGER, '+237600009504');
  await seedPerson(SELLER, '+237600009505');
  await seedPerson(SUPPLIER_PERSON, '+237600009506');
  await seedPerson(OTHER_OWNER, '+237600009507');
  await prisma.organization.create({ data: { id: ORG, name: 'Org', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: ORG_OTHER, name: 'Other', status: 'ACTIVE' } });
  await seedMember(ORG, OWNER, 'OWNER');
  await seedMember(ORG, MANAGER, 'MANAGER');
  await seedMember(ORG, SELLER, 'SELLER');
  await seedMember(ORG_OTHER, OTHER_OWNER, 'OWNER');
});

describe('POST /api/v1/suppliers/:relationshipId/contest', () => {
  it('AC-1 moves the relationship to a ghost person and writes one journal row', async () => {
    const id = await seedRelationship(CALLER);

    const response = await contest(id, { reason: 'Not my debt' });

    expect(response.status).toBe(204);
    const moved = await row(id);
    expect(moved.customerPersonId).not.toBe(CALLER);
    const ghost = await prisma.person.findUniqueOrThrow({ where: { id: moved.customerPersonId! } });
    expect(ghost.phoneNumber).toBeNull();
    expect(ghost.releasedPhoneNumber).toBe(CALLER_PHONE);
    expect(ghost.fullName).toBeNull();
    expect(ghost.registeredAt).toBeNull();
    const journal = await prisma.customerRelationshipReassignment.findMany({
      where: { customerRelationshipId: id },
    });
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      previousPersonId: CALLER,
      newPersonId: ghost.id,
      reassignedById: CALLER,
      reason: 'Not my debt',
    });

    const list = await createAuthenticatedRequest(app, CALLER).get('/api/v1/suppliers');
    expect(bodyOf<{ items: { id: string }[] }>(list).items.map((item) => item.id)).not.toContain(
      id
    );
    const single = await createAuthenticatedRequest(app, CALLER)
      .patch(`/api/v1/suppliers/${id}`)
      .send({ supplier_label: 'x' });
    expect(single.status).toBe(404);
  });

  it('contests an ENDED relationship and stores no reason when none is given', async () => {
    const id = await seedRelationship(CALLER, 'ENDED');

    expect((await contest(id)).status).toBe(204);

    const journal = await prisma.customerRelationshipReassignment.findFirstOrThrow({
      where: { customerRelationshipId: id },
    });
    expect(journal.reason).toBeNull();
    expect((await row(id)).customerPersonId).toBe(journal.newPersonId);
  });

  it('AC-2 bumps the caller scope version and notifies the owner and managers only', async () => {
    const id = await seedRelationship(CALLER);
    const before = await scope(CALLER);

    expect((await contest(id)).status).toBe(204);

    expect(await scope(CALLER)).toBe(before + 1);
    const notices = await prisma.notification.findMany({
      where: { sourceEvent: 'relationship.contested' },
    });
    expect(notices.map((notice) => notice.recipientId).sort()).toEqual([OWNER, MANAGER].sort());
    expect(notices.every((notice) => notice.content.length > 0)).toBe(true);
    expect(notices.every((notice) => notice.organizationId === ORG)).toBe(true);
  });

  it('AC-3 keeps balance, orders and ledger entries on the same relationship', async () => {
    const id = await seedRelationship(CALLER);
    const orderId = newId();
    await prisma.order.create({
      data: {
        id: orderId,
        customerRelationshipId: id,
        placedByParty: 'SUPPLIER',
        enteredById: OWNER,
        totalAmount: 5000n,
        deliveryCost: 5000n,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        id: newId(),
        customerRelationshipId: id,
        orderId,
        kind: 'SALE',
        amount: 5000n,
        recordedById: OWNER,
        occurredAt: REG,
      },
    });
    const balance = (await row(id)).balance;

    expect((await contest(id)).status).toBe(204);

    expect((await row(id)).balance).toBe(balance);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).customerRelationshipId
    ).toBe(id);
    expect(await prisma.ledgerEntry.count({ where: { customerRelationshipId: id } })).toBe(1);
  });

  it('AC-4 answers 409 ALREADY_CONTESTED on a second contestation and changes nothing', async () => {
    const id = await seedRelationship(CALLER);
    expect((await contest(id)).status).toBe(204);
    // the supplier brings it back to the same number (REL-024 is not built: simulate it)
    await prisma.customerRelationship.update({ where: { id }, data: { customerPersonId: CALLER } });
    const before = await scope(CALLER);
    const people = await prisma.person.count();

    const second = await contest(id);

    expect(second.status).toBe(409);
    expect(bodyOf<ErrorBody>(second).error.code).toBe('ALREADY_CONTESTED');
    expect((await row(id)).customerPersonId).toBe(CALLER);
    expect(await prisma.customerRelationshipReassignment.count()).toBe(1);
    expect(await prisma.person.count()).toBe(people);
    expect(await scope(CALLER)).toBe(before);
    expect(await prisma.notification.count()).toBe(2);
  });

  it('AC-4 answers 404 for the relationship of another person and changes nothing', async () => {
    const id = await seedRelationship(OTHER);

    const response = await contest(id);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect((await row(id)).customerPersonId).toBe(OTHER);
    expect(await prisma.customerRelationshipReassignment.count()).toBe(0);
    expect(await scope(CALLER)).toBe(0);
  });

  it('AC-4 answers 404 for a PENDING invitation and for an absent id', async () => {
    const id = newId();
    await prisma.customerRelationship.create({
      data: {
        id,
        supplierPersonId: SUPPLIER_PERSON,
        customerPersonId: CALLER,
        supplierLabel: 'Chez Paul',
        status: 'PENDING',
        creditLimit: 0n,
        createdById: CALLER,
      },
    });

    const pending = await contest(id);
    const absent = await contest(newId());

    expect(pending.status).toBe(404);
    expect(absent.status).toBe(404);
    expect((await row(id)).customerPersonId).toBe(CALLER);
    expect(await prisma.customerRelationshipReassignment.count()).toBe(0);
  });

  it('answers 404 for a relationship where the caller is only the supplier person', async () => {
    const id = newId();
    await prisma.customerRelationship.create({
      data: {
        id,
        supplierPersonId: CALLER,
        customerPersonId: OTHER,
        supplierLabel: 'Chez Paul',
        status: 'PENDING',
        creditLimit: 0n,
        createdById: OTHER,
      },
    });

    expect((await contest(id)).status).toBe(404);
  });

  it('rejects a malformed body, an unknown field and an over-long reason with 400', async () => {
    const id = await seedRelationship(CALLER);
    const tooLong = 'x'.repeat(2001);

    const unknown = await contest(id, { customer_person_id: OTHER });
    const long = await contest(id, { reason: tooLong });
    const badId = await createAuthenticatedRequest(app, CALLER)
      .post(`/api/v1/suppliers/not-a-uuid/contest`)
      .send({ id: newId() });

    expect(unknown.status).toBe(400);
    expect(long.status).toBe(400);
    expect(badId.status).toBe(400);
    expect((await row(id)).customerPersonId).toBe(CALLER);
  });

  it('requires authentication', async () => {
    const id = await seedRelationship(CALLER);
    const { default: request } = await import('supertest');

    const response = await request(app)
      .post(`/api/v1/suppliers/${id}/contest`)
      .send({ id: newId() });

    expect(response.status).toBe(401);
  });

  it('AC-5 leaves no ghost person and the relationship unchanged when the journal insert fails', async () => {
    const id = await seedRelationship(CALLER);
    const people = await prisma.person.count();
    const before = await scope(CALLER);
    failure.journalInsert = true;

    const response = await contest(id);

    expect(response.status).toBe(500);
    expect(await prisma.person.count()).toBe(people);
    expect((await row(id)).customerPersonId).toBe(CALLER);
    expect(await scope(CALLER)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('replays the first response when the same gesture id is sent again', async () => {
    const id = await seedRelationship(CALLER);
    const gesture = newId();

    const first = await contest(id, { id: gesture });
    const again = await contest(id, { id: gesture });

    expect(first.status).toBe(204);
    expect(again.status).toBe(204);
    expect(await prisma.customerRelationshipReassignment.count()).toBe(1);
  });
});

describe('security', () => {
  it('AB-1 refuses the second contestation after the supplier restored the number', async () => {
    const id = await seedRelationship(CALLER);
    expect((await contest(id)).status).toBe(204);
    await prisma.customerRelationship.update({ where: { id }, data: { customerPersonId: CALLER } });

    const second = await contest(id, { reason: 'again' });

    expect(second.status).toBe(409);
    expect(bodyOf<ErrorBody>(second).error.code).toBe('ALREADY_CONTESTED');
    expect((await row(id)).customerPersonId).toBe(CALLER);
  });

  it('AB-2 answers 404 when person A contests a relationship of person B', async () => {
    const id = await seedRelationship(OTHER);

    const response = await contest(id, {}, CALLER);

    expect(response.status).toBe(404);
    expect((await row(id)).customerPersonId).toBe(OTHER);
    expect(await prisma.person.count({ where: { phoneNumber: null } })).toBe(0);
  });
});
