import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c039-0000-7000-8000-000000000001';
const MANAGER = '0199c039-0000-7000-8000-000000000002';
const SELLER = '0199c039-0000-7000-8000-000000000003';
const DRIVER = '0199c039-0000-7000-8000-000000000004';
const CUSTOMER = '0199c039-0000-7000-8000-000000000011';
const OTHER = '0199c039-0000-7000-8000-000000000012';
const SUPPLIER = '0199c039-0000-7000-8000-0000000000a1';
const PRODUCT_A = '0199c039-0000-7000-8000-0000000000b1';
const PRODUCT_B = '0199c039-0000-7000-8000-0000000000b2';
const ORDER_1 = '0199c039-0000-7000-8000-0000000000c1';
const ORDER_2 = '0199c039-0000-7000-8000-0000000000c2';
const ORDER_3 = '0199c039-0000-7000-8000-0000000000c3';
const LINE_1 = '0199c039-0000-7000-8000-0000000000d1';
const LINE_3 = '0199c039-0000-7000-8000-0000000000d3';
const LINE_4 = '0199c039-0000-7000-8000-0000000000d4';
const REG = new Date('2026-01-01T00:00:00.000Z');
const NOTE = 'Livrer après 10 h';

/** Server total of the replacement lines: 2 x 3000 + 3 x 500. */
const TOTAL = 7500;

type Replaced = {
  order: {
    id: string;
    status: string;
    total_amount: number;
    supplier_note: string | null;
    placed_by_party: string;
    lines: Array<{ unit_price_applied: number }>;
  };
  replaced_order_id: string;
};

async function seedPerson(id: string, phone: string, language: 'FR' | 'EN' = 'FR') {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
      preferredLanguage: language,
    },
  });
}

