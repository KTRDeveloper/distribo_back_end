import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { ordersAdapter } from '../../../src/modules/sync/adapters/order.adapter.js';
import type { Viewer } from '../../../src/modules/sync/sync.types.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const SELLER = '0199e012-0000-7000-8000-000000000001';
const DRIVER = '0199e012-0000-7000-8000-000000000003';
const OWNER_A = '0199e012-0000-7000-8000-000000000004';
const OWNER_B = '0199e012-0000-7000-8000-000000000005';
const CUSTOMER = '0199e012-0000-7000-8000-000000000006';
const CUSTOMER_2 = '0199e012-0000-7000-8000-000000000007';
const ORG_A = '0199e012-0000-7000-8000-0000000000a1';
const ORG_B = '0199e012-0000-7000-8000-0000000000b1';
const REL = '0199e012-0000-7000-8000-0000000000c1';
const REL_ENDED = '0199e012-0000-7000-8000-0000000000c2';
const REL_PENDING = '0199e012-0000-7000-8000-0000000000c3';
const REL_COUNTER = '0199e012-0000-7000-8000-0000000000c4';
const REL_OTHER = '0199e012-0000-7000-8000-0000000000c5';
const REL_DUPLICATE = '0199e012-0000-7000-8000-0000000000c6';
const PRODUCT = '0199e012-0000-7000-8000-0000000000d1';
const PRODUCT_RETIRED = '0199e012-0000-7000-8000-0000000000d2';
const PRODUCT_DELETED = '0199e012-0000-7000-8000-0000000000d3';
const PRODUCT_OTHER = '0199e012-0000-7000-8000-0000000000d4';
const ORDER = '0199e012-0000-7000-8000-000000000501';
const ORDER_2 = '0199e012-0000-7000-8000-000000000502';
const LINE = '0199e012-0000-7000-8000-000000000601';
const LINE_2 = '0199e012-0000-7000-8000-000000000602';
const LINE_3 = '0199e012-0000-7000-8000-000000000603';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const RETIRED_TEXT = 'Article retiré de la vente depuis la saisie';

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
};

const devices: Record<string, string> = {};

const push = (personId: string, changes: unknown) =>
  createAuthenticatedRequest(app, personId, devices[personId])
    .post(`/api/v1/sync/push?last_pulled_at=${Date.now()}`)
    .send({ changes });

const table = (part: Partial<{ created: unknown[]; updated: unknown[]; deleted: string[] }>) => ({
  created: [],
  updated: [],
  deleted: [],
  ...part,
});

const orderRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  customer_relationship_id: REL,
  delivery_address_applied: 'Rue 1',
  delivery_cost: 0,
  desired_delivery_date: null,
  customer_note: null,
  created_at: Date.parse('2026-09-30T08:00:00.000Z'),
  ...extra,
});

const lineRow = (id: string, orderId: string, extra: Record<string, unknown> = {}) => ({
  id,
  order_id: orderId,
  product_id: PRODUCT,
  quantity: '10',
  reference_price: 3000,
  unit_price_applied: 3000,
  ...extra,
});

/** One order of 10 units at 3000, in the shape a phone sends it. */
const simpleBatch = (orderExtra = {}, lineExtra = {}) => ({
  orders: table({ created: [orderRow(ORDER, orderExtra)] }),
  order_lines: table({ created: [lineRow(LINE, ORDER, lineExtra)] }),
});

async function seedPerson(id: string, phone: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Push Person',
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      ...(registered
        ? {
            email: `${phone.slice(1)}@example.test`,
            passwordHash: 'test-password-hash',
            registeredAt: LONG_AGO,
          }
        : {}),
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
  if (registered) {
    devices[id] = `0199e012-0000-7000-8000-0000000007${phone.slice(-2)}`;
    await prisma.device.create({
      data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
    });
  }
}

async function seedMember(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e012-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

async function seedRelationship(
  id: string,
  org: string,
  extra: Partial<{
    customerPersonId: string | null;
    customerLabel: string;
    status: 'ACTIVE' | 'PENDING' | 'ENDED';
    endedByParty: 'SUPPLIER';
    supplierPersonId: string;
  }> = {}
) {
  await prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: extra.supplierPersonId ? null : org,
      createdById: OWNER_A,
      createdAt: LONG_AGO,
      deliveryAddress: 'Rue 1',
      ...extra,
    },
  });
}

