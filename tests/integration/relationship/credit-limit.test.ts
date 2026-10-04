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
const ORG_C = '0199c0a7-0000-7000-8000-0000000000c1';

const REL = '0199c0a7-0000-7000-8000-0000000000d1';
const COUNTER = '0199c0a7-0000-7000-8000-0000000000d2';
const ENDED = '0199c0a7-0000-7000-8000-0000000000d3';
const ORG_CUSTOMER = '0199c0a7-0000-7000-8000-0000000000d4';
const OWN_PERSON = '0199c0a7-0000-7000-8000-0000000000d5';
const FOREIGN = '0199c0a7-0000-7000-8000-0000000000d6';
const OWNER_SELF = '0199c0a7-0000-7000-8000-0000000000d7';

const G1 = '0199c0a7-0000-7000-8000-0000000000f1';
const G2 = '0199c0a7-0000-7000-8000-0000000000f2';
const G3 = '0199c0a7-0000-7000-8000-0000000000f3';

const REG = new Date('2026-01-01T00:00:00.000Z');

type LimitBody = {
  id: string;
  credit_limit: number | null;
  credit_limit_set_by_id: string | null;
  credit_limit_set_at: string | null;
  status: string;
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
    supplierOrganizationId?: string;
    customerPersonId?: string | null;
    customerOrganizationId?: string | null;
    customerLabel?: string;
    status?: 'ACTIVE' | 'ENDED';
  }
) {
  return prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: ORG_A,
      createdById: OWNER,
      creditLimit: 0n,
      status: 'ACTIVE',
      ...(data.status === 'ENDED' ? { endedByParty: 'SUPPLIER' } : {}),
      ...data,
    },
  });
}

function put(relationshipId: string, body: unknown, personId = OWNER, organizationId = ORG_A) {
  return createAuthenticatedRequest(app, personId)
    .put(`/api/v1/organizations/${organizationId}/customers/${relationshipId}/credit-limit`)
    .send(body as object);
}

const journal = () =>
  prisma.creditLimitChange.findMany({
    where: { customerRelationshipId: REL },
    orderBy: { setAt: 'asc' },
  });

const currentLimit = async (id = REL) =>
  (await prisma.customerRelationship.findUniqueOrThrow({ where: { id } })).creditLimit;

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009001');
  await seedPerson(MANAGER, '+237600009002');
  await seedPerson(SELLER, '+237600009003');
  await seedPerson(DRIVER, '+237600009004');
  await seedPerson(OTHER_OWNER, '+237600009005');
  await seedPerson(CUSTOMER, '+237600009006');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER', 1);
  await seedMember(ORG_A, SELLER, 'SELLER', 2);
  await seedMember(ORG_A, DRIVER, 'DRIVER', 3);
  await seedOrg(ORG_B, OTHER_OWNER);
  // The customer organization, run by OWNER (owner) and MANAGER (manager).
  await seedOrg(ORG_C, OWNER);
  await seedMember(ORG_C, MANAGER, 'MANAGER', 1);

  await seedRelationship(REL, { customerPersonId: CUSTOMER });
  await seedRelationship(COUNTER, { customerLabel: 'Comptoir' });
  await seedRelationship(ENDED, { customerPersonId: SELLER, status: 'ENDED' });
  await seedRelationship(ORG_CUSTOMER, { customerOrganizationId: ORG_C });
  await seedRelationship(OWN_PERSON, { customerPersonId: MANAGER });
  await seedRelationship(OWNER_SELF, { customerPersonId: OWNER });
  await seedRelationship(FOREIGN, {
    supplierOrganizationId: ORG_B,
    customerPersonId: CUSTOMER,
  });
});

