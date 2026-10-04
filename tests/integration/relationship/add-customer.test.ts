import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0a7-0000-7000-8000-000000000001';
const SELLER = '0199c0a7-0000-7000-8000-000000000002';
const DRIVER = '0199c0a7-0000-7000-8000-000000000003';
const REGISTERED_CUSTOMER = '0199c0a7-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0a7-0000-7000-8000-000000000005';

const ORG_A = '0199c0a7-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0a7-0000-7000-8000-0000000000b1';
const ORG_CLOSED = '0199c0a7-0000-7000-8000-0000000000e1';

const REG = new Date('2026-01-01T00:00:00.000Z');

const NEW_PHONE = '+237600007100';
const CUSTOMER_PHONE = '+237600007004';

const GESTURE_1 = '0199c0a7-0000-7000-8000-0000000000c1';
const GESTURE_2 = '0199c0a7-0000-7000-8000-0000000000c2';

type RelationshipBody = {
  id: string;
  status: string;
  customer: { kind: string; person: { phone_number: string | null; registered: boolean } } | null;
  customer_label: string | null;
  delivery_address: string | null;
  credit_limit: number | null;
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

async function seedOrg(
  id: string,
  ownerId: string,
  status: 'ACTIVE' | 'CLOSED' = 'ACTIVE',
  withOwnerCollaboration = true
) {
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id, name: 'Org ' + id.slice(-2), status } });
    if (withOwnerCollaboration) {
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
    }
  });
}

