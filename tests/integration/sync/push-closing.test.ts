import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { deliverOrder } from '../../../src/modules/delivery/delivery.service.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const SELLER = '0199e014-0000-7000-8000-000000000001';
const DRIVER = '0199e014-0000-7000-8000-000000000003';
const DRIVER_2 = '0199e014-0000-7000-8000-000000000004';
const OWNER_A = '0199e014-0000-7000-8000-000000000005';
const OWNER_B = '0199e014-0000-7000-8000-000000000006';
const CUSTOMER = '0199e014-0000-7000-8000-000000000007';
const ORG_A = '0199e014-0000-7000-8000-0000000000a1';
const ORG_B = '0199e014-0000-7000-8000-0000000000b1';
const REL = '0199e014-0000-7000-8000-0000000000c1';
const REL_B = '0199e014-0000-7000-8000-0000000000c2';
const PRODUCT = '0199e014-0000-7000-8000-0000000000d1';
const PRODUCT_B = '0199e014-0000-7000-8000-0000000000d2';
const ORDER = '0199e014-0000-7000-8000-000000000501';
const ORDER_B = '0199e014-0000-7000-8000-000000000502';
const CHILD = '0199e014-0000-7000-8000-000000000503';
const LINE = '0199e014-0000-7000-8000-000000000601';
const LINE_B = '0199e014-0000-7000-8000-000000000602';
const CHILD_LINE = '0199e014-0000-7000-8000-000000000603';
const DELIVERY = '0199e014-0000-7000-8000-000000000701';
const DELIVERY_2 = '0199e014-0000-7000-8000-000000000702';
const SALE = '0199e014-0000-7000-8000-000000000801';
const PAYMENT = '0199e014-0000-7000-8000-000000000802';
const PAYMENT_2 = '0199e014-0000-7000-8000-000000000803';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const DEPARTED = Date.parse('2026-09-30T08:00:00.000Z');

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
};

const devices: Record<string, string> = {};

const push = async (personId: string, changes: unknown) =>
  createAuthenticatedRequest(app, personId, devices[personId])
    .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
    .send({ changes });

const table = (part: Partial<{ created: unknown[]; updated: unknown[]; deleted: string[] }>) => ({
  created: [],
  updated: [],
  deleted: [],
  ...part,
});

const delivered = (id = ORDER) => table({ updated: [{ id, status: 'DELIVERED' }] });

const saleRow = (amount: number, id = SALE, orderId = ORDER) => ({
  id,
  customer_relationship_id: REL,
  order_id: orderId,
  kind: 'SALE',
  amount,
});

const paymentRow = (amount: number, id = PAYMENT, orderId = ORDER) => ({
  id,
  customer_relationship_id: REL,
  order_id: orderId,
  kind: 'PAYMENT',
  amount,
  mode: 'CASH',
});

async function seedPerson(id: string, phone: string, name: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: name,
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
    devices[id] = `0199e014-0000-7000-8000-0000000009${phone.slice(-2)}`;
    await prisma.device.create({
      data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
    });
  }
}

async function seedMember(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e014-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

/** An order of `quantity` sacks at 3000 on `relationship`, with one line. */
async function seedOrder(
  id: string,
  lineId: string,
  status: 'CONFIRMED' | 'IN_DELIVERY' | 'DELIVERED' | 'CANCELLED',
  options: { quantity?: number; relationship?: string; product?: string } = {}
) {
  const quantity = options.quantity ?? 10;
  const total = BigInt(quantity) * 3000n;
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: options.relationship ?? REL,
      placedByParty: 'SUPPLIER',
      enteredById: OWNER_A,
      status,
      deliveryAddressApplied: 'Rue 1',
      deliveryCost: 0n,
      totalAmount: total,
      createdAt: LONG_AGO,
      ...(status === 'DELIVERED'
        ? { deliveredAt: new Date('2026-09-30T10:30:00.000Z'), deliveredById: DRIVER_2 }
        : {}),
      ...(status === 'CANCELLED'
        ? {
            cancelledByParty: 'SUPPLIER' as const,
            cancelledById: OWNER_A,
            cancelledAt: LONG_AGO,
            cancellationReason: 'Erreur de saisie',
          }
        : {}),
      lines: {
        create: {
          id: lineId,
          productId: options.product ?? PRODUCT,
          labelApplied: 'Riz (sac)',
          quantity: String(quantity),
          ...(status === 'DELIVERED' ? { deliveredQuantity: String(quantity) } : {}),
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: total,
        },
      },
    },
  });
}

