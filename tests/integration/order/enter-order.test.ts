import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c013-0000-7000-8000-000000000001';
const SELLER = '0199c013-0000-7000-8000-000000000003';
const DRIVER = '0199c013-0000-7000-8000-000000000004';
const CUSTOMER = '0199c013-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c013-0000-7000-8000-000000000006';

const SUPPLIER = '0199c013-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c013-0000-7000-8000-0000000000a2';
const PRODUCT_A = '0199c013-0000-7000-8000-0000000000b1';
const PRODUCT_B = '0199c013-0000-7000-8000-0000000000b2';
const PRODUCT_OFF = '0199c013-0000-7000-8000-0000000000b3';
const OTHER_PRODUCT = '0199c013-0000-7000-8000-0000000000b4';
const REL = '0199c013-0000-7000-8000-0000000000e1';
const COUNTER_REL = '0199c013-0000-7000-8000-0000000000e2';
const ENDED_REL = '0199c013-0000-7000-8000-0000000000e3';
const OTHER_REL = '0199c013-0000-7000-8000-0000000000e4';
const ORDER_ID = '0199c013-0000-7000-8000-0000000000c1';
const LINE_1 = '0199c013-0000-7000-8000-0000000000d1';
const LINE_2 = '0199c013-0000-7000-8000-0000000000d2';
const LINE_3 = '0199c013-0000-7000-8000-0000000000d3';

const REG = new Date('2026-01-01T00:00:00.000Z');

type LineBody = {
  id: string;
  reference_price: number;
  unit_price_applied: number;
  amount: number;
};
type OrderBody = {
  id: string;
  status: string;
  placed_by_party: string;
  entered_by_id: string;
  total_amount: number;
  delivery_cost: number;
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
      preferredLanguage: 'EN',
    },
  });
}

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'SELLER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c013-0000-7000-8000-0000000001${n}0`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

