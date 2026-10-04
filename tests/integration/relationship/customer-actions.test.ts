import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const ME = '0199c0b1-0000-7000-8000-000000000001';
const OTHER = '0199c0b1-0000-7000-8000-000000000002';
const OWNER_A = '0199c0b1-0000-7000-8000-000000000005';
const PEER = '0199c0b1-0000-7000-8000-000000000006';

const ACTIVE = '0199c0b1-0000-7000-8000-0000000000d1';
const ENDED_BY_SUPPLIER = '0199c0b1-0000-7000-8000-0000000000d2';
const ENDED_BY_CUSTOMER = '0199c0b1-0000-7000-8000-0000000000d3';
const PENDING = '0199c0b1-0000-7000-8000-0000000000d4';
const OF_OTHER = '0199c0b1-0000-7000-8000-0000000000d5';
const AS_SUPPLIER = '0199c0b1-0000-7000-8000-0000000000d6';
const ABSENT = '0199c0b1-0000-7000-8000-0000000000dd';

const G1 = '0199c0b1-0000-7000-8000-0000000000f1';
const G2 = '0199c0b1-0000-7000-8000-0000000000f2';
const G3 = '0199c0b1-0000-7000-8000-0000000000f3';

const REG = new Date('2026-01-01T00:00:00.000Z');

type View = {
  id: string;
  status: string;
  ended_by_party: string | null;
  supplier_label: string | null;
  balance: number;
};

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

// One live relationship per supplier organization and customer person: each row gets its own org.
const orgOf = (id: string) => id.slice(0, -3) + '0e' + id.slice(-1);

async function seedRelationship(id: string, data: Record<string, unknown>) {
  const orgId = orgOf(id);
  await prisma.organization.create({
    data: { id: orgId, name: 'Org ' + id.slice(-2), status: 'ACTIVE' },
  });
  await prisma.collaboration.create({
    data: {
      id: orgId.slice(0, -3) + '0c' + orgId.slice(-1),
      personId: OWNER_A,
      organizationId: orgId,
      role: 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  return prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: orgId,
      customerPersonId: ME,
      customerLabel: 'Supplier side label',
      supplierNotes: 'Supplier private notes',
      createdById: OWNER_A,
      creditLimit: 5000n,
      balance: 12500n,
      status: 'ACTIVE',
      ...data,
    },
  });
}

const stored = (id: string) => prisma.customerRelationship.findUniqueOrThrow({ where: { id } });

function patch(relationshipId: string, body: unknown, personId = ME) {
  return createAuthenticatedRequest(app, personId)
    .patch(`/api/v1/suppliers/${relationshipId}`)
    .send(body as object);
}