/** A delivery of ORDER by `driver`, left on the road. */
const seedDelivery = (id: string, driver: string, extra: Record<string, unknown> = {}) =>
  prisma.delivery.create({
    data: {
      id,
      orderId: ORDER,
      assignedToId: driver,
      departedAt: new Date('2026-09-30T07:00:00.000Z'),
      ...extra,
    },
  });

const storedOrder = (id = ORDER) => prisma.order.findUniqueOrThrow({ where: { id } });
const balance = async () =>
  (await prisma.customerRelationship.findUniqueOrThrow({ where: { id: REL } })).balance;
const entriesOf = async (orderId = ORDER) =>
  (await prisma.ledgerEntry.findMany({ where: { orderId } })).sort(
    (x, y) => x.kind.localeCompare(y.kind) || Number(x.amount - y.amount)
  );

describe('push of the closing of an order (SYNC-014)', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600001401', 'Sam Seller');
    await seedPerson(DRIVER, '+237600001403', 'Dora Driver');
    await seedPerson(DRIVER_2, '+237600001404', 'Denis Driver');
    await seedPerson(OWNER_A, '+237600001405', 'Olga Owner');
    await seedPerson(OWNER_B, '+237600001406', 'Otto Owner');
    await seedPerson(CUSTOMER, '+237600001407', 'Cora Customer', false);
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('05', OWNER_A, ORG_A, 'OWNER');
    await seedMember('06', OWNER_B, ORG_B, 'OWNER');
    await seedMember('01', SELLER, ORG_A, 'SELLER');
    await seedMember('03', DRIVER, ORG_A, 'DRIVER');
    await seedMember('04', DRIVER_2, ORG_A, 'DRIVER');
    await prisma.product.create({
      data: { id: PRODUCT, organizationId: ORG_A, name: 'Riz', unit: 'sac', price: 3000n },
    });
    await prisma.product.create({
      data: { id: PRODUCT_B, organizationId: ORG_B, name: 'Riz', unit: 'sac', price: 3000n },
    });
    for (const [id, org, creditLimit] of [
      [REL, ORG_A, 100000n],
      [REL_B, ORG_B, null],
    ] as const) {
      await prisma.customerRelationship.create({
        data: {
          id,
          supplierOrganizationId: org,
          customerPersonId: CUSTOMER,
          createdById: OWNER_A,
          createdAt: LONG_AGO,
          status: 'ACTIVE',
          creditLimit,
          deliveryAddress: 'Rue 1',
        },
      });
    }
  });

  it('writes the sale at the server total and the payment of a delivery closed offline (AC-1, CM-27)', async () => {
    await seedOrder(ORDER, LINE, 'IN_DELIVERY', { quantity: 10 });
    await seedDelivery(DELIVERY, DRIVER);

    const response = await push(DRIVER, {
      orders: delivered(),
      ledger_entries: table({ created: [saleRow(3000), paymentRow(30000)] }),
    });

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    const entries = await entriesOf();
    expect(entries.map((e) => [e.id, e.kind, e.amount, e.recordedById])).toEqual([
      [PAYMENT, 'PAYMENT', 30000n, DRIVER],
      [SALE, 'SALE', 30000n, DRIVER],
    ]);
    expect(await balance()).toBe(0n);
    expect(await storedOrder()).toMatchObject({
      status: 'DELIVERED',
      deliveredById: DRIVER,
      totalAmount: 30000n,
    });
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY } });
    expect(delivery.arrivedAt).not.toBeNull();
    const held = await prisma.collaboration.findFirstOrThrow({
      where: { personId: DRIVER, organizationId: ORG_A },
    });
    expect(held.amountHeld).toBe(30000n);
  });

  it('delivers an order made and delivered offline in the same push (AC-1)', async () => {
    const response = await push(SELLER, {
      orders: table({
        created: [
          {
            id: ORDER,
            customer_relationship_id: REL,
            status: 'DELIVERED',
            delivery_cost: 0,
            created_at: Date.parse('2026-09-30T06:00:00.000Z'),
          },
        ],
      }),
      order_lines: table({
        created: [
          {
            id: LINE,
            order_id: ORDER,
            product_id: PRODUCT,
            quantity: 2,
            reference_price: 3000,
            unit_price_applied: 3000,
            delivered_quantity: 2,
          },
        ],
      }),
      ledger_entries: table({ created: [paymentRow(6000)] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    expect(await storedOrder()).toMatchObject({
      status: 'DELIVERED',
      deliveredById: SELLER,
      totalAmount: 6000n,
    });
    expect((await entriesOf()).map((e) => [e.kind, e.amount])).toEqual([
      ['PAYMENT', 6000n],
      ['SALE', 6000n],
    ]);
    expect(await balance()).toBe(0n);
  });

  it('delivers 8 of 10 and creates the rest order with the pushed id at the original prices (AC-2, CM-22)', async () => {
    await seedOrder(ORDER, LINE, 'IN_DELIVERY');
    await seedDelivery(DELIVERY, DRIVER);

    const response = await push(DRIVER, {
      orders: table({
        created: [
          { id: CHILD, customer_relationship_id: REL, parent_order_id: ORDER, status: 'CONFIRMED' },
        ],
        updated: [{ id: ORDER, status: 'DELIVERED' }],
      }),
      order_lines: table({
        created: [
          {
            id: CHILD_LINE,
            order_id: CHILD,
            product_id: PRODUCT,
            quantity: 2,
            reference_price: 3000,
            unit_price_applied: 3000,
          },
        ],
        updated: [{ id: LINE, order_id: ORDER, delivered_quantity: 8 }],
      }),
      ledger_entries: table({ created: [saleRow(24000), paymentRow(24000)] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    expect(await storedOrder()).toMatchObject({ status: 'DELIVERED', totalAmount: 24000n });
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE } });
    expect(line.deliveredQuantity?.toString()).toBe('8');
    const child = await prisma.order.findUniqueOrThrow({
      where: { id: CHILD },
      include: { lines: true },
    });
    expect(child).toMatchObject({
      status: 'CONFIRMED',
      parentOrderId: ORDER,
      totalAmount: 6000n,
      enteredById: DRIVER,
    });
    expect(child.lines).toHaveLength(1);
    expect(child.lines[0]).toMatchObject({ unitPriceApplied: 3000n, amount: 6000n });
    expect(child.lines[0]?.quantity.toString()).toBe('2');
    expect(await prisma.orderLine.count({ where: { orderId: CHILD } })).toBe(1);
    expect((await entriesOf()).find((e) => e.kind === 'SALE')?.amount).toBe(24000n);
  });

  it('abandons the rest when no child order is pushed and shows it to the owner (AC-3)', async () => {
    await seedOrder(ORDER, LINE, 'IN_DELIVERY');
    await seedDelivery(DELIVERY, DRIVER);

    const response = await push(DRIVER, {
      orders: delivered(),
      order_lines: table({ updated: [{ id: LINE, order_id: ORDER, delivered_quantity: 8 }] }),
      ledger_entries: table({ created: [saleRow(24000), paymentRow(24000)] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    expect((await storedOrder()).status).toBe('DELIVERED');
    expect(await prisma.order.count({ where: { parentOrderId: ORDER } })).toBe(0);
    const exceptions = await createAuthenticatedRequest(app, OWNER_A).get(
      `/api/v1/organizations/${ORG_A}/exceptions/money`
    );
    expect(bodyOf<{ items: Array<Record<string, unknown>> }>(exceptions).items).toEqual([
      expect.objectContaining({
        person_id: DRIVER,
        abandoned_rests: { count: 1, amount: 6000 },
      }),
    ]);
  });

  it('delivers an order cancelled meanwhile and flags it (AC-4, CM-12)', async () => {
    await seedOrder(ORDER, LINE, 'CANCELLED', { quantity: 5 });

    const response = await push(SELLER, {
      orders: delivered(),
      ledger_entries: table({ created: [paymentRow(10000)] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    expect(await storedOrder()).toMatchObject({
      status: 'DELIVERED',
      syncIssue: 'Livrée après annulation',
      cancelledAt: null,
      deliveredById: SELLER,
    });
    expect((await entriesOf()).map((e) => [e.kind, e.amount])).toEqual([
      ['PAYMENT', 10000n],
      ['SALE', 15000n],
    ]);
    expect(await balance()).toBe(5000n);
  });

  it('records a delivery above the credit limit and reports it (AC-5, CM-15)', async () => {
    await prisma.customerRelationship.update({
      where: { id: REL },
      data: { balance: 90000n },
    });
    await seedOrder(ORDER, LINE, 'IN_DELIVERY', { quantity: 10 });
    await seedDelivery(DELIVERY, DRIVER);

    const response = await push(DRIVER, { orders: delivered() });

    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    expect((await storedOrder()).status).toBe('DELIVERED');
    expect(await balance()).toBe(120000n);
    expect(await prisma.ledgerEntry.count({ where: { kind: 'SALE' } })).toBe(1);
  });

  it('carries creditExceededBy in the result of a delivery made through sync (AC-5)', async () => {
    await prisma.customerRelationship.update({
      where: { id: REL },
      data: { balance: 90000n },
    });
    await seedOrder(ORDER, LINE, 'IN_DELIVERY', { quantity: 10 });
    await seedDelivery(DELIVERY, DRIVER);

    const result = await deliverOrder(
      { personId: DRIVER, organizationId: ORG_A, role: 'DRIVER' },
      ORDER,
      {
        id: ORDER,
        collected_amount: 0,
        sale_entry_id: SALE,
      },
      { viaSync: true, payments: [{ id: PAYMENT, amount: 5000n, mode: 'CASH' }] }
    );

    expect(result.creditExceededBy).toBe(15000);
    expect(result.payment).toMatchObject({ id: PAYMENT, amount: 5000, mode: 'CASH' });
    expect(await balance()).toBe(115000n);
  });

  it('writes the sale and the payments once when the same batch is pushed twice (AC-6, C-36)', async () => {
    await seedOrder(ORDER, LINE, 'IN_DELIVERY');
    await seedDelivery(DELIVERY, DRIVER);
    const batch = {
      orders: delivered(),
      ledger_entries: table({
        created: [saleRow(30000), paymentRow(10000), paymentRow(5000, PAYMENT_2)],
      }),
    };

    const first = await push(DRIVER, batch);
    const second = await push(DRIVER, batch);

    expect(bodyOf<PushBody>(first)).toMatchObject({ rejected: [], aside: 0 });
    expect(second.status).toBe(200);
    expect(bodyOf<PushBody>(second)).toMatchObject({ rejected: [], aside: 0 });
    expect((await entriesOf()).map((e) => [e.kind, e.amount])).toEqual([
      ['PAYMENT', 5000n],
      ['PAYMENT', 10000n],
      ['SALE', 30000n],
    ]);
    expect(await balance()).toBe(15000n);
    const held = await prisma.collaboration.findFirstOrThrow({
      where: { personId: DRIVER, organizationId: ORG_A },
    });
    expect(held.amountHeld).toBe(15000n);
  });

  it('stores the server total whatever sale the phone pushes (AB-1, CWE-345)', async () => {
    await seedOrder(ORDER, LINE, 'IN_DELIVERY');
    await seedDelivery(DELIVERY, DRIVER);

    const response = await push(DRIVER, {
      orders: delivered(),
      ledger_entries: table({
        created: [{ ...saleRow(3000), balance_effect: -999999, recorded_by_id: OWNER_A }],
      }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    const sale = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: SALE } });
    expect(sale).toMatchObject({ amount: 30000n, balanceEffect: 30000n, recordedById: DRIVER });
    expect(await balance()).toBe(30000n);
  });

  it('lets the delivery win over a crossed departure and writes the sale once (AB-2, CM-23, CWE-362)', async () => {
    await seedOrder(ORDER, LINE, 'IN_DELIVERY');
    await seedDelivery(DELIVERY, DRIVER_2);
    const batch = {
      deliveries: table({
        created: [{ id: DELIVERY_2, order_id: ORDER, departed_at: DEPARTED }],
      }),
      orders: delivered(),
      ledger_entries: table({ created: [saleRow(30000), paymentRow(30000)] }),
    };

    const response = await push(DRIVER, batch);
    await push(DRIVER, batch);

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect(await prisma.ledgerEntry.count({ where: { kind: 'SALE' } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { kind: 'PAYMENT' } })).toBe(1);
    expect(await storedOrder()).toMatchObject({ status: 'DELIVERED', deliveredById: DRIVER });
    const winner = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY_2 } });
    expect(winner).toMatchObject({ failedAt: null, failureReason: null, assignedToId: DRIVER });
    expect(winner.arrivedAt).not.toBeNull();
    const loser = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY } });
    expect(loser.arrivedAt).toBeNull();
    expect(loser.failedAt).not.toBeNull();
    expect(loser.syncIssue).toBe('Livraison déjà prise par Dora Driver');
  });

  it('writes nothing for a driver who has no delivery of their own on the order (AB-2, ASVS 8.2.1)', async () => {
    await seedOrder(ORDER, LINE, 'IN_DELIVERY');
    await seedDelivery(DELIVERY, DRIVER_2);

    const response = await push(DRIVER, {
      orders: delivered(),
      ledger_entries: table({ created: [saleRow(30000), paymentRow(30000)] }),
    });

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response).rejected).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'orders', id: ORDER })])
    );
    expect((await storedOrder()).status).toBe('IN_DELIVERY');
    expect(await prisma.ledgerEntry.count()).toBe(0);
    const other = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY } });
    expect(other.failedAt).toBeNull();
  });

  it('writes no second sale when another person already delivered the order (AB-2)', async () => {
    await seedOrder(ORDER, LINE, 'DELIVERED');
    await prisma.ledgerEntry.create({
      data: {
        id: SALE,
        customerRelationshipId: REL,
        orderId: ORDER,
        kind: 'SALE',
        amount: 30000n,
        recordedById: DRIVER_2,
        occurredAt: LONG_AGO,
      },
    });

    const response = await push(SELLER, {
      orders: delivered(),
      ledger_entries: table({
        created: [paymentRow(30000)],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect(await prisma.ledgerEntry.count({ where: { kind: 'SALE' } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { kind: 'PAYMENT' } })).toBe(0);
    expect(await balance()).toBe(0n);
  });

  it('refuses a delivery of an order of another business and writes nothing (ASVS 8.2.1)', async () => {
    await seedOrder(ORDER_B, LINE_B, 'CONFIRMED', { relationship: REL_B, product: PRODUCT_B });

    const response = await push(SELLER, {
      orders: delivered(ORDER_B),
      ledger_entries: table({
        created: [{ ...paymentRow(30000, PAYMENT, ORDER_B), customer_relationship_id: REL_B }],
      }),
    });

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response).rejected.map((r) => r.code)).toContain('OUT_OF_SCOPE');
    expect((await storedOrder(ORDER_B)).status).toBe('CONFIRMED');
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('leaves nothing written when the delivered quantity is above the ordered one (fail closed)', async () => {
    await seedOrder(ORDER, LINE, 'IN_DELIVERY');
    await seedDelivery(DELIVERY, DRIVER);

    const response = await push(DRIVER, {
      orders: delivered(),
      order_lines: table({ updated: [{ id: LINE, order_id: ORDER, delivered_quantity: 11 }] }),
      ledger_entries: table({ created: [paymentRow(30000)] }),
    });

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const order = await storedOrder();
    expect(order.status).toBe('IN_DELIVERY');
    expect(order.syncIssue).not.toBeNull();
    expect(await prisma.ledgerEntry.count()).toBe(0);
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE } });
    expect(line.deliveredQuantity).toBeNull();
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY } });
    expect(delivery.arrivedAt).toBeNull();
  });

  it('does not fail the batch when a pushed payment id is already used by another entry (C-36)', async () => {
    await seedOrder(ORDER, LINE, 'IN_DELIVERY');
    await seedOrder(ORDER_B, LINE_B, 'CONFIRMED', { relationship: REL_B, product: PRODUCT_B });
    await seedDelivery(DELIVERY, DRIVER);
    await prisma.ledgerEntry.create({
      data: {
        id: PAYMENT,
        customerRelationshipId: REL_B,
        orderId: ORDER_B,
        kind: 'PAYMENT',
        mode: 'CASH',
        amount: 500n,
        recordedById: OWNER_B,
        occurredAt: LONG_AGO,
      },
    });

    const response = await push(DRIVER, {
      orders: delivered(),
      ledger_entries: table({ created: [paymentRow(30000), paymentRow(1000, PAYMENT_2)] }),
    });

    expect(response.status).toBe(200);
    expect((await storedOrder()).status).toBe('DELIVERED');
    const stored = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: PAYMENT } });
    expect(stored).toMatchObject({ amount: 500n, orderId: ORDER_B });
    expect((await entriesOf()).map((e) => [e.id, e.kind, e.amount])).toEqual([
      [PAYMENT_2, 'PAYMENT', 1000n],
      [expect.any(String), 'SALE', 30000n],
    ]);
  });
});
