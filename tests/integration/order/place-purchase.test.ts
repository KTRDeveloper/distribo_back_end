import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const SUP_OWNER = '0199c010-0000-7000-8000-000000000001';
const SUP_SELLER = '0199c010-0000-7000-8000-000000000002';
const BIZ_OWNER = '0199c010-0000-7000-8000-000000000011';
const BIZ_MANAGER = '0199c010-0000-7000-8000-000000000012';
const BIZ_SELLER = '0199c010-0000-7000-8000-000000000013';
const BIZ_DRIVER = '0199c010-0000-7000-8000-000000000014';
const OTHER_OWNER = '0199c010-0000-7000-8000-000000000020';
const OTHER_MANAGER = '0199c010-0000-7000-8000-000000000021';

const SUPPLIER = '0199c010-0000-7000-8000-0000000000a1';
const BUSINESS = '0199c010-0000-7000-8000-0000000000a2';
const OTHER_BUSINESS = '0199c010-0000-7000-8000-0000000000a3';
const PRODUCT_A = '0199c010-0000-7000-8000-0000000000b1';
const PRODUCT_B = '0199c010-0000-7000-8000-0000000000b2';
const ORDER_ID = '0199c010-0000-7000-8000-0000000000c1';
const LINE_1 = '0199c010-0000-7000-8000-0000000000d1';
const LINE_2 = '0199c010-0000-7000-8000-0000000000d2';
const PERSONAL_REL = '0199c010-0000-7000-8000-0000000000e1';

const REG = new Date('2026-01-01T00:00:00.000Z');

type OrderBody = {
  id: string;
  customer_relationship_id: string;
  placed_by_party: string;
  status: string;
  total_amount: number;
  lines: { id: string; unit_price_applied: number; amount: number }[];
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
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c010-0000-7000-8000-0000000001${n}0`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

const goodBody = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  supplier_organization_id: SUPPLIER,
  lines: [
    { id: LINE_1, product_variant_id: PRODUCT_A, quantity: '10' },
    { id: LINE_2, product_variant_id: PRODUCT_B, quantity: 2.5 },
  ],
  ...over,
});

function purchase(body: unknown, personId = BIZ_MANAGER, organizationId = BUSINESS) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/purchases`)
    .send(body as object);
}

async function stored() {
  return {
    orders: await prisma.order.count(),
    lines: await prisma.orderLine.count(),
    relationships: await prisma.customerRelationship.count(),
    notifications: await prisma.notification.count(),
  };
}

const NOTHING = { orders: 0, lines: 0, relationships: 0, notifications: 0 };

beforeEach(async () => {
  await seedPerson(SUP_OWNER, '+237600010001');
  await seedPerson(SUP_SELLER, '+237600010002');
  await seedPerson(BIZ_OWNER, '+237600010011');
  await seedPerson(BIZ_MANAGER, '+237600010012');
  await seedPerson(BIZ_SELLER, '+237600010013');
  await seedPerson(BIZ_DRIVER, '+237600010014');
  await seedPerson(OTHER_OWNER, '+237600010020');
  await seedPerson(OTHER_MANAGER, '+237600010021');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: BUSINESS, name: 'Business', status: 'ACTIVE' } });
  await prisma.organization.create({
    data: { id: OTHER_BUSINESS, name: 'Other business', status: 'ACTIVE' },
  });
  await seedMember(SUPPLIER, SUP_OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SUP_SELLER, 'SELLER', 2);
  await seedMember(BUSINESS, BIZ_OWNER, 'OWNER', 3);
  await seedMember(BUSINESS, BIZ_MANAGER, 'MANAGER', 4);
  await seedMember(BUSINESS, BIZ_SELLER, 'SELLER', 5);
  await seedMember(BUSINESS, BIZ_DRIVER, 'DRIVER', 6);
  await seedMember(OTHER_BUSINESS, OTHER_OWNER, 'OWNER', 8);
  await seedMember(OTHER_BUSINESS, OTHER_MANAGER, 'MANAGER', 7);
  await prisma.product.create({
    data: { id: PRODUCT_A, organizationId: SUPPLIER, name: 'Rice', unit: 'sack', price: 3000n },
  });
  await prisma.product.create({
    data: { id: PRODUCT_B, organizationId: SUPPLIER, name: 'Salt', unit: 'kg', price: 500n },
  });
});

