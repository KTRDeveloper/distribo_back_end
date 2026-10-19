import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c009-0000-7000-8000-000000000001';
const MANAGER = '0199c009-0000-7000-8000-000000000002';
const SELLER = '0199c009-0000-7000-8000-000000000003';
const DRIVER = '0199c009-0000-7000-8000-000000000004';
const CUSTOMER = '0199c009-0000-7000-8000-000000000005';
const OTHER_PERSON = '0199c009-0000-7000-8000-000000000006';

const ORG = '0199c009-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c009-0000-7000-8000-0000000000a2';
const PRODUCT_A = '0199c009-0000-7000-8000-0000000000b1';
const PRODUCT_B = '0199c009-0000-7000-8000-0000000000b2';
const PRODUCT_INACTIVE = '0199c009-0000-7000-8000-0000000000b3';
const PRODUCT_FOREIGN = '0199c009-0000-7000-8000-0000000000b4';
const ORDER_ID = '0199c009-0000-7000-8000-0000000000c1';
const LINE_1 = '0199c009-0000-7000-8000-0000000000d1';
const LINE_2 = '0199c009-0000-7000-8000-0000000000d2';
const REL_ID = '0199c009-0000-7000-8000-0000000000e1';

const REG = new Date('2026-01-01T00:00:00.000Z');

type LineBody = {
  id: string;
  product_variant_id: string;
  label_applied: string;
  quantity: string;
  reference_price: number;
  unit_price_applied: number;
  amount: number;
};
type OrderBody = {
  id: string;
  customer_relationship_id: string;
  placed_by_party: string;
  status: string;
  total_amount: number;
  delivery_cost: number;
  delivery_address_applied: string | null;
  lines: LineBody[];
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
      id: `0199c009-0000-7000-8000-0000000001${n}0`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedProduct(
  id: string,
  organizationId: string,
  data: { name: string; unit: string; price: bigint; min?: string; status?: 'ACTIVE' | 'INACTIVE' }
) {
  await prisma.product.create({
    data: {
      id,
      organizationId,
      name: data.name,
      unit: data.unit,
      price: data.price,
      minOrderQuantity: data.min ?? null,
      status: data.status ?? 'ACTIVE',
    },
  });
}

async function seedRelationship(status: 'ACTIVE' | 'ENDED', address: string | null = null) {
  await prisma.customerRelationship.create({
    data: {
      id: REL_ID,
      supplierOrganizationId: ORG,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status,
      endedByParty: status === 'ENDED' ? 'SUPPLIER' : null,
      deliveryAddress: address,
      creditLimit: 0n,
    },
  });
}

const goodBody = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  supplier_organization_id: ORG,
  lines: [
    { id: LINE_1, product_variant_id: PRODUCT_A, quantity: '10' },
    { id: LINE_2, product_variant_id: PRODUCT_B, quantity: 2.5 },
  ],
  ...over,
});

