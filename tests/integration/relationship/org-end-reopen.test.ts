import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0b3-0000-7000-8000-000000000001';
const MANAGER = '0199c0b3-0000-7000-8000-000000000002';
const SELLER = '0199c0b3-0000-7000-8000-000000000003';
const DRIVER = '0199c0b3-0000-7000-8000-000000000004';
const OWNER_B = '0199c0b3-0000-7000-8000-000000000005';
const OWNER_S = '0199c0b3-0000-7000-8000-000000000006';

const ORG_A = '0199c0b3-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0b3-0000-7000-8000-0000000000b1';
const SUPPLIER = '0199c0b3-0000-7000-8000-0000000000c1';

const ACTIVE = '0199c0b3-0000-7000-8000-0000000000d1';
const ENDED_BY_SUPPLIER = '0199c0b3-0000-7000-8000-0000000000d2';
const ENDED_BY_CUSTOMER = '0199c0b3-0000-7000-8000-0000000000d3';
const OF_B = '0199c0b3-0000-7000-8000-0000000000d4';
const A_AS_SUPPLIER = '0199c0b3-0000-7000-8000-0000000000d5';
const ABSENT = '0199c0b3-0000-7000-8000-0000000000dd';

const G1 = '0199c0b3-0000-7000-8000-0000000000f1';
const G2 = '0199c0b3-0000-7000-8000-0000000000f2';
const G3 = '0199c0b3-0000-7000-8000-0000000000f3';

const REG = new Date('2026-01-01T00:00:00.000Z');