describe('PUT /api/v1/organizations/:organizationId/customers/:relationshipId/credit-limit', () => {
  it('AC-1 set: 200, the limit, the author and one journal row', async () => {
    const response = await put(REL, { id: G1, credit_limit: 100000 });

    expect(response.status).toBe(200);
    const body = bodyOf<LimitBody>(response);
    expect(body).toMatchObject({
      id: REL,
      credit_limit: 100000,
      credit_limit_set_by_id: OWNER,
      status: 'ACTIVE',
    });
    expect(body.credit_limit_set_at).not.toBeNull();
    expect(JSON.stringify(body)).not.toContain('supplier_label');

    const rows = await journal();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ previousLimit: 0n, newLimit: 100000n, setById: OWNER });
    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: REL } });
    expect(row).toMatchObject({ creditLimit: 100000n, creditLimitSetById: OWNER });
    expect(row.creditLimitSetAt).not.toBeNull();
  });

  describe('AC-2 manager raises', () => {
    it('notifies the owner once with credit_limit.raised', async () => {
      const response = await put(REL, { id: G1, credit_limit: 500000 }, MANAGER);

      expect(response.status).toBe(200);
      expect(bodyOf<LimitBody>(response).credit_limit_set_by_id).toBe(MANAGER);
      const notifications = await prisma.notification.findMany({
        where: { sourceEvent: 'credit_limit.raised' },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        recipientId: OWNER,
        organizationId: ORG_A,
        relatedEntityId: REL,
      });
    });

    it('does not notify when a manager lowers, or when the owner raises', async () => {
      await put(REL, { id: G1, credit_limit: 500000 }, OWNER);
      await put(REL, { id: G2, credit_limit: 1000 }, MANAGER);

      expect(await prisma.notification.count()).toBe(0);
    });

    it('notifies when a manager removes the ceiling', async () => {
      await put(REL, { id: G1, credit_limit: 500000 }, OWNER);
      await put(REL, { id: G2, credit_limit: null }, MANAGER);

      expect(
        await prisma.notification.count({ where: { sourceEvent: 'credit_limit.raised' } })
      ).toBe(1);
    });
  });

  it('AC-3 lower and clear: the same author changes the limit three times', async () => {
    expect((await put(REL, { id: G1, credit_limit: 100000 })).status).toBe(200);
    expect((await put(REL, { id: G2, credit_limit: 20000 })).status).toBe(200);
    const cleared = await put(REL, { id: G3, credit_limit: null });

    expect(cleared.status).toBe(200);
    expect(bodyOf<LimitBody>(cleared).credit_limit).toBeNull();
    const rows = await journal();
    expect(rows.map((r) => [r.previousLimit, r.newLimit, r.setById])).toEqual([
      [0n, 100000n, OWNER],
      [100000n, 20000n, OWNER],
      [20000n, null, OWNER],
    ]);
    expect(await currentLimit()).toBeNull();
  });

  it('writes nothing when the value does not change', async () => {
    await put(REL, { id: G1, credit_limit: 100000 }, MANAGER);

    const response = await put(REL, { id: G2, credit_limit: 100000 }, OWNER);

    expect(response.status).toBe(200);
    expect(bodyOf<LimitBody>(response).credit_limit_set_by_id).toBe(MANAGER);
    expect(await journal()).toHaveLength(1);
  });

  describe('AC-4 refusals', () => {
    it.each([
      ['a SELLER caller', REL, SELLER, { credit_limit: 5000 }, 403, 'FORBIDDEN'],
      ['a DRIVER caller', REL, DRIVER, { credit_limit: 5000 }, 403, 'FORBIDDEN'],
      ['a counter', COUNTER, OWNER, { credit_limit: 5000 }, 409, 'COUNTER_NO_CREDIT'],
      ['credit_limit -1', REL, OWNER, { credit_limit: -1 }, 400, 'VALIDATION_ERROR'],
      ['credit_limit 1.5', REL, OWNER, { credit_limit: 1.5 }, 400, 'VALIDATION_ERROR'],
      ['credit_limit "5"', REL, OWNER, { credit_limit: '5' }, 400, 'VALIDATION_ERROR'],
      [
        'credit_limit beyond the safe integers',
        REL,
        OWNER,
        { credit_limit: 1e21 },
        400,
        'VALIDATION_ERROR',
      ],
      ['no credit_limit', REL, OWNER, {}, 400, 'VALIDATION_ERROR'],
      [
        'a manager on their own customer record',
        OWN_PERSON,
        MANAGER,
        { credit_limit: 5000 },
        403,
        'OWN_RECORD',
      ],
      [
        'a manager of the customer organization',
        ORG_CUSTOMER,
        MANAGER,
        { credit_limit: 5000 },
        403,
        'OWN_RECORD',
      ],
      [
        'an ENDED relationship',
        ENDED,
        OWNER,
        { credit_limit: 5000 },
        409,
        'RELATIONSHIP_NOT_ACTIVE',
      ],
    ])(
      'refuses %s and leaves the limit unchanged',
      async (_name, id, caller, over, status, code) => {
        const response = await put(id, { id: G1, ...over }, caller);

        expect(response.status).toBe(status);
        expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
        expect(await currentLimit(id)).toBe(0n);
        expect(await prisma.creditLimitChange.count()).toBe(0);
      }
    );

    it('answers 404 for a relationship of another organization and for a malformed id', async () => {
      const foreign = await put(FOREIGN, { id: G1, credit_limit: 5000 });
      const malformed = await put('not-a-uuid', { id: G2, credit_limit: 5000 });

      expect(foreign.status).toBe(404);
      expect(malformed.status).toBe(400);
      expect(await currentLimit(FOREIGN)).toBe(0n);
    });
  });

  describe('own record', () => {
    it('refuses the owner on a customer person equal to themselves', async () => {
      const response = await put(OWNER_SELF, { id: G1, credit_limit: 5000 }, OWNER);

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
    });

    it('lets the owner set the limit of a customer organization they manage', async () => {
      const response = await put(ORG_CUSTOMER, { id: G1, credit_limit: 5000 }, OWNER);

      expect(response.status).toBe(200);
      expect(await currentLimit(ORG_CUSTOMER)).toBe(5000n);
    });
  });

  it('AC-5 repeat: the same id twice leaves one journal row and returns the first response', async () => {
    const first = await put(REL, { id: G1, credit_limit: 100000 });
    const second = await put(REL, { id: G1, credit_limit: 100000 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await journal()).toHaveLength(1);
  });

  describe('abuse cases', () => {
    it('AB-1 a SELLER or DRIVER gets 403 and no journal row exists', async () => {
      for (const caller of [SELLER, DRIVER]) {
        const response = await put(
          REL,
          { id: caller === SELLER ? G1 : G2, credit_limit: 1 },
          caller
        );
        expect(response.status).toBe(403);
      }
      expect(await prisma.creditLimitChange.count()).toBe(0);
    });

    it('AB-2 a manager who is the customer person gets 403 OWN_RECORD', async () => {
      const response = await put(OWN_PERSON, { id: G1, credit_limit: 900000 }, MANAGER);

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
      expect(await currentLimit(OWN_PERSON)).toBe(0n);
    });

    it.each([
      ['credit_limit_set_by_id', { credit_limit_set_by_id: SELLER }],
      ['credit_limit_set_at', { credit_limit_set_at: '2020-01-01T00:00:00.000Z' }],
    ])('AB-3 a body with %s is a 400 and nothing is written', async (_name, extra) => {
      const response = await put(REL, { id: G1, credit_limit: 5000, ...extra });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await currentLimit()).toBe(0n);
      expect(await prisma.creditLimitChange.count()).toBe(0);
    });
  });
});