function place(body: unknown, personId = CUSTOMER) {
  return createAuthenticatedRequest(app, personId)
    .post('/api/v1/orders')
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

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009001');
  await seedPerson(MANAGER, '+237600009002');
  await seedPerson(SELLER, '+237600009003');
  await seedPerson(DRIVER, '+237600009004');
  await seedPerson(CUSTOMER, '+237600009005');
  await seedPerson(OTHER_PERSON, '+237600009006');
  await prisma.organization.create({ data: { id: ORG, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(ORG, OWNER, 'OWNER', 1);
  await seedMember(ORG, MANAGER, 'MANAGER', 2);
  await seedMember(ORG, SELLER, 'SELLER', 3);
  await seedMember(ORG, DRIVER, 'DRIVER', 4);
  await seedProduct(PRODUCT_A, ORG, { name: 'Rice', unit: 'sack', price: 3000n });
  await seedProduct(PRODUCT_B, ORG, { name: 'Salt', unit: 'kg', price: 500n });
  await seedProduct(PRODUCT_INACTIVE, ORG, {
    name: 'Old',
    unit: 'kg',
    price: 100n,
    status: 'INACTIVE',
  });
  await seedProduct(PRODUCT_FOREIGN, OTHER_ORG, { name: 'Oil', unit: 'l', price: 900n });
});

describe('ORD-009 place an order', () => {
  describe('prices and totals (AC-1, C-17)', () => {
    it('freezes negotiated and default prices and sums the total', async () => {
      await seedRelationship('ACTIVE', '12 Rue du Marche');
      await prisma.customerPrice.create({
        data: {
          id: '0199c009-0000-7000-8000-0000000000f1',
          customerRelationshipId: REL_ID,
          productId: PRODUCT_A,
          price: 2800n,
          setById: OWNER,
        },
      });

      const response = await place(goodBody());

      expect(response.status).toBe(201);
      const body = bodyOf<OrderBody>(response);
      expect(body.id).toBe(ORDER_ID);
      expect(body.status).toBe('PENDING');
      expect(body.placed_by_party).toBe('CUSTOMER');
      expect(body.customer_relationship_id).toBe(REL_ID);
      expect(body.delivery_cost).toBe(0);
      expect(body.total_amount).toBe(29250);
      expect(body.delivery_address_applied).toBe('12 Rue du Marche');
      const byId = new Map(body.lines.map((line) => [line.id, line]));
      expect(byId.get(LINE_1)).toMatchObject({
        label_applied: 'Rice — sack',
        quantity: '10',
        reference_price: 2800,
        unit_price_applied: 2800,
        amount: 28000,
      });
      expect(byId.get(LINE_2)).toMatchObject({
        label_applied: 'Salt — kg',
        quantity: '2.5',
        reference_price: 500,
        unit_price_applied: 500,
        amount: 1250,
      });
      const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
      expect(order.enteredById).toBe(CUSTOMER);
      expect(order.status).toBe('PENDING');
      expect(order.totalAmount).toBe(29250n);
    });

    it('prefers the body address and stores the optional fields', async () => {
      await seedRelationship('ACTIVE', 'Default address');
      const response = await place(
        goodBody({
          delivery_address: 'Other address',
          desired_delivery_date: '2026-12-24',
          customer_note: 'Before noon',
        })
      );
      expect(response.status).toBe(201);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
      expect(order.deliveryAddressApplied).toBe('Other address');
      expect(order.customerNote).toBe('Before noon');
      expect(order.desiredDeliveryDate?.toISOString().slice(0, 10)).toBe('2026-12-24');
    });
  });

  describe('first order (AC-2, C-14)', () => {
    it('creates an ACTIVE relationship with credit limit 0 for the caller', async () => {
      const response = await place(goodBody());

      expect(response.status).toBe(201);
      const relationships = await prisma.customerRelationship.findMany();
      expect(relationships).toHaveLength(1);
      expect(relationships[0]).toMatchObject({
        supplierOrganizationId: ORG,
        customerPersonId: CUSTOMER,
        customerOrganizationId: null,
        status: 'ACTIVE',
        creditLimit: 0n,
      });
      expect(bodyOf<OrderBody>(response).customer_relationship_id).toBe(relationships[0]?.id);
    });
  });

  describe('team notified (AC-3)', () => {
    it('sends one unread order.placed to owner, managers and sellers only', async () => {
      const response = await place(goodBody());
      expect(response.status).toBe(201);

      const notifications = await prisma.notification.findMany({
        where: { sourceEvent: 'order.placed' },
      });
      expect(notifications.map((n) => n.recipientId).sort()).toEqual([OWNER, MANAGER, SELLER]);
      for (const notification of notifications) {
        expect(notification.readStatus).toBe('UNREAD');
        expect(notification.organizationId).toBe(ORG);
        expect(notification.relatedEntityType).toBe('order');
        expect(notification.relatedEntityId).toBe(ORDER_ID);
      }
      expect(await prisma.notification.count()).toBe(3);
    });
  });

  describe('refusals (AC-4, C-15)', () => {
    it('refuses a quantity below min_order_quantity with 400 and stores nothing', async () => {
      await prisma.product.update({ where: { id: PRODUCT_A }, data: { minOrderQuantity: '12' } });
      const response = await place(goodBody());
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await stored()).toEqual({ orders: 0, lines: 0, relationships: 0, notifications: 0 });
    });

    it.each([
      ['an INACTIVE product', PRODUCT_INACTIVE],
      ['a foreign product', PRODUCT_FOREIGN],
      ['an unknown product', '0199c009-0000-7000-8000-0000000000ff'],
    ])('refuses %s with 404', async (_name, productId) => {
      const response = await place(
        goodBody({ lines: [{ id: LINE_1, product_variant_id: productId, quantity: '1' }] })
      );
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await stored()).toEqual({ orders: 0, lines: 0, relationships: 0, notifications: 0 });
    });

    it.each(['CLOSED', 'SUSPENDED'] as const)(
      'refuses a %s business with 409 and stores nothing',
      async (status) => {
        await prisma.organization.update({ where: { id: ORG }, data: { status } });
        const response = await place(goodBody());
        expect(response.status).toBe(409);
        expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
        expect(await stored()).toEqual({ orders: 0, lines: 0, relationships: 0, notifications: 0 });
      }
    );

    it('refuses an unknown business with 404', async () => {
      const response = await place(
        goodBody({ supplier_organization_id: '0199c009-0000-7000-8000-0000000000fe' })
      );
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    });

    it.each(['CUSTOMER', 'SUPPLIER'] as const)(
      'refuses a relationship ENDED by the %s with 409',
      async (party) => {
        await seedRelationship('ENDED');
        await prisma.customerRelationship.update({
          where: { id: REL_ID },
          data: { endedByParty: party },
        });
        const response = await place(goodBody());
        expect(response.status).toBe(409);
        expect(bodyOf<ErrorBody>(response).error.code).toBe('RELATIONSHIP_NOT_ACTIVE');
        expect(await prisma.order.count()).toBe(0);
        expect(await prisma.notification.count()).toBe(0);
      }
    );

    const line = { id: LINE_1, product_variant_id: PRODUCT_A, quantity: '1' };
    const manyLines = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `0199c009-0000-7000-8000-${String(100000000000 + i)}`,
        product_variant_id: PRODUCT_A,
        quantity: '1',
      }));

    it.each([
      ['zero lines', []],
      ['101 lines', manyLines(101)],
      ['quantity 0', [{ id: LINE_1, product_variant_id: PRODUCT_A, quantity: 0 }]],
      ['quantity "0"', [{ id: LINE_1, product_variant_id: PRODUCT_A, quantity: '0' }]],
      ['4 decimals', [{ id: LINE_1, product_variant_id: PRODUCT_A, quantity: '1.0001' }]],
      ['a negative quantity', [{ id: LINE_1, product_variant_id: PRODUCT_A, quantity: '-1' }]],
      ['a malformed quantity', [{ id: LINE_1, product_variant_id: PRODUCT_A, quantity: '1e3' }]],
      ['a duplicate line id', [line, line]],
    ])('refuses %s with 400', async (_name, lines) => {
      const response = await place(goodBody({ lines }));
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await stored()).toEqual({ orders: 0, lines: 0, relationships: 0, notifications: 0 });
    });

    it('accepts exactly 100 lines', async () => {
      const response = await place(goodBody({ lines: manyLines(100) }));
      expect(response.status).toBe(201);
      expect(await prisma.orderLine.count()).toBe(100);
    });

    it('requires authentication', async () => {
      const { default: request } = await import('supertest');
      const response = await request(app).post('/api/v1/orders').send(goodBody());
      expect(response.status).toBe(401);
    });
  });

  describe('repeat (AC-5)', () => {
    it('stores one order and answers the same body twice', async () => {
      const first = await place(goodBody());
      const second = await place(goodBody());

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(await prisma.order.count()).toBe(1);
      expect(await prisma.notification.count()).toBe(3);
    });
  });

  describe('client price (AB-1, CWE-915, WSTG-BUSL-02)', () => {
    it.each([
      ['unit_price_applied', { unit_price_applied: 1 }],
      ['reference_price', { reference_price: 1 }],
      ['amount', { amount: 1 }],
    ])('refuses a line carrying %s', async (_field, extra) => {
      const response = await place(
        goodBody({ lines: [{ id: LINE_1, product_variant_id: PRODUCT_A, quantity: '1', ...extra }] })
      );
      expect(response.status).toBe(400);
      expect(await stored()).toEqual({ orders: 0, lines: 0, relationships: 0, notifications: 0 });
    });

    it.each([
      ['total_amount', { total_amount: 1 }],
      ['status', { status: 'CONFIRMED' }],
      ['placed_by_party', { placed_by_party: 'SUPPLIER' }],
      ['delivery_cost', { delivery_cost: 5 }],
    ])('refuses a body carrying %s', async (_field, extra) => {
      const response = await place(goodBody(extra));
      expect(response.status).toBe(400);
      expect(await stored()).toEqual({ orders: 0, lines: 0, relationships: 0, notifications: 0 });
    });
  });

  describe('other customer (AB-2, WSTG-ATHZ-04)', () => {
    it.each([
      ['customer_person_id', { customer_person_id: OTHER_PERSON }],
      ['customer_organization_id', { customer_organization_id: OTHER_ORG }],
      ['customer_relationship_id', { customer_relationship_id: REL_ID }],
    ])('refuses a body carrying %s', async (_field, extra) => {
      const response = await place(goodBody(extra));
      expect(response.status).toBe(400);
      expect(await stored()).toEqual({ orders: 0, lines: 0, relationships: 0, notifications: 0 });
    });

    it('always orders as the caller', async () => {
      const response = await place(goodBody(), OTHER_PERSON);
      expect(response.status).toBe(201);
      const relationship = await prisma.customerRelationship.findFirstOrThrow();
      expect(relationship.customerPersonId).toBe(OTHER_PERSON);
      const order = await prisma.order.findFirstOrThrow();
      expect(order.enteredById).toBe(OTHER_PERSON);
    });
  });
});