function enter(body: unknown, personId = SELLER, organizationId = SUPPLIER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/orders`)
    .send(body as object);
}

function bodyWith(extra: Record<string, unknown> = {}, lines?: unknown[]) {
  return {
    id: ORDER_ID,
    customer_relationship_id: REL,
    lines: lines ?? [{ id: LINE_1, product_id: PRODUCT_A, quantity: 10 }],
    ...extra,
  };
}

async function nothingStored() {
  expect(await prisma.order.count()).toBe(0);
  expect(await prisma.orderLine.count()).toBe(0);
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600013001');
  await seedPerson(SELLER, '+237600013003');
  await seedPerson(DRIVER, '+237600013004');
  await seedPerson(CUSTOMER, '+237600013005');
  await seedPerson(OTHER_OWNER, '+237600013006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await prisma.product.create({
    data: { id: PRODUCT_A, organizationId: SUPPLIER, name: 'Rice', unit: 'sack', price: 3000n },
  });
  await prisma.product.create({
    data: {
      id: PRODUCT_B,
      organizationId: SUPPLIER,
      name: 'Salt',
      unit: 'kg',
      price: 500n,
      minOrderQuantity: '5',
    },
  });
  await prisma.product.create({
    data: {
      id: PRODUCT_OFF,
      organizationId: SUPPLIER,
      name: 'Old',
      unit: 'kg',
      price: 100n,
      status: 'INACTIVE',
    },
  });
  await prisma.product.create({
    data: { id: OTHER_PRODUCT, organizationId: OTHER_ORG, name: 'Oil', unit: 'l', price: 900n },
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
      deliveryAddress: 'Rue 1',
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: COUNTER_REL,
      supplierOrganizationId: SUPPLIER,
      customerLabel: 'Comptoir',
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 0n,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: ENDED_REL,
      supplierOrganizationId: SUPPLIER,
      customerLabel: 'Old customer',
      customerPersonId: OTHER_OWNER,
      createdById: OWNER,
      status: 'ENDED',
      endedByParty: 'SUPPLIER',
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: OTHER_REL,
      supplierOrganizationId: OTHER_ORG,
      customerPersonId: CUSTOMER,
      createdById: OTHER_OWNER,
      status: 'ACTIVE',
    },
  });
});

describe('ORD-013 seller enters an order for a customer', () => {
  it('enters at the reference price: CONFIRMED by the supplier, prices equal, total (AC-1, C-17)', async () => {
    const response = await enter(bodyWith());

    expect(response.status).toBe(201);
    const body = bodyOf<OrderBody>(response);
    expect(body).toMatchObject({
      id: ORDER_ID,
      status: 'CONFIRMED',
      placed_by_party: 'SUPPLIER',
      entered_by_id: SELLER,
      total_amount: 30000,
      delivery_cost: 0,
    });
    expect(body.lines[0]).toMatchObject({
      id: LINE_1,
      reference_price: 3000,
      unit_price_applied: 3000,
      amount: 30000,
    });
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE_1 } });
    expect(line.priceSetById).toBeNull();
    expect(line.priceSetAt).toBeNull();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
    expect(order).toMatchObject({
      status: 'CONFIRMED',
      placedByParty: 'SUPPLIER',
      enteredById: SELLER,
      deliveryAddressApplied: 'Rue 1',
    });
  });

  it('uses the negotiated price as the reference (AC-1, CAT-003)', async () => {
    await prisma.customerPrice.create({
      data: {
        id: '0199c013-0000-7000-8000-0000000000f1',
        customerRelationshipId: REL,
        productId: PRODUCT_A,
        price: 2500n,
        setById: OWNER,
      },
    });

    const response = await enter(bodyWith());

    expect(response.status).toBe(201);
    expect(bodyOf<OrderBody>(response).lines[0]).toMatchObject({
      reference_price: 2500,
      unit_price_applied: 2500,
      amount: 25000,
    });
  });

  it('records the author and time of a price gap, amount at the entered price (AC-2)', async () => {
    const response = await enter(
      bodyWith({}, [{ id: LINE_1, product_id: PRODUCT_A, quantity: 10, unit_price_applied: 2800 }])
    );

    expect(response.status).toBe(201);
    expect(bodyOf<OrderBody>(response)).toMatchObject({ total_amount: 28000 });
    expect(bodyOf<OrderBody>(response).lines[0]).toMatchObject({
      reference_price: 3000,
      unit_price_applied: 2800,
      amount: 28000,
    });
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE_1 } });
    expect(line.priceSetById).toBe(SELLER);
    expect(line.priceSetAt).not.toBeNull();
    expect(line.referencePrice).toBe(3000n);
  });

  it('accepts a price above the reference or equal to 0, and ignores the minimum quantity (AC-2)', async () => {
    const response = await enter(
      bodyWith({}, [
        { id: LINE_1, product_id: PRODUCT_A, quantity: 1, unit_price_applied: 3500 },
        { id: LINE_2, product_id: PRODUCT_B, quantity: 1, unit_price_applied: 0 },
      ])
    );

    expect(response.status).toBe(201);
    expect(bodyOf<OrderBody>(response).total_amount).toBe(3500);
    const lines = await prisma.orderLine.findMany({ where: { orderId: ORDER_ID } });
    expect(lines.every((line) => line.priceSetById === SELLER)).toBe(true);
  });

  it('adds the delivery cost to the total (AC-3, C-14)', async () => {
    const response = await enter(bodyWith({ delivery_cost: 2000 }));

    expect(response.status).toBe(201);
    expect(bodyOf<OrderBody>(response)).toMatchObject({ total_amount: 32000, delivery_cost: 2000 });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
    expect(order.deliveryCost).toBe(2000n);
    expect(order.totalAmount).toBe(32000n);
  });

  it('refuses a counter relationship with USE_COUNTER_SALE (AC-4)', async () => {
    const response = await enter(bodyWith({ customer_relationship_id: COUNTER_REL }));

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('USE_COUNTER_SALE');
    await nothingStored();
  });

  it('refuses an ENDED relationship with RELATIONSHIP_NOT_ACTIVE (AC-4)', async () => {
    const response = await enter(bodyWith({ customer_relationship_id: ENDED_REL }));

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('RELATIONSHIP_NOT_ACTIVE');
    await nothingStored();
  });

  it('refuses an INACTIVE product or a product of another business with 404, storing nothing (AC-4, C-15)', async () => {
    for (const productId of [PRODUCT_OFF, OTHER_PRODUCT]) {
      const response = await enter(
        bodyWith({}, [
          { id: LINE_1, product_id: PRODUCT_A, quantity: 1 },
          { id: LINE_2, product_id: productId, quantity: 1 },
        ])
      );
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      await nothingStored();
    }
  });

  it('refuses a relationship of another business with 404 (AC-4, AB-1)', async () => {
    const response = await enter(bodyWith({ customer_relationship_id: OTHER_REL }));

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    await nothingStored();
  });

  it('refuses a DRIVER with 403 and a non-member with 404 (AC-4)', async () => {
    const driver = await enter(bodyWith(), DRIVER);
    expect(driver.status).toBe(403);
    expect(bodyOf<ErrorBody>(driver).error.code).toBe('FORBIDDEN');

    const stranger = await enter(bodyWith(), OTHER_OWNER);
    expect(stranger.status).toBe(404);
    await nothingStored();
  });

  it('refuses a suspended business with 409 (C-14)', async () => {
    await prisma.organization.update({ where: { id: SUPPLIER }, data: { status: 'SUSPENDED' } });

    const response = await enter(bodyWith());

    expect(response.status).toBe(409);
    await nothingStored();
  });

  it('refuses zero lines and more than 100 lines (AC-4)', async () => {
    const none = await enter(bodyWith({}, []));
    expect(none.status).toBe(400);
    expect(bodyOf<ErrorBody>(none).error.code).toBe('VALIDATION_ERROR');

    const many = await enter(
      bodyWith(
        {},
        Array.from({ length: 101 }, (_, index) => ({
          id: `0199c013-0000-7000-8000-${String(index + 1000).padStart(12, '0')}`,
          product_id: PRODUCT_A,
          quantity: 1,
        }))
      )
    );
    expect(many.status).toBe(400);
    expect(bodyOf<ErrorBody>(many).error.code).toBe('VALIDATION_ERROR');
    await nothingStored();
  });

  it('refuses a negative or fractional delivery cost or price (AC-4, v5.0.0-15.3.3)', async () => {
    for (const body of [
      bodyWith({ delivery_cost: -1 }),
      bodyWith({ delivery_cost: 1.5 }),
      bodyWith({}, [{ id: LINE_1, product_id: PRODUCT_A, quantity: 1, unit_price_applied: -1 }]),
      bodyWith({}, [{ id: LINE_1, product_id: PRODUCT_A, quantity: 1, unit_price_applied: 1.5 }]),
    ]) {
      const response = await enter(body);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    await nothingStored();
  });

  it('repeats the same body: one order, same answer (AC-5)', async () => {
    const first = await enter(bodyWith());
    const second = await enter(bodyWith());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.orderLine.count()).toBe(1);
  });

  it('rejects client-chosen totals, status, prices and party (AC-4, AB-2, CWE-915)', async () => {
    for (const extra of [
      { total_amount: 1 },
      { status: 'PENDING' },
      { amount: 1 },
      { reference_price: 1 },
      { placed_by_party: 'CUSTOMER' },
      { entered_by_id: OWNER },
    ]) {
      const response = await enter(bodyWith(extra));
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    const lineExtra = await enter(
      bodyWith({}, [{ id: LINE_1, product_id: PRODUCT_A, quantity: 1, reference_price: 1 }])
    );
    expect(lineExtra.status).toBe(400);
    const lineAmount = await enter(
      bodyWith({}, [{ id: LINE_1, product_id: PRODUCT_A, quantity: 1, amount: 1 }])
    );
    expect(lineAmount.status).toBe(400);
    await nothingStored();
  });

  it('keeps the price author away from the SELLER view (v5.0.0-8.2.3)', async () => {
    const asSeller = await enter(
      bodyWith({}, [{ id: LINE_1, product_id: PRODUCT_A, quantity: 1, unit_price_applied: 2000 }])
    );
    expect(asSeller.status).toBe(201);
    expect(bodyOf<OrderBody>(asSeller).lines[0]).not.toHaveProperty('price_set_by_id');

    const asOwner = await enter(
      bodyWith({ id: '0199c013-0000-7000-8000-0000000000c2' }, [
        { id: LINE_3, product_id: PRODUCT_A, quantity: 1, unit_price_applied: 2000 },
      ]),
      OWNER
    );
    expect(asOwner.status).toBe(201);
    expect(bodyOf<OrderBody>(asOwner).lines[0]).toHaveProperty('price_set_by_id', OWNER);
  });
});
