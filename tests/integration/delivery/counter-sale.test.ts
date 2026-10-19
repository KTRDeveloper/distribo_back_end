import { describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0d7-0000-7000-8000-000000000001';
const SELLER = '0199c0d7-0000-7000-8000-000000000003';
const DRIVER = '0199c0d7-0000-7000-8000-000000000004';
const CUSTOMER = '0199c0d7-0000-7000-8000-000000000006';
const OTHER_OWNER = '0199c0d7-0000-7000-8000-000000000007';

const SUPPLIER = '0199c0d7-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c0d7-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c0d7-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c0d7-0000-7000-8000-0000000000b2';
const COUNTER = '0199c0d7-0000-7000-8000-0000000000e1';
const NAMED = '0199c0d7-0000-7000-8000-0000000000e2';
const OTHER_COUNTER = '0199c0d7-0000-7000-8000-0000000000e3';

const REG = new Date('2026-01-01T00:00:00.000Z');

const gestureId = (n: number) => `0199c0d7-0000-7000-8000-0000000005${n}0`;
const saleId = (n: number) => `0199c0d7-0000-7000-8000-0000000006${n}0`;
const paymentId = (n: number) => `0199c0d7-0000-7000-8000-0000000007${n}0`;
const lineId = (n: number) => `0199c0d7-0000-7000-8000-0000000002${n}0`;

type SaleBody = {
  order: {
    id: string;
    status: string;
    total_amount: number;
    placed_by_party: string;
    delivery_address_applied: string | null;
    lines: Array<{ delivered_quantity: string | null; amount: number }>;
  };
  sale: { id: string; kind: string; amount: number; order_id: string };
  payment: { id: string; kind: string; amount: number; mode: string; order_id: string };
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
  role: 'OWNER' | 'SELLER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c0d7-0000-7000-8000-0000000004${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

/**
 * Supplier with an owner, a seller and a driver; a counter and a named customer; another business
 * with its own counter. The product costs 4500, so 2 of them make 9000.
 */
async function seedBase() {
  await seedPerson(OWNER, '+237600089001');
  await seedPerson(SELLER, '+237600089003');
  await seedPerson(DRIVER, '+237600089004');
  await seedPerson(CUSTOMER, '+237600089006');
  await seedPerson(OTHER_OWNER, '+237600089007');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 6);
  await prisma.product.create({
    data: { id: PRODUCT, organizationId: SUPPLIER, name: 'Rice', unit: 'sack', price: 4500n },
  });
  await prisma.product.create({
    data: { id: OTHER_PRODUCT, organizationId: OTHER_ORG, name: 'Oil', unit: 'can', price: 100n },
  });
  await prisma.customerRelationship.create({
    data: {
      id: COUNTER,
      supplierOrganizationId: SUPPLIER,
      customerLabel: 'Counter',
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 0n,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: NAMED,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 100000n,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: OTHER_COUNTER,
      supplierOrganizationId: OTHER_ORG,
      customerLabel: 'Other counter',
      createdById: OTHER_OWNER,
      status: 'ACTIVE',
      creditLimit: 0n,
    },
  });
}

function sell(
  personId: string,
  relationshipId: string,
  body: Record<string, unknown>,
  organizationId = SUPPLIER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/counters/${relationshipId}/sales`)
    .send(body);
}

/** 2 sacks at 4500 = 9000, paid `collected` in cash. */
function saleBody(n: number, collected: number, extra: Record<string, unknown> = {}) {
  return {
    id: gestureId(n),
    sale_entry_id: saleId(n),
    payment_entry_id: paymentId(n),
    lines: [{ id: lineId(n), product_variant_id: PRODUCT, quantity: '2' }],
    collected_amount: collected,
    mode: 'CASH',
    ...extra,
  };
}

async function expectNothingStored() {
  expect(await prisma.order.count()).toBe(0);
  expect(await prisma.orderLine.count()).toBe(0);
  expect(await prisma.ledgerEntry.count()).toBe(0);
  expect(await prisma.delivery.count()).toBe(0);
  expect(
    (await prisma.customerRelationship.findUniqueOrThrow({ where: { id: COUNTER } })).balance
  ).toBe(0n);
}

describe('DLV-009 seller validates a counter sale', () => {
  it('creates, delivers and pays the order at once (AC-1, CM-13)', async () => {
    await seedBase();

    const response = await sell(SELLER, COUNTER, saleBody(1, 9000));

    expect(response.status).toBe(201);
    const body = bodyOf<SaleBody>(response);
    expect(body.order).toMatchObject({
      status: 'DELIVERED',
      total_amount: 9000,
      placed_by_party: 'SUPPLIER',
      delivery_address_applied: null,
    });
    expect(body.order.lines).toMatchObject([{ delivered_quantity: '2', amount: 9000 }]);
    expect(body.sale).toMatchObject({
      id: saleId(1),
      kind: 'SALE',
      amount: 9000,
      order_id: body.order.id,
    });
    expect(body.payment).toMatchObject({
      id: paymentId(1),
      kind: 'PAYMENT',
      amount: 9000,
      mode: 'CASH',
      order_id: body.order.id,
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: body.order.id } });
    expect(order.id).toBe(gestureId(1));
    expect(order).toMatchObject({
      status: 'DELIVERED',
      placedByParty: 'SUPPLIER',
      enteredById: SELLER,
      deliveredById: SELLER,
      customerRelationshipId: COUNTER,
      deliveryAddressApplied: null,
      totalAmount: 9000n,
    });
    expect(order.deliveredAt).not.toBeNull();
    const entries = await prisma.ledgerEntry.findMany({ orderBy: { kind: 'asc' } });
    expect(entries.map((e) => [e.kind, e.amount, e.orderId, e.recordedById]).sort()).toEqual(
      [
        ['PAYMENT', 9000n, order.id, SELLER],
        ['SALE', 9000n, order.id, SELLER],
      ].sort()
    );
    expect(
      (await prisma.customerRelationship.findUniqueOrThrow({ where: { id: COUNTER } })).balance
    ).toBe(0n);
    expect(await prisma.delivery.count()).toBe(0);
  });

  it('prices on the server and applies a seller price gap as ORD-013 does (CM-13)', async () => {
    await seedBase();

    const response = await sell(
      OWNER,
      COUNTER,
      saleBody(1, 8000, {
        lines: [{ id: lineId(1), product_variant_id: PRODUCT, quantity: '2', unit_price_applied: 4000 }],
      })
    );

    expect(response.status).toBe(201);
    expect(bodyOf<SaleBody>(response).sale.amount).toBe(8000);
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId(1) } });
    expect(line).toMatchObject({ referencePrice: 4500n, unitPriceApplied: 4000n });
    expect(line.priceSetById).toBe(OWNER);
  });

  it.each([
    [9000, 201],
    [8999, 409],
    [9001, 409],
    [0, 409],
  ])('collected %i for a total of 9000 answers %i (AC-2, C-26)', async (collected, status) => {
    await seedBase();

    const response = await sell(SELLER, COUNTER, saleBody(1, collected));

    expect(response.status).toBe(status);
    if (status === 409) {
      expect(bodyOf<ErrorBody>(response).error.code).toBe('COUNTER_PAYMENT_INCOMPLETE');
      await expectNothingStored();
    }
  });

  it('answers 404 when the relationship has a customer (AC-3)', async () => {
    await seedBase();

    const response = await sell(SELLER, NAMED, saleBody(1, 9000));

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('answers the first response again for the same id and stores nothing twice (AC-4)', async () => {
    await seedBase();

    const first = await sell(SELLER, COUNTER, saleBody(1, 9000));
    const second = await sell(SELLER, COUNTER, saleBody(1, 9000));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.ledgerEntry.count()).toBe(2);
  });

  it('stores nothing when a later step fails: unknown product (AC-4)', async () => {
    await seedBase();

    const response = await sell(
      SELLER,
      COUNTER,
      saleBody(1, 9000, {
        lines: [
          { id: lineId(1), product_variant_id: PRODUCT, quantity: '2' },
          { id: lineId(2), product_variant_id: OTHER_PRODUCT, quantity: '1' },
        ],
      })
    );

    expect(response.status).toBe(404);
    await expectNothingStored();
  });

  it('stores nothing when the ledger write fails: a sale entry id already used (AC-4)', async () => {
    await seedBase();
    expect((await sell(SELLER, COUNTER, saleBody(1, 9000))).status).toBe(201);

    const response = await sell(SELLER, COUNTER, saleBody(2, 9000, { sale_entry_id: saleId(1) }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.ledgerEntry.count()).toBe(2);
    expect(
      (await prisma.customerRelationship.findUniqueOrThrow({ where: { id: COUNTER } })).balance
    ).toBe(0n);
  });

  it('refuses a partial payment on a counter and stores nothing (AB-1, WSTG-BUSL-01)', async () => {
    await seedBase();

    const response = await sell(SELLER, COUNTER, saleBody(1, 4500));

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('COUNTER_PAYMENT_INCOMPLETE');
    await expectNothingStored();
  });

  it('answers 404 for a counter of another business (AB-2, WSTG-ATHZ-04)', async () => {
    await seedBase();

    const response = await sell(SELLER, OTHER_COUNTER, saleBody(1, 9000));
    const viaOtherPath = await sell(SELLER, COUNTER, saleBody(2, 9000), OTHER_ORG);

    expect(response.status).toBe(404);
    expect(viaOtherPath.status).toBe(404);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('refuses a DRIVER, who cannot create orders (403)', async () => {
    await seedBase();

    const response = await sell(DRIVER, COUNTER, saleBody(1, 9000));

    expect(response.status).toBe(403);
    expect(await prisma.order.count()).toBe(0);
  });

  it('rejects unknown and computed fields with 400 (v5.0.0-15.3.3)', async () => {
    await seedBase();

    const response = await sell(SELLER, COUNTER, saleBody(1, 9000, { total_amount: 1 }));

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.order.count()).toBe(0);
  });

  it('refuses a suspended business (ORGANIZATION_NOT_ACTIVE) and stores nothing', async () => {
    await seedBase();
    await prisma.organization.update({ where: { id: SUPPLIER }, data: { status: 'SUSPENDED' } });

    const response = await sell(SELLER, COUNTER, saleBody(1, 9000));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    await expectNothingStored();
  });
});