function post(action: 'end' | 'reopen', relationshipId: string, gestureId = G1, personId = ME) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/suppliers/${relationshipId}/${action}`)
    .send({ id: gestureId });
}

beforeEach(async () => {
  await seedPerson(ME, '+237600009201');
  await seedPerson(OTHER, '+237600009202');
  await seedPerson(OWNER_A, '+237600009205');
  await seedPerson(PEER, '+237600009206');
  await seedRelationship(ACTIVE, {});
  await seedRelationship(ENDED_BY_SUPPLIER, { status: 'ENDED', endedByParty: 'SUPPLIER' });
  await seedRelationship(ENDED_BY_CUSTOMER, { status: 'ENDED', endedByParty: 'CUSTOMER' });
  // A PENDING relationship always has a person as supplier (database rule).
  await seedRelationship(PENDING, {
    status: 'PENDING',
    supplierOrganizationId: null,
    supplierPersonId: PEER,
  });
  await seedRelationship(OF_OTHER, { customerPersonId: OTHER });
  // ME is only the supplier person here, never the customer.
  await seedRelationship(AS_SUPPLIER, {
    status: 'PENDING',
    supplierOrganizationId: null,
    supplierPersonId: ME,
    customerPersonId: PEER,
  });
});

describe('PATCH /api/v1/suppliers/:relationshipId', () => {
  it('AC-1 sets supplier_label, which the supplier never sees (CM-19)', async () => {
    const response = await patch(ACTIVE, { supplier_label: 'Chez Fotso' });

    expect(response.status).toBe(200);
    expect(bodyOf<View>(response)).toMatchObject({ id: ACTIVE, supplier_label: 'Chez Fotso' });
    const text = JSON.stringify(response.body);
    expect(text).not.toContain('Supplier side label');
    expect(text).not.toContain('Supplier private notes');
    expect(await stored(ACTIVE)).toMatchObject({
      supplierLabel: 'Chez Fotso',
      customerLabel: 'Supplier side label',
      supplierNotes: 'Supplier private notes',
    });

    const supplierView = await createAuthenticatedRequest(app, OWNER_A).get(
      `/api/v1/organizations/${orgOf(ACTIVE)}/customers/${ACTIVE}`
    );
    expect(supplierView.status).toBe(200);
    expect(JSON.stringify(supplierView.body)).not.toContain('Chez Fotso');
    expect(JSON.stringify(supplierView.body)).not.toContain('supplier_label');
  });

  it('AC-3 refuses a 101-character label, and accepts 100', async () => {
    const tooLong = await patch(ACTIVE, { supplier_label: 'x'.repeat(101) });
    expect(tooLong.status).toBe(400);
    expect(bodyOf<ErrorBody>(tooLong).error.code).toBe('VALIDATION_ERROR');

    const limit = await patch(ACTIVE, { supplier_label: 'x'.repeat(100) });
    expect(limit.status).toBe(200);
  });

  it('AC-3 refuses an empty label and unknown fields (CWE-915)', async () => {
    for (const body of [
      {},
      { supplier_label: '   ' },
      { supplier_label: 'Ok', credit_limit: 9999 },
      { supplier_label: 'Ok', customer_label: 'Mine' },
      { supplier_label: 'Ok', supplier_notes: 'n' },
    ]) {
      const response = await patch(ACTIVE, body);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    expect(await stored(ACTIVE)).toMatchObject({ supplierLabel: null, creditLimit: 5000n });
  });

  it('AB-2 answers 404 for another person, for the supplier side and for an absent id', async () => {
    for (const id of [OF_OTHER, AS_SUPPLIER, ABSENT]) {
      const response = await patch(id, { supplier_label: 'Hacked' });
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
    expect((await stored(OF_OTHER)).supplierLabel).toBeNull();
    expect((await stored(AS_SUPPLIER)).supplierLabel).toBeNull();
  });

  it('refuses a request without a session', async () => {
    const { default: request } = await import('supertest');
    const response = await request(app)
      .patch(`/api/v1/suppliers/${ACTIVE}`)
      .send({ supplier_label: 'x' });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/suppliers/:relationshipId/end and reopen', () => {
  it('AC-2 ends then reopens: ENDED by CUSTOMER, then ACTIVE with ended_by_party empty (C-09)', async () => {
    const ended = await post('end', ACTIVE, G1);
    expect(ended.status).toBe(200);
    expect(bodyOf<View>(ended)).toMatchObject({
      id: ACTIVE,
      status: 'ENDED',
      ended_by_party: 'CUSTOMER',
      balance: 12500,
    });
    expect(JSON.stringify(ended.body)).not.toContain('Supplier private notes');
    expect(await stored(ACTIVE)).toMatchObject({
      status: 'ENDED',
      endedByParty: 'CUSTOMER',
      balance: 12500n,
    });

    const reopened = await post('reopen', ACTIVE, G2);
    expect(reopened.status).toBe(200);
    expect(bodyOf<View>(reopened)).toMatchObject({
      status: 'ACTIVE',
      ended_by_party: null,
      balance: 12500,
    });
    expect(await stored(ACTIVE)).toMatchObject({ status: 'ACTIVE', endedByParty: null });
  });

  it('AC-3 / AB-1 refuses reopening a relationship the supplier ended', async () => {
    const response = await post('reopen', ENDED_BY_SUPPLIER);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('ENDED_BY_OTHER_PARTY');
    expect(await stored(ENDED_BY_SUPPLIER)).toMatchObject({
      status: 'ENDED',
      endedByParty: 'SUPPLIER',
    });
  });

  it('refuses ending a relationship that is not ACTIVE, and reopening one that is not ENDED', async () => {
    const endEnded = await post('end', ENDED_BY_CUSTOMER);
    expect(endEnded.status).toBe(409);
    expect(bodyOf<ErrorBody>(endEnded).error.code).toBe('RELATIONSHIP_NOT_ACTIVE');

    const endPending = await post('end', PENDING, G2);
    expect(endPending.status).toBe(409);
    expect(bodyOf<ErrorBody>(endPending).error.code).toBe('RELATIONSHIP_NOT_ACTIVE');

    const reopenActive = await post('reopen', ACTIVE, G3);
    expect(reopenActive.status).toBe(409);
    expect(bodyOf<ErrorBody>(reopenActive).error.code).toBe('RELATIONSHIP_NOT_ENDED');
  });

  it('reopens a relationship the customer ended', async () => {
    const response = await post('reopen', ENDED_BY_CUSTOMER);
    expect(response.status).toBe(200);
    expect(bodyOf<View>(response)).toMatchObject({ status: 'ACTIVE', ended_by_party: null });
  });

  it('AB-2 answers 404 for another person, for the supplier side and for an absent id', async () => {
    for (const action of ['end', 'reopen'] as const) {
      for (const id of [OF_OTHER, AS_SUPPLIER, ABSENT]) {
        const response = await post(action, id);
        expect(response.status).toBe(404);
        expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      }
    }
    expect(await stored(OF_OTHER)).toMatchObject({ status: 'ACTIVE', endedByParty: null });
    expect(await stored(AS_SUPPLIER)).toMatchObject({ status: 'PENDING', endedByParty: null });
  });

  it('AC-3 refuses unknown fields in the body (CWE-915)', async () => {
    const response = await createAuthenticatedRequest(app, ME)
      .post(`/api/v1/suppliers/${ACTIVE}/end`)
      .send({ id: G1, status: 'ENDED', ended_by_party: 'SUPPLIER' });

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect((await stored(ACTIVE)).status).toBe('ACTIVE');
  });

  it('a repeat of the same gesture id returns the first response and changes nothing more', async () => {
    const first = await post('end', ACTIVE, G1);
    const repeat = await post('end', ACTIVE, G1);

    expect(first.status).toBe(200);
    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual(first.body);
  });
});
