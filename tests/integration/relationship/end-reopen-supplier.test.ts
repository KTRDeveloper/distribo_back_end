import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0a7-0000-7000-8000-000000000001';
const MANAGER = '0199c0a7-0000-7000-8000-000000000002';
const SELLER = '0199c0a7-0000-7000-8000-000000000003';
const DRIVER = '0199c0a7-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0a7-0000-7000-8000-000000000005';
const CUSTOMER = '0199c0a7-0000-7000-8000-000000000006';

const ORG_A = '0199c0a7-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0a7-0000-7000-8000-0000000000b1';

const ACTIVE = '0199c0a7-0000-7000-8000-0000000000d1';
const COUNTER = '0199c0a7-0000-7000-8000-0000000000d2';
const PENDING = '0199c0a7-0000-7000-8000-0000000000d3';
const ENDED_BY_SUPPLIER = '0199c0a7-0000-7000-8000-0000000000d4';
const ENDED_BY_CUSTOMER = '0199c0a7-0000-7000-8000-0000000000d5';
const FOREIGN = '0199c0a7-0000-7000-8000-0000000000d6';

const G1 = '0199c0a7-0000-7000-8000-0000000000f1';
const G2 = '0199c0a7-0000-7000-8000-0000000000f2';

const REG = new Date('2026-01-01T00:00:00.000Z');

type View = {
  id: string;
  status: string;
  ended_by_party: string | null;
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

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  suffix: number
) {
  await prisma.collaboration.create({
    data: {
      id: orgId.slice(0, -3) + orgId.slice(-2, -1) + suffix + '5',
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
  await seedMember(id, ownerId, 'OWNER', 9);
}

function seedRelationship(
  id: string,
  data: {
    supplierOrganizationId?: string | null;
    customerPersonId?: string | null;
    customerLabel?: string;
    supplierPersonId?: string;
    status?: 'PENDING' | 'ACTIVE' | 'ENDED';
    endedByParty?: 'SUPPLIER' | 'CUSTOMER';
  }
) {
  return prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: ORG_A,
      createdById: OWNER,
      creditLimit: 0n,
      balance: 12500n,
      status: 'ACTIVE',
      ...data,
    },
  });
}