type View = {
  id: string;
  status: string;
  ended_by_party: string | null;
  supplier_label: string | null;
  balance?: number;
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

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER'
) {
  await prisma.collaboration.create({
    data: {
      id: newId(),
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedOrg(id: string, ownerId: string) {
  await prisma.organization.create({ data: { id, name: 'Org ' + id.slice(-2), status: 'ACTIVE' } });
  await seedMember(id, ownerId, 'OWNER');
}

function seedRelationship(id: string, data: Record<string, unknown>) {
  return prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: SUPPLIER,
      customerOrganizationId: ORG_A,
      createdById: OWNER_S,
      creditLimit: 5000n,
      balance: 12500n,
      customerLabel: 'Secret customer label',
      supplierNotes: 'Secret supplier notes',
      status: 'ACTIVE',
      ...data,
    } as never,
  });
}

const stored = (id: string) => prisma.customerRelationship.findUniqueOrThrow({ where: { id } });

function post(
  action: 'end' | 'reopen',
  relationshipId: string,
  gestureId = G1,
  personId = MANAGER,
  organizationId = ORG_A
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/suppliers/${relationshipId}/${action}`)
    .send({ id: gestureId });
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009301');
  await seedPerson(MANAGER, '+237600009302');
  await seedPerson(SELLER, '+237600009303');
  await seedPerson(DRIVER, '+237600009304');
  await seedPerson(OWNER_B, '+237600009305');
  await seedPerson(OWNER_S, '+237600009306');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER');
  await seedMember(ORG_A, SELLER, 'SELLER');
  await seedMember(ORG_A, DRIVER, 'DRIVER');
  await seedOrg(ORG_B, OWNER_B);
  await seedOrg(SUPPLIER, OWNER_S);

  // One live relationship per supplier and customer: each extra row needs its own supplier.
  const supplierOf = async (n: number) => {
    const id = `0199c0b3-0000-7000-8000-0000000000e${n}`;
    await prisma.organization.create({ data: { id, name: 'Supplier ' + n, status: 'ACTIVE' } });
    return id;
  };
  await seedRelationship(ACTIVE, {});
  await seedRelationship(ENDED_BY_SUPPLIER, {
    supplierOrganizationId: await supplierOf(2),
    status: 'ENDED',
    endedByParty: 'SUPPLIER',
  });
  await seedRelationship(ENDED_BY_CUSTOMER, {
    supplierOrganizationId: await supplierOf(3),
    status: 'ENDED',
    endedByParty: 'CUSTOMER',
  });
  await seedRelationship(OF_B, { customerOrganizationId: ORG_B });
  // Org A is only the supplier here: it is not one of its own suppliers.
  await seedRelationship(A_AS_SUPPLIER, {
    supplierOrganizationId: ORG_A,
    customerOrganizationId: null,
    customerPersonId: OWNER_B,
  });
});

describe('POST .../organizations/:organizationId/suppliers/:relationshipId/end and reopen', () => {
  it('AC-1 end then reopen: ENDED by CUSTOMER, then ACTIVE (C-09)', async () => {
    const ended = await post('end', ACTIVE, G1);

    expect(ended.status).toBe(200);
    expect(bodyOf<View>(ended)).toMatchObject({
      id: ACTIVE,
      status: 'ENDED',
      ended_by_party: 'CUSTOMER',
    });
    expect(await stored(ACTIVE)).toMatchObject({
      status: 'ENDED',
      endedByParty: 'CUSTOMER',
      balance: 12500n,
    });

    const reopened = await post('reopen', ACTIVE, G2);

    expect(reopened.status).toBe(200);
    expect(bodyOf<View>(reopened)).toMatchObject({ status: 'ACTIVE', ended_by_party: null });
    expect(await stored(ACTIVE)).toMatchObject({ status: 'ACTIVE', endedByParty: null });
  });

  it('answers the customer view: no customer_label or supplier_notes (CM-19)', async () => {
    const response = await post('end', ACTIVE);

    expect(JSON.stringify(response.body)).not.toMatch(
      /customer_label|supplier_notes|Secret customer label|Secret supplier notes/
    );
  });

  it('lets the OWNER end a supplier too', async () => {
    const response = await post('end', ACTIVE, G1, OWNER);
    expect(response.status).toBe(200);
  });

  it.each([
    [
      'reopening a block by the supplier',
      'reopen',
      ENDED_BY_SUPPLIER,
      MANAGER,
      409,
      'ENDED_BY_OTHER_PARTY',
    ],
    ['a SELLER caller', 'end', ACTIVE, SELLER, 403, 'FORBIDDEN'],
    ['a DRIVER caller', 'end', ACTIVE, DRIVER, 403, 'FORBIDDEN'],
    ['a SELLER caller on reopen', 'reopen', ENDED_BY_CUSTOMER, SELLER, 403, 'FORBIDDEN'],
    ['a DRIVER caller on reopen', 'reopen', ENDED_BY_CUSTOMER, DRIVER, 403, 'FORBIDDEN'],
    ['a relationship of another business', 'end', OF_B, MANAGER, 404, 'NOT_FOUND'],
    ['a relationship of another business on reopen', 'reopen', OF_B, MANAGER, 404, 'NOT_FOUND'],
    [
      'a relationship where the business is the supplier',
      'end',
      A_AS_SUPPLIER,
      MANAGER,
      404,
      'NOT_FOUND',
    ],
    ['an absent relationship', 'end', ABSENT, MANAGER, 404, 'NOT_FOUND'],
    [
      'ending an already ended relationship',
      'end',
      ENDED_BY_CUSTOMER,
      MANAGER,
      409,
      'RELATIONSHIP_NOT_ACTIVE',
    ],
    ['reopening an active relationship', 'reopen', ACTIVE, MANAGER, 409, 'RELATIONSHIP_NOT_ENDED'],
  ] as const)('AC-2 %s answers %i %s', async (_problem, action, id, caller, status, code) => {
    const response = await post(action, id, G1, caller);

    expect(response.status).toBe(status);
    expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
  });

  it('AC-2 a block by the supplier stays ENDED by the SUPPLIER', async () => {
    await post('reopen', ENDED_BY_SUPPLIER);

    expect(await stored(ENDED_BY_SUPPLIER)).toMatchObject({
      status: 'ENDED',
      endedByParty: 'SUPPLIER',
    });
  });

  it('a non-member of the path organization answers 404', async () => {
    const response = await post('end', OF_B, G1, MANAGER, ORG_B);

    expect(response.status).toBe(404);
    expect((await stored(OF_B)).status).toBe('ACTIVE');
  });

  it('rejects an unknown body field and a malformed id with 400', async () => {
    const malformed = await post('end', 'not-a-uuid');
    const extra = await createAuthenticatedRequest(app, MANAGER)
      .post(`/api/v1/organizations/${ORG_A}/suppliers/${ACTIVE}/end`)
      .send({ id: G1, status: 'ENDED' });

    expect(malformed.status).toBe(400);
    expect(extra.status).toBe(400);
    expect((await stored(ACTIVE)).status).toBe('ACTIVE');
  });

  it('AC-3 the same id sent twice answers equal and changes nothing more', async () => {
    const first = await post('end', ACTIVE, G1);
    const second = await post('end', ACTIVE, G1);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await stored(ACTIVE)).toMatchObject({ status: 'ENDED', endedByParty: 'CUSTOMER' });

    const reopen = await post('reopen', ACTIVE, G3);
    const again = await post('reopen', ACTIVE, G3);
    expect(again.body).toEqual(reopen.body);
  });

  it('AB-1 a SELLER or DRIVER posting end gets 403 and nothing changes', async () => {
    for (const [caller, gesture] of [
      [SELLER, G1],
      [DRIVER, G2],
    ] as const) {
      const response = await post('end', ACTIVE, gesture, caller);
      expect(response.status).toBe(403);
    }
    expect(await stored(ACTIVE)).toMatchObject({ status: 'ACTIVE', endedByParty: null });
  });
});