async function seedMember(
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c039-0000-7000-8000-0000000001${n}0`,
      personId,
      organizationId: SUPPLIER,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

const lines = (ids: [string, string]) => [
  { id: ids[0], product_variant_id: PRODUCT_A, quantity: '2' },
  { id: ids[1], product_variant_id: PRODUCT_B, quantity: 3 },
];

const replaceBody = (over: Record<string, unknown> = {}) => ({
  id: ORDER_2,
  lines: lines([LINE_3, LINE_4]),
  expected_total: TOTAL,
  ...over,
});

const replace = (payload: unknown, orderId = ORDER_1, personId = CUSTOMER) =>
  createAuthenticatedRequest(app, personId)
    .post(`/api/v1/orders/${orderId}/replace`)
    .send(payload as object);

async function snapshot() {
  return {
    orders: await prisma.order.findMany({ orderBy: { id: 'asc' } }),
    lines: await prisma.orderLine.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
  };
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600039001', 'FR');
  await seedPerson(MANAGER, '+237600039002', 'EN');
  await seedPerson(SELLER, '+237600039003', 'FR');
  await seedPerson(DRIVER, '+237600039004', 'FR');
  await seedPerson(CUSTOMER, '+237600039011');
  await seedPerson(OTHER, '+237600039012');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await seedMember(OWNER, 'OWNER', 1);
  await seedMember(MANAGER, 'MANAGER', 2);
  await seedMember(SELLER, 'SELLER', 3);
  await seedMember(DRIVER, 'DRIVER', 4);
  await seedProduct(prisma, {
    id: PRODUCT_A,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: PRODUCT_B,
    organizationId: SUPPLIER,
    name: 'Salt',
    unit: 'kg',
    price: 500n,
  });
  // O1 is placed through the API, so the team holds a real order.placed about it.
  const placed = await createAuthenticatedRequest(app, CUSTOMER)
    .post('/api/v1/orders')
    .send({
      id: ORDER_1,
      supplier_organization_id: SUPPLIER,
      customer_note: 'Merci',
      lines: [{ id: LINE_1, product_variant_id: PRODUCT_A, quantity: '1' }],
    });
  expect(placed.status).toBe(201);
  await prisma.order.update({ where: { id: ORDER_1 }, data: { supplierNote: NOTE } });
});

describe('ORD-039 the customer changes a pending order', () => {
  it('AC-1 replaces O1 by O2, priced today, with the supplier note', async () => {
    const before = await prisma.orderLine.findMany({ where: { orderId: ORDER_1 } });
    const res = await replace(replaceBody());
    expect(res.status).toBe(201);
    const view = bodyOf<Replaced>(res);
    expect(view.replaced_order_id).toBe(ORDER_1);
    expect(view.order.id).toBe(ORDER_2);
    expect(view.order.status).toBe('PENDING');
    expect(view.order.placed_by_party).toBe('CUSTOMER');
    expect(view.order.total_amount).toBe(TOTAL);
    expect(view.order.supplier_note).toBe(NOTE);
    expect(view.order.lines.map((line) => line.unit_price_applied).sort()).toEqual([3000, 500]);

    const o1 = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_1 } });
    const o2 = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_2 } });
    expect(o1.status).toBe('CANCELLED');
    expect(o1.cancelledByParty).toBe('CUSTOMER');
    expect(o1.deletedAt).not.toBeNull();
    expect(o1.replacedByOrderId).toBe(ORDER_2);
    expect(o2.customerRelationshipId).toBe(o1.customerRelationshipId);
    expect(o2.enteredById).toBe(CUSTOMER);
    expect(o2.customerNote).toBeNull();
    expect(await prisma.orderLine.findMany({ where: { orderId: ORDER_1 } })).toEqual(before);

    const detail = await createAuthenticatedRequest(app, CUSTOMER).get(`/api/v1/orders/${ORDER_1}`);
    expect(detail.status).toBe(404);
    const customerList = await createAuthenticatedRequest(app, CUSTOMER).get('/api/v1/orders');
    expect(bodyOf<{ items: Array<{ id: string }> }>(customerList).items.map((o) => o.id)).toEqual([
      ORDER_2,
    ]);
    const supplierList = await createAuthenticatedRequest(app, OWNER).get(
      `/api/v1/organizations/${SUPPLIER}/orders`
    );
    expect(bodyOf<{ items: Array<{ id: string }> }>(supplierList).items.map((o) => o.id)).toEqual([
      ORDER_2,
    ]);
  });

  it('AC-2 tells each team member once and moves the order.placed to O2', async () => {
    const res = await replace(replaceBody());
    expect(res.status).toBe(201);
    const notes = await prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });
    expect(notes).toHaveLength(6);
    const placed = notes.filter((n) => n.sourceEvent === 'order.placed');
    expect(placed).toHaveLength(3);
    expect(placed.every((n) => n.relatedEntityId === ORDER_2)).toBe(true);
    const replaced = notes.filter((n) => n.sourceEvent === 'order.replaced');
    expect(replaced.map((n) => n.recipientId).sort()).toEqual([OWNER, MANAGER, SELLER].sort());
    expect(replaced.every((n) => n.relatedEntityType === 'order')).toBe(true);
    expect(replaced.every((n) => n.relatedEntityId === ORDER_2)).toBe(true);
    const byRecipient = new Map(replaced.map((n) => [n.recipientId, n.content]));
    expect(byRecipient.get(OWNER)).toBe('Commande modifiée par le client.');
    expect(byRecipient.get(MANAGER)).toBe('Order changed by the customer.');
    expect(notes.some((n) => n.sourceEvent === 'order.status_changed')).toBe(false);
  });

  it('AC-3 refuses a CONFIRMED order with 409 INVALID_TRANSITION and changes nothing', async () => {
    await prisma.order.update({ where: { id: ORDER_1 }, data: { status: 'CONFIRMED' } });
    const before = await snapshot();
    const res = await replace(replaceBody());
    expect(res.status).toBe(409);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('INVALID_TRANSITION');
    expect(await snapshot()).toEqual(before);
  });

  it('AC-3 refuses a different expected_total with 409 TOTAL_CHANGED and changes nothing', async () => {
    const before = await snapshot();
    const res = await replace(replaceBody({ expected_total: TOTAL - 1 }));
    expect(res.status).toBe(409);
    const error = bodyOf<ErrorBody>(res).error;
    expect(error.code).toBe('TOTAL_CHANGED');
    expect(error.details).toEqual({ total: TOTAL });
    expect(await snapshot()).toEqual(before);
  });

  it('AC-4 a repeat with the same id returns the first 201 and one new version', async () => {
    const first = await replace(replaceBody());
    const again = await replace(replaceBody());
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await prisma.order.count()).toBe(2);
  });

  it('requires expected_total', async () => {
    const before = await snapshot();
    const res = await replace({ id: ORDER_2, lines: lines([LINE_3, LINE_4]) });
    expect(res.status).toBe(400);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    expect(await snapshot()).toEqual(before);
  });

  it('AB-1 another customer gets 404 and nothing changes', async () => {
    const before = await snapshot();
    const res = await replace(replaceBody(), ORDER_1, OTHER);
    expect(res.status).toBe(404);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    expect(await snapshot()).toEqual(before);
  });

  it('AB-2 a version already replaced answers 404 and no third version exists', async () => {
    expect((await replace(replaceBody())).status).toBe(201);
    const res = await replace(
      replaceBody({ id: ORDER_3, lines: lines([LINE_3, LINE_4]) }),
      ORDER_1
    );
    expect(res.status).toBe(404);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    expect(await prisma.order.count()).toBe(2);
  });

  it.each([
    ['status', { status: 'CONFIRMED' }],
    ['unit_price_applied', { unit_price_applied: 1 }],
    ['supplier_organization_id', { supplier_organization_id: SUPPLIER }],
  ])('AB-3 an extra field %s answers 400 and nothing changes', async (_name, extra) => {
    const before = await snapshot();
    const res = await replace(replaceBody(extra));
    expect(res.status).toBe(400);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    expect(await snapshot()).toEqual(before);
  });

  it('AB-3 a line price is refused', async () => {
    const before = await snapshot();
    const res = await replace(
      replaceBody({
        lines: [
          { id: LINE_3, product_variant_id: PRODUCT_A, quantity: '2', unit_price_applied: 1 },
          { id: LINE_4, product_variant_id: PRODUCT_B, quantity: 3 },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });
});