function post(
  action: 'end' | 'reopen',
  relationshipId: string,
  gestureId = G1,
  personId = MANAGER,
  organizationId = ORG_A
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/customers/${relationshipId}/${action}`)
    .send({ id: gestureId });
}

const stored = (id: string) => prisma.customerRelationship.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009101');
  await seedPerson(MANAGER, '+237600009102');
  await seedPerson(SELLER, '+237600009103');
  await seedPerson(DRIVER, '+237600009104');
  await seedPerson(OTHER_OWNER, '+237600009105');
  await seedPerson(CUSTOMER, '+237600009106');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER', 1);
  await seedMember(ORG_A, SELLER, 'SELLER', 2);
  await seedMember(ORG_A, DRIVER, 'DRIVER', 3);
  await seedOrg(ORG_B, OTHER_OWNER);

  await seedRelationship(ACTIVE, { customerPersonId: CUSTOMER });
  await seedRelationship(COUNTER, { customerLabel: 'Comptoir' });
  // A PENDING relationship always has a person as supplier (database rule), never an organization.
  await seedRelationship(PENDING, {
    status: 'PENDING',
    supplierOrganizationId: null,
    supplierPersonId: MANAGER,
    customerPersonId: CUSTOMER,
  });
  await seedRelationship(ENDED_BY_SUPPLIER, {
    customerPersonId: SELLER,
    status: 'ENDED',
    endedByParty: 'SUPPLIER',
  });
  await seedRelationship(ENDED_BY_CUSTOMER, {
    customerPersonId: DRIVER,
    status: 'ENDED',
    endedByParty: 'CUSTOMER',
  });
  await seedRelationship(FOREIGN, {
    supplierOrganizationId: ORG_B,
    customerPersonId: CUSTOMER,
  });
});

describe('POST .../customers/:relationshipId/end', () => {
  it('AC-1 end: ENDED by the SUPPLIER, the balance unchanged (C-09)', async () => {
    const response = await post('end', ACTIVE);

    expect(response.status).toBe(200);
    expect(bodyOf<View>(response)).toMatchObject({
      id: ACTIVE,
      status: 'ENDED',
      ended_by_party: 'SUPPLIER',
      balance: 12500,
    });
    expect(JSON.stringify(response.body)).not.toContain('supplier_label');
    expect(await stored(ACTIVE)).toMatchObject({
      status: 'ENDED',
      endedByParty: 'SUPPLIER',
      balance: 12500n,
    });
  });

  it('lets the OWNER end a relationship too', async () => {
    const response = await post('end', ACTIVE, G1, OWNER);

    expect(response.status).toBe(200);
    expect(bodyOf<View>(response).status).toBe('ENDED');
  });

  it('refuses ending an already ended relationship', async () => {
    const response = await post('end', ENDED_BY_SUPPLIER);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('RELATIONSHIP_NOT_ACTIVE');
  });
});

describe('POST .../customers/:relationshipId/reopen', () => {
  it('AC-2 reopen own closure: ACTIVE with ended_by_party empty (C-09)', async () => {
    const response = await post('reopen', ENDED_BY_SUPPLIER);

    expect(response.status).toBe(200);
    expect(bodyOf<View>(response)).toMatchObject({
      id: ENDED_BY_SUPPLIER,
      status: 'ACTIVE',
      ended_by_party: null,
      balance: 12500,
    });
    expect(await stored(ENDED_BY_SUPPLIER)).toMatchObject({
      status: 'ACTIVE',
      endedByParty: null,
    });
  });

  it('refuses reopening a relationship that is not ended', async () => {
    const response = await post('reopen', ACTIVE);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('RELATIONSHIP_NOT_ENDED');
    expect((await stored(ACTIVE)).status).toBe('ACTIVE');
  });

  it('end then reopen round-trips', async () => {
    expect((await post('end', ACTIVE, G1)).status).toBe(200);
    const reopened = await post('reopen', ACTIVE, G2);

    expect(reopened.status).toBe(200);
    expect(bodyOf<View>(reopened)).toMatchObject({ status: 'ACTIVE', ended_by_party: null });
  });
});

describe('AC-3 refusals', () => {
  it.each([
    [
      'reopen',
      'reopening a relationship the customer ended',
      ENDED_BY_CUSTOMER,
      MANAGER,
      409,
      'ENDED_BY_OTHER_PARTY',
    ],
    ['end', 'ending a counter', COUNTER, MANAGER, 409, 'COUNTER_CANNOT_END'],
    [
      'end',
      'ending a PENDING relationship (supplier is a person: outside the organization scope)',
      PENDING,
      MANAGER,
      404,
      'NOT_FOUND',
    ],
    ['end', 'a SELLER caller', ACTIVE, SELLER, 403, 'FORBIDDEN'],
    ['reopen', 'a SELLER caller on reopen', ENDED_BY_SUPPLIER, SELLER, 403, 'FORBIDDEN'],
    ['end', 'a relationship of another organization', FOREIGN, MANAGER, 404, 'NOT_FOUND'],
  ] as const)(
    '%s: %s answers %i %s and changes nothing',
    async (action, _name, id, caller, status, code) => {
      const before = await stored(id);

      const response = await post(action, id, G1, caller);

      expect(response.status).toBe(status);
      expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
      expect(await stored(id)).toEqual(before);
    }
  );

  it('answers 400 for a malformed relationship id or body', async () => {
    const malformed = await post('end', 'not-a-uuid');
    const badBody = await createAuthenticatedRequest(app, MANAGER)
      .post(`/api/v1/organizations/${ORG_A}/customers/${ACTIVE}/end`)
      .send({ id: G1, status: 'ENDED' });

    expect(malformed.status).toBe(400);
    expect(badBody.status).toBe(400);
    expect((await stored(ACTIVE)).status).toBe('ACTIVE');
  });
});

describe('AC-4 repeat', () => {
  it('the same id twice returns equal answers and changes once', async () => {
    const first = await post('end', ACTIVE, G1);
    const second = await post('end', ACTIVE, G1);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });
});

describe('abuse cases', () => {
  it('AB-1 a SELLER or DRIVER posting end gets 403 and nothing changes', async () => {
    for (const [caller, gesture] of [
      [SELLER, G1],
      [DRIVER, G2],
    ] as const) {
      const response = await post('end', ACTIVE, gesture, caller);
      expect(response.status).toBe(403);
    }
    expect((await stored(ACTIVE)).status).toBe('ACTIVE');
  });

  it('AB-2 the supplier cannot reopen a relationship the customer ended', async () => {
    const response = await post('reopen', ENDED_BY_CUSTOMER);

    expect(response.status).toBe(409);
    expect(await stored(ENDED_BY_CUSTOMER)).toMatchObject({
      status: 'ENDED',
      endedByParty: 'CUSTOMER',
    });
  });
});
