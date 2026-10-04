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

const ORG_A = '0199c0a7-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0a7-0000-7000-8000-0000000000b1';
const ORG_CLOSED = '0199c0a7-0000-7000-8000-0000000000e1';

const REG = new Date('2026-01-01T00:00:00.000Z');

const GESTURE_1 = '0199c0a7-0000-7000-8000-0000000000c1';
const GESTURE_2 = '0199c0a7-0000-7000-8000-0000000000c2';

type CounterBody = {
  id: string;
  status: string;
  customer: unknown;
  customer_label: string | null;
  credit_limit: number | null;
  credit_limit_set_by_id: string | null;
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

async function seedOrg(id: string, ownerId: string, status: 'ACTIVE' | 'CLOSED' = 'ACTIVE') {
  await prisma.organization.create({ data: { id, name: 'Org ' + id.slice(-2), status } });
  await seedMember(id, ownerId, 'OWNER', 9);
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

function addCounter(orgId: string, body: unknown, personId = MANAGER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/counters`)
    .send(body as object);
}

const goodBody = (over: Record<string, unknown> = {}) => ({
  id: GESTURE_1,
  customer_label: 'Comptoir usine',
  ...over,
});

const counterCount = () =>
  prisma.customerRelationship.count({
    where: { customerPersonId: null, customerOrganizationId: null },
  });

beforeEach(async () => {
  await seedPerson(OWNER, '+237600008001');
  await seedPerson(MANAGER, '+237600008002');
  await seedPerson(SELLER, '+237600008003');
  await seedPerson(DRIVER, '+237600008004');
  await seedPerson(OTHER_OWNER, '+237600008005');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER', 1);
  await seedMember(ORG_A, SELLER, 'SELLER', 2);
  await seedMember(ORG_A, DRIVER, 'DRIVER', 3);
  await seedOrg(ORG_B, OTHER_OWNER);
  await seedOrg(ORG_CLOSED, OWNER, 'CLOSED');
  await seedMember(ORG_CLOSED, MANAGER, 'MANAGER', 1);
});

describe('POST /api/v1/organizations/:organizationId/counters', () => {
  it('AC-1 add: 201, a counter with that label, limit 0, no customer, no limit journal row', async () => {
    const response = await addCounter(ORG_A, goodBody());

    expect(response.status).toBe(201);
    const body = bodyOf<CounterBody>(response);
    expect(body).toMatchObject({
      status: 'ACTIVE',
      customer: null,
      customer_label: 'Comptoir usine',
      credit_limit: 0,
      credit_limit_set_by_id: null,
      balance: 0,
    });
    expect(JSON.stringify(body)).not.toContain('supplier_label');

    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: body.id } });
    expect(row).toMatchObject({
      supplierOrganizationId: ORG_A,
      customerPersonId: null,
      customerOrganizationId: null,
      customerLabel: 'Comptoir usine',
      creditLimit: 0n,
      status: 'ACTIVE',
      createdById: MANAGER,
    });
    expect(await prisma.creditLimitChange.count()).toBe(0);
  });

  it('lets the OWNER add a counter', async () => {
    const response = await addCounter(ORG_A, goodBody(), OWNER);
    expect(response.status).toBe(201);
  });

  it('allows the same label in another organization', async () => {
    await seedMember(ORG_B, MANAGER, 'MANAGER', 1);
    await addCounter(ORG_A, goodBody());

    const other = await addCounter(ORG_B, goodBody({ id: GESTURE_2 }));

    expect(other.status).toBe(201);
  });

  it('allows the label of a deleted counter again', async () => {
    const first = await addCounter(ORG_A, goodBody());
    await prisma.customerRelationship.update({
      where: { id: bodyOf<CounterBody>(first).id },
      data: { deletedAt: new Date() },
    });

    const second = await addCounter(ORG_A, goodBody({ id: GESTURE_2 }));

    expect(second.status).toBe(201);
  });

  describe('AC-2 refusals', () => {
    it.each([
      ['an empty label', { customer_label: '' }, 400, 'VALIDATION_ERROR'],
      ['a blank label', { customer_label: '   ' }, 400, 'VALIDATION_ERROR'],
      ['a label of 101 characters', { customer_label: 'x'.repeat(101) }, 400, 'VALIDATION_ERROR'],
      ['a missing label', { customer_label: undefined }, 400, 'VALIDATION_ERROR'],
      ['a missing id', { id: undefined }, 400, 'VALIDATION_ERROR'],
      ['credit_limit in the body', { credit_limit: 1000 }, 400, 'VALIDATION_ERROR'],
      ['a phone_number in the body', { phone_number: '+237600008100' }, 400, 'VALIDATION_ERROR'],
    ])('refuses %s and stores nothing', async (_name, over, status, code) => {
      const before = await counterCount();

      const response = await addCounter(ORG_A, goodBody(over));

      expect(response.status).toBe(status);
      expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
      expect(await counterCount()).toBe(before);
    });

    it('answers 403 FORBIDDEN for a SELLER', async () => {
      const response = await addCounter(ORG_A, goodBody(), SELLER);

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    });

    it('answers 409 COUNTER_LABEL_TAKEN for a label already used by a counter', async () => {
      await addCounter(ORG_A, goodBody());
      const before = await counterCount();

      const response = await addCounter(ORG_A, goodBody({ id: GESTURE_2 }));

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('COUNTER_LABEL_TAKEN');
      expect(await counterCount()).toBe(before);
    });

    it('answers 409 ORGANIZATION_NOT_ACTIVE for a CLOSED organization', async () => {
      const response = await addCounter(ORG_CLOSED, goodBody());

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
      expect(await counterCount()).toBe(0);
    });
  });

  it('AC-3 repeat: the same body twice stores one counter and answers the same', async () => {
    const first = await addCounter(ORG_A, goodBody());
    const second = await addCounter(ORG_A, goodBody());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await counterCount()).toBe(1);
  });

  it('keeps one counter when two managers add the same label at once', async () => {
    const [a, b] = await Promise.all([
      addCounter(ORG_A, goodBody({ id: GESTURE_1 })),
      addCounter(ORG_A, goodBody({ id: GESTURE_2 }), OWNER),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await counterCount()).toBe(1);
  });
});

describe('security', () => {
  it.each([
    ['SELLER', SELLER],
    ['DRIVER', DRIVER],
  ])('AB-1 refuses a %s with 403 and stores nothing', async (_role, personId) => {
    const response = await addCounter(ORG_A, goodBody(), personId);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await counterCount()).toBe(0);
  });

  it('answers 404 to a manager of A posting to business B', async () => {
    const response = await addCounter(ORG_B, goodBody());

    expect(response.status).toBe(404);
    expect(await counterCount()).toBe(0);
  });
});