async function seedMember(orgId: string, personId: string, role: 'SELLER' | 'DRIVER') {
  await prisma.collaboration.create({
    data: {
      id: orgId.replace(/.$/, '7').replace(/.{2}(?=.{10}$)/, personId.slice(-2)),
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

function addCustomer(orgId: string, body: unknown, personId = SELLER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/customers`)
    .send(body as object);
}

const goodBody = (over: Record<string, unknown> = {}) => ({
  id: GESTURE_1,
  phone_number: NEW_PHONE,
  customer_label: 'Maman Ngono',
  ...over,
});

async function counts() {
  return {
    relationships: await prisma.customerRelationship.count(),
    people: await prisma.person.count(),
    notifications: await prisma.notification.count(),
  };
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600007001');
  await seedPerson(SELLER, '+237600007002');
  await seedPerson(DRIVER, '+237600007003');
  await seedPerson(REGISTERED_CUSTOMER, CUSTOMER_PHONE);
  await seedPerson(OTHER_OWNER, '+237600007005');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, SELLER, 'SELLER');
  await seedMember(ORG_A, DRIVER, 'DRIVER');
  await seedOrg(ORG_B, OTHER_OWNER);
  await seedOrg(ORG_CLOSED, OWNER, 'CLOSED');
  await seedMember(ORG_CLOSED, SELLER, 'SELLER');
});

describe('POST /api/v1/organizations/:organizationId/customers', () => {
  it('AC-1 adds a new customer: 201, ACTIVE, limit 0, balance 0, guest person', async () => {
    const response = await addCustomer(ORG_A, goodBody({ delivery_address: 'Rue 1, Douala' }));

    expect(response.status).toBe(201);
    const body = bodyOf<RelationshipBody>(response);
    expect(body).toMatchObject({
      status: 'ACTIVE',
      credit_limit: 0,
      balance: 0,
      customer_label: 'Maman Ngono',
      delivery_address: 'Rue 1, Douala',
      customer: { kind: 'PERSON', person: { phone_number: NEW_PHONE, registered: false } },
    });

    const guest = await prisma.person.findFirstOrThrow({ where: { phoneNumber: NEW_PHONE } });
    expect(guest.registeredAt).toBeNull();
    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: body.id } });
    expect(row).toMatchObject({
      supplierOrganizationId: ORG_A,
      customerPersonId: guest.id,
      customerPhoneNumber: null,
      status: 'ACTIVE',
      creditLimit: 0n,
      balance: 0n,
      createdById: SELLER,
      creditLimitSetById: null,
    });
    expect(await prisma.creditLimitChange.count()).toBe(0);
  });

  it('accepts a number typed without the country code', async () => {
    const response = await addCustomer(ORG_A, goodBody({ phone_number: '600007100' }));
    expect(response.status).toBe(201);
    expect(bodyOf<RelationshipBody>(response).customer?.person.phone_number).toBe(NEW_PHONE);
  });

  it('AC-2 notifies a registered customer once with customer.added', async () => {
    const response = await addCustomer(ORG_A, goodBody({ phone_number: CUSTOMER_PHONE }));

    expect(response.status).toBe(201);
    const rows = await prisma.notification.findMany({
      where: { recipientId: REGISTERED_CUSTOMER },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceEvent: 'customer.added',
      readStatus: 'UNREAD',
      relatedEntityType: 'customer_relationship',
      relatedEntityId: bodyOf<RelationshipBody>(response).id,
    });
  });

  it('does not notify a guest customer', async () => {
    await addCustomer(ORG_A, goodBody());
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-3 answers 200 with the same relationship when the number is added again', async () => {
    const first = await addCustomer(ORG_A, goodBody({ phone_number: CUSTOMER_PHONE }));
    const before = await counts();

    const second = await addCustomer(
      ORG_A,
      goodBody({ id: GESTURE_2, phone_number: CUSTOMER_PHONE, customer_label: 'Autre nom' })
    );

    expect(second.status).toBe(200);
    expect(bodyOf<RelationshipBody>(second).id).toBe(bodyOf<RelationshipBody>(first).id);
    expect(bodyOf<RelationshipBody>(second).customer_label).toBe('Maman Ngono');
    expect(await counts()).toEqual(before);
  });

  it('AC-3 ignores a deleted relationship and creates a new one', async () => {
    const first = await addCustomer(ORG_A, goodBody());
    await prisma.customerRelationship.update({
      where: { id: bodyOf<RelationshipBody>(first).id },
      data: { deletedAt: new Date() },
    });

    const second = await addCustomer(ORG_A, goodBody({ id: GESTURE_2 }));

    expect(second.status).toBe(201);
    expect(bodyOf<RelationshipBody>(second).id).not.toBe(bodyOf<RelationshipBody>(first).id);
  });

  it('adds the same number to two businesses as two relationships', async () => {
    await seedMember(ORG_B, SELLER, 'SELLER');
    await addCustomer(ORG_A, goodBody());
    const other = await addCustomer(ORG_B, goodBody({ id: GESTURE_2 }));

    expect(other.status).toBe(201);
    expect(await prisma.customerRelationship.count()).toBe(2);
  });

  it('keeps one relationship when two sellers add the same number at once', async () => {
    const [a, b] = await Promise.all([
      addCustomer(ORG_A, goodBody({ id: GESTURE_1 })),
      addCustomer(ORG_A, goodBody({ id: GESTURE_2 }), OWNER),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(bodyOf<RelationshipBody>(a).id).toBe(bodyOf<RelationshipBody>(b).id);
    expect(await prisma.customerRelationship.count()).toBe(1);
  });

  describe('AC-4 refusals', () => {
    it.each([
      ['a landline', { phone_number: '+237222123456' }],
      ['a customer_label of 101 characters', { customer_label: 'x'.repeat(101) }],
      ['an empty customer_label', { customer_label: '' }],
      ['a delivery_address of 2001 characters', { delivery_address: 'x'.repeat(2001) }],
      ['a missing id', { id: undefined }],
    ])('answers 400 VALIDATION_ERROR for %s and stores nothing', async (_name, over) => {
      const before = await counts();

      const response = await addCustomer(ORG_A, goodBody(over));

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('222123456');
      expect(await counts()).toEqual(before);
    });

    it('answers 409 ORGANIZATION_NOT_ACTIVE for a CLOSED organization and stores nothing', async () => {
      const before = await counts();

      const response = await addCustomer(ORG_CLOSED, goodBody());

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
      expect(await counts()).toEqual(before);
    });

    it('answers 403 FORBIDDEN for a DRIVER and stores nothing', async () => {
      const before = await counts();

      const response = await addCustomer(ORG_A, goodBody(), DRIVER);

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
      expect(await counts()).toEqual(before);
    });

    it('answers 401 without a token', async () => {
      const response = await createAuthenticatedRequest(app, SELLER)
        .post(`/api/v1/organizations/${ORG_A}/customers`)
        .set('Authorization', 'Bearer nope')
        .send(goodBody());
      expect(response.status).toBe(401);
    });
  });

  it('AC-5 answers the same body twice for the same gesture id', async () => {
    const first = await addCustomer(ORG_A, goodBody());
    const before = await counts();

    const second = await addCustomer(ORG_A, goodBody());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await counts()).toEqual(before);
  });
});

describe('security', () => {
  it.each([
    ['credit_limit', 1000000],
    ['balance', 5000],
    ['status', 'ENDED'],
    ['created_by_id', OWNER],
    ['supplier_organization_id', ORG_B],
  ])('AB-1 refuses %s in the body with 400 and stores nothing', async (field, value) => {
    const before = await counts();

    const response = await addCustomer(ORG_A, goodBody({ [field]: value }));

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await counts()).toEqual(before);
  });

  it('AB-2 answers 404 to a member of A posting to business B', async () => {
    const before = await counts();

    const response = await addCustomer(ORG_B, goodBody());

    expect(response.status).toBe(404);
    expect(await counts()).toEqual(before);
  });
});
