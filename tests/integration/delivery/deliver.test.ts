import { describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { RECEIPT_FIELDS } from '../../helpers/receipt-fields.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0d7-0000-7000-8000-000000000001';
const SELLER = '0199c0d7-0000-7000-8000-000000000003';
const DRIVER_1 = '0199c0d7-0000-7000-8000-000000000004';
const DRIVER_2 = '0199c0d7-0000-7000-8000-000000000005';
const CUSTOMER = '0199c0d7-0000-7000-8000-000000000006';
const OTHER_OWNER = '0199c0d7-0000-7000-8000-000000000007';

const SUPPLIER = '0199c0d7-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c0d7-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c0d7-0000-7000-8000-0000000000b1';
const REL = '0199c0d7-0000-7000-8000-0000000000e1';

const REG = new Date('2026-01-01T00:00:00.000Z');

const orderId = (n: number) => `0199c0d7-0000-7000-8000-0000000001${n}0`;
const lineId = (n: number) => `0199c0d7-0000-7000-8000-0000000002${n}0`;
const deliveryId = (n: number) => `0199c0d7-0000-7000-8000-0000000003${n}0`;
const gestureId = (n: number) => `0199c0d7-0000-7000-8000-0000000005${n}0`;
const saleId = (n: number) => `0199c0d7-0000-7000-8000-0000000006${n}0`;
const paymentId = (n: number) => `0199c0d7-0000-7000-8000-0000000007${n}0`;

type DeliverBody = {
  order: { id: string; status: string; total_amount: number };
  sale: { id: string; kind: string; amount: number; order_id: string };
  payment: { id: string; kind: string; amount: number; mode: string; order_id: string } | null;
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

/** An order of 3 sacks at 10 000 (total 30 000, no delivery cost) on the supplier's relationship. */
async function seedOrder(
  n: number,
  status: 'CONFIRMED' | 'IN_DELIVERY' | 'DELIVERED' | 'CANCELLED'
) {
  await prisma.order.create({
    data: {
      id: orderId(n),
      customerRelationshipId: REL,
      enteredById: SELLER,
      placedByParty: 'SUPPLIER',
      status,
      ...(status === 'DELIVERED'
        ? { deliveredAt: REG, deliveredById: DRIVER_1, ...RECEIPT_FIELDS }
        : {}),
      ...(status === 'CANCELLED'
        ? {
            cancelledByParty: 'SUPPLIER' as const,
            cancelledById: OWNER,
            cancelledAt: REG,
            cancellationReason: 'Out of stock',
          }
        : {}),
      deliveryAddressApplied: `Street ${n}`,
      deliveryCost: 0n,
      totalAmount: 30000n,
      createdAt: new Date(Date.UTC(2026, 5, n)),
      lines: {
        create: {
          id: lineId(n),
          productVariantId: PRODUCT,
          labelApplied: 'Rice (sack)',
          quantity: '3',
          ...(status === 'DELIVERED' ? { deliveredQuantity: '3' } : {}),
          referencePrice: 10000n,
          unitPriceApplied: 10000n,
          amount: 30000n,
        },
      },
    },
  });
}

async function seedDeparted(n: number, driverId: string) {
  await prisma.delivery.create({
    data: {
      id: deliveryId(n),
      orderId: orderId(n),
      assignedToId: driverId,
      departedAt: new Date(Date.UTC(2026, 6, 1, 8)),
    },
  });
}

/**
 * Supplier with an owner, a seller and two drivers, a customer with the given balance and credit
 * limit, and orders of 30 000: 1 IN_DELIVERY with driver 1, 2 IN_DELIVERY with driver 2, 3
 * CONFIRMED, 4 DELIVERED, 5 CANCELLED, 6 IN_DELIVERY with driver 1 (second order for races).
 */
async function seedBase(options: { balance?: bigint; creditLimit?: bigint | null } = {}) {
  await seedPerson(OWNER, '+237600087001');
  await seedPerson(SELLER, '+237600087003');
  await seedPerson(DRIVER_1, '+237600087004');
  await seedPerson(DRIVER_2, '+237600087005');
  await seedPerson(CUSTOMER, '+237600087006');
  await seedPerson(OTHER_OWNER, '+237600087007');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER_1, 'DRIVER', 4);
  await seedMember(SUPPLIER, DRIVER_2, 'DRIVER', 5);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 6);
  await seedProduct(prisma, {
    id: PRODUCT,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 10000n,
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
      balance: options.balance ?? 0n,
      creditLimit: options.creditLimit === undefined ? 100000n : options.creditLimit,
    },
  });
  await seedOrder(1, 'IN_DELIVERY');
  await seedDeparted(1, DRIVER_1);
  await seedOrder(2, 'IN_DELIVERY');
  await seedDeparted(2, DRIVER_2);
  await seedOrder(3, 'CONFIRMED');
  await seedOrder(4, 'DELIVERED');
  await seedOrder(5, 'CANCELLED');
  await seedOrder(6, 'IN_DELIVERY');
  await seedDeparted(6, DRIVER_1);
}