describe('ORD-010 organization manager orders from a supplier', () => {
  describe('organization order (AC-1, C-14, C-17)', () => {
    it('creates the relationship for the business and leaves the personal one unchanged', async () => {
      await prisma.customerRelationship.create({
        data: {
          id: PERSONAL_REL,
          supplierOrganizationId: SUPPLIER,
          customerPersonId: BIZ_MANAGER,
          createdById: SUP_OWNER,
          status: 'ACTIVE',
          creditLimit: 500n,
        },
      });
      const before = await prisma.customerRelationship.findUniqueOrThrow({
        where: { id: PERSONAL_REL },
      });

      const response = await purchase(goodBody());

      expect(response.status).toBe(201);
      const body = bodyOf<OrderBody>(response);
      expect(body).toMatchObject({
        id: ORDER_ID,
        status: 'PENDING',
        placed_by_party: 'CUSTOMER',
        total_amount: 31250,
      });
      const relationship = await prisma.customerRelationship.findUniqueOrThrow({
        where: { id: body.customer_relationship_id },
      });
      expect(relationship).toMatchObject({
        supplierOrganizationId: SUPPLIER,
        customerOrganizationId: BUSINESS,
        customerPersonId: null,
        status: 'ACTIVE',
        creditLimit: 0n,
      });
      expect(body.customer_relationship_id).not.toBe(PERSONAL_REL);
      expect(
        await prisma.customerRelationship.findUniqueOrThrow({ where: { id: PERSONAL_REL } })
      ).toEqual(before);
      expect(await prisma.customerRelationship.count()).toBe(2);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
      expect(order.customerRelationshipId).toBe(relationship.id);
      expect(order.enteredById).toBe(BIZ_MANAGER);
    });

    it('reuses the business relationship and an OWNER may order too', async () => {
      const first = await purchase(goodBody());
      const second = await purchase(
        goodBody({
          id: '0199c010-0000-7000-8000-0000000000c2',
          lines: [
            {
              id: '0199c010-0000-7000-8000-0000000000d3',
              product_variant_id: PRODUCT_A,
              quantity: '1',
            },
          ],
        }),
        BIZ_OWNER
      );
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(bodyOf<OrderBody>(second).customer_relationship_id).toBe(
        bodyOf<OrderBody>(first).customer_relationship_id
      );
      expect(await prisma.customerRelationship.count()).toBe(1);
    });
  });

  describe('refusals (AC-2)', () => {
    it.each([
      ['a SELLER', BIZ_SELLER],
      ['a DRIVER', BIZ_DRIVER],
    ])('refuses %s with 403', async (_name, personId) => {
      const response = await purchase(goodBody(), personId);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
      expect(await stored()).toEqual(NOTHING);
    });

    it('refuses the same organization as supplier with 400', async () => {
      const response = await purchase(goodBody({ supplier_organization_id: BUSINESS }));
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await stored()).toEqual(NOTHING);
    });

    it('refuses a CLOSED calling organization with 409', async () => {
      await prisma.organization.update({ where: { id: BUSINESS }, data: { status: 'CLOSED' } });
      const response = await purchase(goodBody());
      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
      expect(await stored()).toEqual(NOTHING);
    });

    it('refuses a SUSPENDED calling organization with 409', async () => {
      await prisma.organization.update({ where: { id: BUSINESS }, data: { status: 'SUSPENDED' } });
      const response = await purchase(goodBody());
      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
      expect(await stored()).toEqual(NOTHING);
    });

    it('refuses a body naming the customer, with 400', async () => {
      const response = await purchase(goodBody({ customer_organization_id: OTHER_BUSINESS }));
      expect(response.status).toBe(400);
      expect(await stored()).toEqual(NOTHING);
    });

    it('requires authentication', async () => {
      const { default: request } = await import('supertest');
      const response = await request(app)
        .post(`/api/v1/organizations/${BUSINESS}/purchases`)
        .send(goodBody());
      expect(response.status).toBe(401);
    });
  });

  describe('same rules as a person (AC-3, C-17)', () => {
    it('applies the business negotiated price and notifies the supplier team', async () => {
      await purchase(goodBody({ lines: [{ id: LINE_1, product_variant_id: PRODUCT_A, quantity: '1' }] }));
      const relationship = await prisma.customerRelationship.findFirstOrThrow();
      await prisma.customerPrice.create({
        data: {
          id: '0199c010-0000-7000-8000-0000000000f1',
          customerRelationshipId: relationship.id,
          productId: PRODUCT_A,
          price: 2800n,
          setById: SUP_OWNER,
        },
      });
      await prisma.notification.deleteMany();

      const response = await purchase(
        goodBody({
          id: '0199c010-0000-7000-8000-0000000000c3',
          lines: [
            { id: '0199c010-0000-7000-8000-0000000000d4', product_variant_id: PRODUCT_A, quantity: '10' },
          ],
        })
      );

      expect(response.status).toBe(201);
      const body = bodyOf<OrderBody>(response);
      expect(body.lines[0]).toMatchObject({ unit_price_applied: 2800, amount: 28000 });
      const notifications = await prisma.notification.findMany({
        where: { sourceEvent: 'order.placed' },
      });
      expect(notifications.map((n) => n.recipientId).sort()).toEqual([SUP_OWNER, SUP_SELLER]);
    });

    it('refuses a quantity below the minimum with 400 and stores nothing', async () => {
      await prisma.product.update({ where: { id: PRODUCT_A }, data: { minOrderQuantity: '12' } });
      const response = await purchase(goodBody());
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await stored()).toEqual(NOTHING);
    });

    it('refuses a CLOSED supplier with 409 and an unknown one with 404', async () => {
      await prisma.organization.update({ where: { id: SUPPLIER }, data: { status: 'CLOSED' } });
      const closed = await purchase(goodBody());
      expect(closed.status).toBe(409);
      const unknown = await purchase(
        goodBody({
          id: '0199c010-0000-7000-8000-0000000000c9',
          supplier_organization_id: '0199c010-0000-7000-8000-0000000000fe',
        })
      );
      expect(unknown.status).toBe(404);
      expect(await stored()).toEqual(NOTHING);
    });

    it('answers a repeat with the first response', async () => {
      const first = await purchase(goodBody());
      const second = await purchase(goodBody());
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(await prisma.order.count()).toBe(1);
    });
  });

  describe('seller commits the business debt (AB-1, WSTG-ATHZ-03)', () => {
    it('answers 403 and stores nothing', async () => {
      const response = await purchase(goodBody(), BIZ_SELLER);
      expect(response.status).toBe(403);
      expect(await stored()).toEqual(NOTHING);
    });
  });

  describe('another business (AB-2, WSTG-ATHZ-04)', () => {
    it('answers 404 for a member of A posting under B and stores nothing', async () => {
      const response = await purchase(goodBody(), OTHER_MANAGER, BUSINESS);
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await stored()).toEqual(NOTHING);
    });
  });
});