const sellerViewer: Viewer = {
  personId: SELLER,
  deviceId: 'device',
  memberships: [{ organizationId: ORG_A, role: 'SELLER', status: 'ACTIVE' }],
  scopeVersion: 0,
  isOnline: false,
};

/** Runs the orders adapter alone on already judged lines and returns its outcomes. */
const pushToOrdersAdapter = (created: Array<Record<string, unknown>>) =>
  prisma.$transaction((tx) =>
    ordersAdapter.push(
      { viewer: sellerViewer, tx },
      { table: 'orders', created, updated: [], deleted: [] }
    )
  );

const storedOrder = (id = ORDER) =>
  prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });

async function nothingStored() {
  expect(await prisma.order.count()).toBe(0);
  expect(await prisma.orderLine.count()).toBe(0);
}

describe('push of orders and order_lines (SYNC-012)', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600001201');
    await seedPerson(DRIVER, '+237600001203');
    await seedPerson(OWNER_A, '+237600001204');
    await seedPerson(OWNER_B, '+237600001205');
    await seedPerson(CUSTOMER, '+237600001206', false);
    await seedPerson(CUSTOMER_2, '+237600001207', false);
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('04', OWNER_A, ORG_A, 'OWNER');
    await seedMember('05', OWNER_B, ORG_B, 'OWNER');
    await seedMember('01', SELLER, ORG_A, 'SELLER');
    await seedMember('03', DRIVER, ORG_A, 'DRIVER');
    await prisma.product.create({
      data: { id: PRODUCT, organizationId: ORG_A, name: 'Riz', unit: 'sac', price: 3000n },
    });
    await prisma.product.create({
      data: {
        id: PRODUCT_RETIRED,
        organizationId: ORG_A,
        name: 'Sel',
        unit: 'kg',
        price: 500n,
        status: 'INACTIVE',
      },
    });
    await prisma.product.create({
      data: {
        id: PRODUCT_DELETED,
        organizationId: ORG_A,
        name: 'Huile',
        unit: 'l',
        price: 900n,
        deletedAt: LONG_AGO,
      },
    });
    await prisma.product.create({
      data: { id: PRODUCT_OTHER, organizationId: ORG_B, name: 'Sucre', unit: 'kg', price: 700n },
    });
    await seedRelationship(REL, ORG_A, { customerPersonId: CUSTOMER });
    await seedRelationship(REL_ENDED, ORG_A, {
      customerPersonId: CUSTOMER_2,
      status: 'ENDED',
      endedByParty: 'SUPPLIER',
    });
    // An invitation: the supplier is a person, so no organization's seller can reach it.
    await seedRelationship(REL_PENDING, ORG_A, {
      customerPersonId: CUSTOMER_2,
      supplierPersonId: OWNER_B,
      status: 'PENDING',
    });
    await seedRelationship(REL_COUNTER, ORG_A, { customerLabel: 'Comptoir' });
    await seedRelationship(REL_OTHER, ORG_B, { customerPersonId: CUSTOMER });
  });

  it('stores the order with the amounts the server computes (AC-1, CM-27)', async () => {
    const response = await push(
      SELLER,
      simpleBatch({ total_amount: 3, delivery_cost: 500 }, { amount: 1 })
    );

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
    const order = await storedOrder();
    expect(order).toMatchObject({
      customerRelationshipId: REL,
      placedByParty: 'SUPPLIER',
      status: 'CONFIRMED',
      enteredById: SELLER,
      deliveryAddressApplied: 'Rue 1',
      deliveryCost: 500n,
      totalAmount: 30500n,
      syncIssue: null,
      createdAt: new Date('2026-09-30T08:00:00.000Z'),
    });
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({
      id: LINE,
      productId: PRODUCT,
      labelApplied: 'Riz (sac)',
      referencePrice: 3000n,
      unitPriceApplied: 3000n,
      amount: 30000n,
      priceSetById: null,
      priceSetAt: null,
    });
    expect(order.lines[0].quantity.toFixed(3)).toBe('10.000');
  });

  it('sums several lines, rounding each half franc up, with decimal quantities (AC-1)', async () => {
    const response = await push(SELLER, {
      orders: table({ created: [orderRow(ORDER)] }),
      order_lines: table({
        created: [
          lineRow(LINE, ORDER, {
            quantity: '2.5',
            unit_price_applied: 3001,
            reference_price: 3001,
          }),
          lineRow(LINE_2, ORDER, { quantity: 3, unit_price_applied: 3000, reference_price: 3000 }),
        ],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const order = await storedOrder();
    // 2.5 x 3001 = 7502.5 -> 7503, plus 3 x 3000.
    expect(order.totalAmount).toBe(16503n);
    expect(order.lines.map((l) => l.amount).sort()).toEqual([7503n, 9000n].sort());
  });

  it('gives a price gap an author and a server time (AC-2, CM-16)', async () => {
    const before = Date.now();
    const response = await push(
      SELLER,
      simpleBatch({}, { unit_price_applied: 2800, price_set_by_id: OWNER_A, price_set_at: 1_000 })
    );

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const line = (await storedOrder()).lines[0];
    expect(line).toMatchObject({
      referencePrice: 3000n,
      unitPriceApplied: 2800n,
      amount: 28000n,
      priceSetById: SELLER,
    });
    expect(line.priceSetAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect((await storedOrder()).totalAmount).toBe(28000n);
  });

  it.each([
    ['INACTIVE', PRODUCT_RETIRED],
    ['deleted', PRODUCT_DELETED],
  ])(
    'stores an order whose product is %s now, flagged PRODUCT_RETIRED (AC-3)',
    async (_name, productId) => {
      const response = await push(SELLER, simpleBatch({}, { product_id: productId }));

      expect(response.status).toBe(200);
      expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
      const order = await storedOrder();
      expect(order.syncIssue).toBe(RETIRED_TEXT);
      expect(order.lines).toHaveLength(1);
      expect(order.totalAmount).toBe(30000n);
    }
  );

  it.each([
    ['an ENDED relationship', REL_ENDED, 'RELATIONSHIP_NOT_ACTIVE'],
    ['a counter', REL_COUNTER, 'USE_COUNTER_SALE'],
  ])(
    'makes an order on %s an issue and stores nothing (AC-4)',
    async (_name, relationshipId, code) => {
      const response = await push(
        SELLER,
        simpleBatch({ customer_relationship_id: relationshipId })
      );

      expect(response.status).toBe(200);
      expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
      await nothingStored();

      const outcomes = await pushToOrdersAdapter([
        orderRow(ORDER_2, { customer_relationship_id: relationshipId, entered_by_id: SELLER }),
      ]);
      expect(outcomes).toEqual([
        expect.objectContaining({ table: 'orders', id: ORDER_2, kind: 'issue', code }),
      ]);
      await nothingStored();
    }
  );

  it('makes an order on a PENDING relationship an issue and stores nothing (AC-4)', async () => {
    const outcomes = await pushToOrdersAdapter([
      orderRow(ORDER, { customer_relationship_id: REL_PENDING }),
    ]);

    expect(outcomes).toEqual([
      expect.objectContaining({ id: ORDER, kind: 'issue', code: 'RELATIONSHIP_NOT_ACTIVE' }),
    ]);
    await nothingStored();
  });

  it('keeps one order and its author when the batch is pushed twice or names someone else (AC-5)', async () => {
    const batch = simpleBatch({ entered_by_id: OWNER_A });

    const first = await push(SELLER, batch);
    const second = await push(SELLER, batch);

    expect(bodyOf<PushBody>(first).rejected).toEqual([]);
    expect(bodyOf<PushBody>(second)).toMatchObject({ accepted: 2, rejected: [] });
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.orderLine.count()).toBe(1);
    const order = await storedOrder();
    expect(order.enteredById).toBe(SELLER);
    expect(order.totalAmount).toBe(30000n);
  });

  it('recomputes a phone-chosen lower amount and total (AB-1, CWE-345)', async () => {
    const response = await push(
      SELLER,
      simpleBatch({ total_amount: 1 }, { amount: 1, delivered_quantity: '1' })
    );

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const order = await storedOrder();
    expect(order.totalAmount).toBe(30000n);
    expect(order.lines[0].amount).toBe(30000n);
    expect(order.lines[0].deliveredQuantity).toBeNull();
  });

  it('forbids an order on another organization relationship, lines included (AB-2)', async () => {
    const response = await push(SELLER, simpleBatch({ customer_relationship_id: REL_OTHER }));

    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(0);
    expect(body.rejected).toEqual([
      expect.objectContaining({ table: 'orders', id: ORDER, code: 'OUT_OF_SCOPE' }),
      expect.objectContaining({ table: 'order_lines', id: LINE, code: 'OUT_OF_SCOPE' }),
    ]);
    await nothingStored();
  });

  it('forbids a DRIVER to create an order', async () => {
    const response = await push(DRIVER, simpleBatch());

    expect(bodyOf<PushBody>(response).rejected[0]).toMatchObject({
      table: 'orders',
      code: 'FIELD_NOT_ALLOWED',
    });
    await nothingStored();
  });

  it('forbids a line naming a product of another organization without aborting the batch', async () => {
    const response = await push(SELLER, {
      orders: table({ created: [orderRow(ORDER)] }),
      order_lines: table({
        created: [lineRow(LINE, ORDER, { product_id: PRODUCT_OTHER }), lineRow(LINE_2, ORDER)],
      }),
    });

    expect(response.status).toBe(200);
    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([
      expect.objectContaining({ table: 'order_lines', id: LINE, code: 'OUT_OF_SCOPE' }),
    ]);
    const order = await storedOrder();
    expect(order.lines.map((l) => l.id)).toEqual([LINE_2]);
    expect(order.totalAmount).toBe(30000n);
  });

  it('sets aside a line with an unusable quantity or price and keeps the others', async () => {
    const response = await push(SELLER, {
      orders: table({ created: [orderRow(ORDER)] }),
      order_lines: table({
        created: [
          lineRow(LINE, ORDER, { quantity: '-3' }),
          lineRow(LINE_2, ORDER, { unit_price_applied: -5 }),
          lineRow(LINE_3, ORDER, { quantity: '1e3' }),
        ],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([]);
    expect(body.aside).toBe(3);
    const order = await storedOrder();
    expect(order.lines).toHaveLength(0);
    expect(order.totalAmount).toBe(0n);
  });

  it('sets aside an order with an unusable delivery cost and its lines', async () => {
    const response = await push(SELLER, simpleBatch({ delivery_cost: -1 }));

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([]);
    expect(body.aside).toBe(2);
    await nothingStored();
  });

  it('stores the order on the survivor when its relationship was merged earlier', async () => {
    await seedRelationship(REL_DUPLICATE, ORG_A, { customerLabel: 'Doublon' });
    await prisma.customerRelationship.update({
      where: { id: REL_DUPLICATE },
      data: { mergedIntoId: REL, deletedAt: new Date() },
    });

    const response = await push(SELLER, simpleBatch({ customer_relationship_id: REL_DUPLICATE }));

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [] });
    expect((await storedOrder()).customerRelationshipId).toBe(REL);
  });

  it('does not add a line to an order that is no longer open for it, nor abort the batch', async () => {
    await push(SELLER, simpleBatch());
    await prisma.order.update({
      where: { id: ORDER },
      data: { status: 'IN_DELIVERY' },
    });

    const response = await push(SELLER, {
      order_lines: table({ created: [lineRow(LINE_2, ORDER)] }),
    });

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect(await prisma.orderLine.count()).toBe(1);
    expect((await storedOrder()).totalAmount).toBe(30000n);
  });

  it('treats a line id sent twice in one batch as a repeat', async () => {
    const response = await push(SELLER, {
      orders: table({ created: [orderRow(ORDER)] }),
      order_lines: table({
        // The same line id twice in one batch: the second is a repeat, not a second row.
        created: [lineRow(LINE, ORDER), lineRow(LINE, ORDER)],
      }),
    });

    expect(response.status).toBe(200);
    expect(await prisma.orderLine.count()).toBe(1);
    expect((await storedOrder()).totalAmount).toBe(30000n);
  });
});