function deliver(
  personId: string,
  order: number,
  body: Record<string, unknown>,
  organizationId = SUPPLIER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/orders/${orderId(order)}/deliver`)
    .send(body);
}

function paidBody(n: number, collected: number, extra: Record<string, unknown> = {}) {
  return {
    id: gestureId(n),
    collected_amount: collected,
    ...(collected > 0 ? { mode: 'CASH', payment_entry_id: paymentId(n) } : {}),
    sale_entry_id: saleId(n),
    ...extra,
  };
}

/** Ledger entries with the SALE first, whatever the enum order in the database. */
async function ledgerEntries() {
  const entries = await prisma.ledgerEntry.findMany();
  return entries.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'SALE' ? -1 : 1));
}

async function balanceOf() {
  return (await prisma.customerRelationship.findUniqueOrThrow({ where: { id: REL } })).balance;
}

async function expectNothingWritten(order: number, status: string) {
  expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId(order) } })).status).toBe(
    status
  );
  expect(await prisma.ledgerEntry.count()).toBe(0);
  expect(await prisma.notification.count()).toBe(0);
}

describe('DLV-007 "Commande livrée": deliver a whole order', () => {
  it('delivers and records the sale and the payment in full (AC-1, CM-13)', async () => {
    await seedBase();

    const response = await deliver(DRIVER_1, 1, paidBody(1, 30000));

    expect(response.status).toBe(200);
    const body = bodyOf<DeliverBody>(response);
    expect(body.order).toMatchObject({ id: orderId(1), status: 'DELIVERED', total_amount: 30000 });
    expect(body.sale).toMatchObject({
      id: saleId(1),
      kind: 'SALE',
      amount: 30000,
      order_id: orderId(1),
    });
    expect(body.payment).toMatchObject({
      id: paymentId(1),
      kind: 'PAYMENT',
      amount: 30000,
      mode: 'CASH',
      order_id: orderId(1),
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId(1) } });
    expect(order).toMatchObject({
      status: 'DELIVERED',
      deliveredById: DRIVER_1,
      totalAmount: 30000n,
    });
    expect(order.deliveredAt).not.toBeNull();
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId(1) } });
    expect(line.deliveredQuantity?.toString()).toBe('3');
    expect(line.amount).toBe(30000n);
    const entries = await ledgerEntries();
    expect(entries.map((e) => [e.kind, e.amount, e.orderId, e.recordedById])).toEqual([
      ['SALE', 30000n, orderId(1), DRIVER_1],
      ['PAYMENT', 30000n, orderId(1), DRIVER_1],
    ]);
    expect(await balanceOf()).toBe(0n);
    const held = await prisma.collaboration.findFirstOrThrow({
      where: { personId: DRIVER_1, organizationId: SUPPLIER },
    });
    expect(held.amountHeld).toBe(30000n);
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(1) } });
    expect(delivery.arrivedAt).not.toBeNull();
  });

  it('notifies the customer order.status_changed', async () => {
    await seedBase();

    await deliver(DRIVER_1, 1, paidBody(1, 30000));

    const notifications = await prisma.notification.findMany({ where: { recipientId: CUSTOMER } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      sourceEvent: 'order.status_changed',
      organizationId: SUPPLIER,
    });
  });

  it('records only the sale when nothing is collected, payment is null (AC-2 row 0)', async () => {
    await seedBase({ balance: 0n, creditLimit: null });

    const response = await deliver(DRIVER_1, 1, paidBody(1, 0));

    expect(response.status).toBe(200);
    expect(bodyOf<DeliverBody>(response).payment).toBeNull();
    const entries = await prisma.ledgerEntry.findMany();
    expect(entries.map((e) => e.kind)).toEqual(['SALE']);
    expect(await balanceOf()).toBe(30000n);
  });

  it('lets a SELLER deliver a CONFIRMED order in the shop', async () => {
    await seedBase();

    const response = await deliver(SELLER, 3, paidBody(3, 30000));

    expect(response.status).toBe(200);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId(3) } });
    expect(order).toMatchObject({ status: 'DELIVERED', deliveredById: SELLER });
    expect(await prisma.ledgerEntry.count()).toBe(2);
  });

  it('lets the OWNER deliver a CONFIRMED order', async () => {
    await seedBase();

    const response = await deliver(OWNER, 3, paidBody(3, 30000));

    expect(response.status).toBe(200);
  });

  describe('credit rule (AC-2, CM-15)', () => {
    it.each([
      [20000, 200, 50000n],
      [30000, 200, 40000n],
    ])('answers 200 when collecting %i', async (collected, status, balance) => {
      await seedBase({ balance: 40000n, creditLimit: 50000n });

      const response = await deliver(DRIVER_1, 1, paidBody(1, collected));

      expect(response.status).toBe(status);
      expect(await balanceOf()).toBe(balance);
      const entries = await ledgerEntries();
      expect(entries.map((e) => [e.kind, e.amount])).toEqual([
        ['SALE', 30000n],
        ['PAYMENT', BigInt(collected)],
      ]);
    });

    it.each([[19999], [0]])(
      'answers 409 CREDIT_INSUFFICIENT with min_collect 20000 when collecting %i',
      async (collected) => {
        await seedBase({ balance: 40000n, creditLimit: 50000n });

        const response = await deliver(DRIVER_1, 1, paidBody(1, collected));

        expect(response.status).toBe(409);
        const error = bodyOf<ErrorBody>(response).error;
        expect(error.code).toBe('CREDIT_INSUFFICIENT');
        expect(error.details).toEqual({ min_collect: 20000 });
        await expectNothingWritten(1, 'IN_DELIVERY');
        expect(await balanceOf()).toBe(40000n);
        expect(
          (await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(1) } })).arrivedAt
        ).toBeNull();
      }
    );

    it('treats a null limit as no limit', async () => {
      await seedBase({ balance: 900000n, creditLimit: null });

      const response = await deliver(DRIVER_1, 1, paidBody(1, 0));

      expect(response.status).toBe(200);
    });

    it('requires the whole total when the limit is 0 and the balance 0', async () => {
      await seedBase({ balance: 0n, creditLimit: 0n });

      const refused = await deliver(DRIVER_1, 1, paidBody(1, 29999));
      const accepted = await deliver(DRIVER_1, 1, paidBody(2, 30000));

      expect(refused.status).toBe(409);
      expect(bodyOf<ErrorBody>(refused).error.details).toEqual({ min_collect: 30000 });
      expect(accepted.status).toBe(200);
    });
  });

  describe('refusals (AC-3)', () => {
    it('answers 404 NOT_FOUND for a DRIVER on an order of another driver', async () => {
      await seedBase();

      const response = await deliver(DRIVER_1, 2, paidBody(1, 30000));

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      await expectNothingWritten(2, 'IN_DELIVERY');
    });

    it('answers 409 INVALID_TRANSITION for a DRIVER on a CONFIRMED order', async () => {
      await seedBase();

      const response = await deliver(DRIVER_1, 3, paidBody(1, 30000));

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TRANSITION');
      await expectNothingWritten(3, 'CONFIRMED');
    });

    it.each([
      ['DELIVERED', 4],
      ['CANCELLED', 5],
    ])('answers 409 INVALID_TRANSITION for a %s order', async (status, n) => {
      await seedBase();

      const response = await deliver(SELLER, n, paidBody(1, 30000));

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TRANSITION');
      await expectNothingWritten(n, status);
    });

    it('answers 400 VALIDATION_ERROR for a collected amount above 0 without a mode', async () => {
      await seedBase();

      const response = await deliver(DRIVER_1, 1, {
        id: gestureId(1),
        collected_amount: 30000,
        sale_entry_id: saleId(1),
        payment_entry_id: paymentId(1),
      });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      await expectNothingWritten(1, 'IN_DELIVERY');
    });

    it('answers 400 VALIDATION_ERROR for a collected amount above 0 without a payment entry id', async () => {
      await seedBase();

      const response = await deliver(DRIVER_1, 1, {
        id: gestureId(1),
        collected_amount: 30000,
        mode: 'CASH',
        sale_entry_id: saleId(1),
      });

      expect(response.status).toBe(400);
      await expectNothingWritten(1, 'IN_DELIVERY');
    });

    it('answers 404 to a member of another business and for another business order', async () => {
      await seedBase();

      const foreignMember = await deliver(OTHER_OWNER, 3, paidBody(1, 30000), SUPPLIER);
      const crossPath = await deliver(OTHER_OWNER, 3, paidBody(2, 30000), OTHER_ORG);

      expect(foreignMember.status).toBe(404);
      expect(crossPath.status).toBe(404);
      await expectNothingWritten(3, 'CONFIRMED');
    });

    it('answers 404 for an unknown order', async () => {
      await seedBase();

      const response = await deliver(OWNER, 9, paidBody(1, 30000));

      expect(response.status).toBe(404);
    });

    it('answers 401 without a token', async () => {
      await seedBase();
      const { default: request } = await import('supertest');

      const response = await request(app)
        .post(`/api/v1/organizations/${SUPPLIER}/orders/${orderId(1)}/deliver`)
        .send(paidBody(1, 30000));

      expect(response.status).toBe(401);
    });
  });

  it('creates one sale and one payment when the same id is posted twice', async () => {
    await seedBase();

    const first = await deliver(DRIVER_1, 1, paidBody(1, 30000));
    const second = await deliver(DRIVER_1, 1, paidBody(1, 30000));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await prisma.ledgerEntry.count()).toBe(2);
    expect(await prisma.notification.count({ where: { recipientId: CUSTOMER } })).toBe(1);
  });

  it('writes nothing when a ledger entry id already exists, one transaction (v5.0.0-2.3.3)', async () => {
    await seedBase();
    await deliver(DRIVER_1, 6, paidBody(6, 30000));

    const response = await deliver(DRIVER_1, 1, paidBody(1, 30000, { sale_entry_id: saleId(6) }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId(1) } })).status).toBe(
      'IN_DELIVERY'
    );
    expect(await prisma.ledgerEntry.count()).toBe(2);
    expect(
      (await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(1) } })).arrivedAt
    ).toBeNull();
  });

  describe('abuse cases', () => {
    it('ignores or refuses a sale amount sent by the phone (AB-1, WSTG-BUSL-02, CWE-345)', async () => {
      await seedBase();

      const response = await deliver(DRIVER_1, 1, paidBody(1, 30000, { sale_amount: 3000 }));

      expect(response.status).toBe(400);
      await expectNothingWritten(1, 'IN_DELIVERY');
    });

    it('always records a SALE of the order total (AB-1)', async () => {
      await seedBase();

      await deliver(DRIVER_1, 1, paidBody(1, 5000));

      const sale = await prisma.ledgerEntry.findFirstOrThrow({ where: { kind: 'SALE' } });
      expect(sale.amount).toBe(30000n);
    });

    it.each([
      ['a kind', { kind: 'REFUND' }],
      ['an amount', { amount: 30000 }],
      ['a negative collected amount', { collected_amount: -5000 }],
      ['a fractional collected amount', { collected_amount: 10.5 }],
      ['an unknown mode', { mode: 'CREDIT_NOTE' }],
    ])('answers 400 to a DRIVER sending %s (AB-2, WSTG-ATHZ-03)', async (_label, extra) => {
      await seedBase();

      const response = await deliver(DRIVER_1, 1, paidBody(1, 30000, extra));

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      await expectNothingWritten(1, 'IN_DELIVERY');
    });

    it('refuses the second of two deliveries that together exceed the limit (AB-3, WSTG-BUSL-04, CWE-362)', async () => {
      await seedBase({ balance: 0n, creditLimit: 50000n });

      const [first, second] = await Promise.all([
        deliver(DRIVER_1, 1, paidBody(1, 0)),
        deliver(DRIVER_1, 6, paidBody(2, 0)),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      expect(bodyOf<ErrorBody>(loser).error.code).toBe('CREDIT_INSUFFICIENT');
      expect(await balanceOf()).toBe(30000n);
      expect(await prisma.ledgerEntry.count({ where: { kind: 'SALE' } })).toBe(1);
    });
  });
});
