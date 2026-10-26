import { describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0d7-0000-7000-8000-000000000001';
const SELLER = '0199c0d7-0000-7000-8000-000000000003';
const DRIVER = '0199c0d7-0000-7000-8000-000000000004';
const CUSTOMER = '0199c0d7-0000-7000-8000-000000000006';

const SUPPLIER = '0199c0d7-0000-7000-8000-0000000000a1';
const PRODUCT = '0199c0d7-0000-7000-8000-0000000000b1';
const REL = '0199c0d7-0000-7000-8000-0000000000e1';

const REG = new Date('2026-01-01T00:00:00.000Z');

const orderId = (n: number) => `0199c0d7-0000-7000-8000-0000000001${n}0`;
const lineId = (n: number, k = 1) => `0199c0d7-0000-7000-8000-0000000002${n}${k}`;
const deliveryId = (n: number) => `0199c0d7-0000-7000-8000-0000000003${n}0`;
const gestureId = (n: number) => `0199c0d7-0000-7000-8000-0000000005${n}0`;
const saleId = (n: number) => `0199c0d7-0000-7000-8000-0000000006${n}0`;
const paymentId = (n: number) => `0199c0d7-0000-7000-8000-0000000007${n}0`;

type DeliverBody = {
  order: { id: string; status: string; total_amount: number };
  sale: { amount: number };
  payment: { amount: number } | null;
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

type SeedLine = { quantity: string; reference: bigint; applied: bigint; label?: string };

/** An IN_DELIVERY order departed with the driver; each line is a quantity at an applied price. */
async function seedOrder(n: number, lines: SeedLine[]) {
  const amounts = lines.map((l) => (BigInt(Number(l.quantity) * 1000) * l.applied + 500n) / 1000n);
  await prisma.order.create({
    data: {
      id: orderId(n),
      customerRelationshipId: REL,
      enteredById: SELLER,
      placedByParty: 'SUPPLIER',
      status: 'IN_DELIVERY',
      deliveryAddressApplied: `Street ${n}`,
      deliveryCost: 0n,
      totalAmount: amounts.reduce((a, b) => a + b, 0n),
      createdAt: new Date(Date.UTC(2026, 5, n)),
      lines: {
        create: lines.map((line, i) => ({
          id: lineId(n, i + 1),
          productVariantId: PRODUCT,
          labelApplied: line.label ?? 'Rice (sack)',
          quantity: line.quantity,
          referencePrice: line.reference,
          unitPriceApplied: line.applied,
          amount: amounts[i],
          ...(line.applied !== line.reference ? { priceSetById: SELLER, priceSetAt: REG } : {}),
        })),
      },
    },
  });
  await prisma.delivery.create({
    data: {
      id: deliveryId(n),
      orderId: orderId(n),
      assignedToId: DRIVER,
      departedAt: new Date(Date.UTC(2026, 6, 1, 8)),
    },
  });
}

/**
 * Supplier with an owner, a seller and a driver; a customer; orders: 1 one line of 10 at 3000, 2
 * one line of 4 at 3000, 3 two lines (10 at 3000 and 2 at 5000), 4 one line of 10 at a price of
 * 2500 lowered by the seller from 3000.
 */
async function seedBase(options: { balance?: bigint; creditLimit?: bigint | null } = {}) {
  await seedPerson(OWNER, '+237600088001');
  await seedPerson(SELLER, '+237600088003');
  await seedPerson(DRIVER, '+237600088004');
  await seedPerson(CUSTOMER, '+237600088006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  const members = [
    [OWNER, 'OWNER'],
    [SELLER, 'SELLER'],
    [DRIVER, 'DRIVER'],
  ] as const;
  for (const [i, [personId, role]] of members.entries()) {
    await prisma.collaboration.create({
      data: {
        id: `0199c0d7-0000-7000-8000-0000000004${i}f`,
        personId,
        organizationId: SUPPLIER,
        role,
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  }
  await seedProduct(prisma, {
    id: PRODUCT,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 3000n,
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
  await seedOrder(1, [{ quantity: '10', reference: 3000n, applied: 3000n }]);
  await seedOrder(2, [{ quantity: '4', reference: 3000n, applied: 3000n }]);
  await seedOrder(3, [
    { quantity: '10', reference: 3000n, applied: 3000n },
    { quantity: '2', reference: 5000n, applied: 5000n, label: 'Oil (can)' },
  ]);
  await seedOrder(4, [{ quantity: '10', reference: 3000n, applied: 2500n }]);
}

function deliver(personId: string, order: number, body: Record<string, unknown>) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${SUPPLIER}/orders/${orderId(order)}/deliver`)
    .send(body);
}

function body(n: number, collected: number, extra: Record<string, unknown> = {}) {
  return {
    id: gestureId(n),
    collected_amount: collected,
    ...(collected > 0 ? { mode: 'CASH', payment_entry_id: paymentId(n) } : {}),
    sale_entry_id: saleId(n),
    ...extra,
  };
}

const lineOf = (n: number, deliveredQuantity: string | number, k = 1) => ({
  line_id: lineId(n, k),
  delivered_quantity: deliveredQuantity,
});

async function expectNothingWritten(order: number) {
  expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId(order) } })).status).toBe(
    'IN_DELIVERY'
  );
  expect(await prisma.ledgerEntry.count()).toBe(0);
  expect(await prisma.order.count()).toBe(4);
  expect(await prisma.notification.count()).toBe(0);
  const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId(order) } });
  expect(line.deliveredQuantity).toBeNull();
}

describe('DLV-008 deliver only part of an order', () => {
  it('delivers 8 of 10 with rest LATER: sale on 8, CONFIRMED child of 2 (AC-1, CM-22)', async () => {
    await seedBase();

    const response = await deliver(
      DRIVER,
      1,
      body(1, 24000, { lines: [lineOf(1, '8')], rest: 'LATER' })
    );

    expect(response.status).toBe(200);
    const result = bodyOf<DeliverBody>(response);
    expect(result.order).toMatchObject({ status: 'DELIVERED', total_amount: 24000 });
    expect(result.sale.amount).toBe(24000);
    expect(result.payment?.amount).toBe(24000);

    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId(1) } });
    expect(line.deliveredQuantity?.toString()).toBe('8');
    expect(line.amount).toBe(24000n);
    expect((await prisma.ledgerEntry.findMany({ where: { kind: 'SALE' } }))[0]?.amount).toBe(
      24000n
    );

    const children = await prisma.order.findMany({
      where: { parentOrderId: orderId(1) },
      include: { lines: true },
    });
    expect(children).toHaveLength(1);
    const child = children[0];
    expect(child).toMatchObject({
      status: 'CONFIRMED',
      customerRelationshipId: REL,
      deliveryAddressApplied: 'Street 1',
      deliveryCost: 0n,
      totalAmount: 6000n,
    });
    expect(child.lines).toHaveLength(1);
    expect(child.lines[0]).toMatchObject({
      productId: null,
      labelApplied: 'Rice (sack)',
      referencePrice: 3000n,
      unitPriceApplied: 3000n,
      amount: 6000n,
    });
    expect(child.lines[0]?.quantity.toString()).toBe('2');
    expect(child.lines[0]?.deliveredQuantity).toBeNull();
  });

  it('keeps the price author of a lowered price on the rest line (CM-22)', async () => {
    await seedBase();

    const response = await deliver(
      DRIVER,
      4,
      body(4, 0, { lines: [lineOf(4, '4.5')], rest: 'LATER' })
    );

    expect(response.status).toBe(200);
    const child = await prisma.order.findFirstOrThrow({
      where: { parentOrderId: orderId(4) },
      include: { lines: true },
    });
    expect(child.totalAmount).toBe(13750n);
    expect(child.lines[0]).toMatchObject({
      referencePrice: 3000n,
      unitPriceApplied: 2500n,
      amount: 13750n,
      priceSetById: SELLER,
    });
    expect(child.lines[0]?.priceSetAt).not.toBeNull();
    expect(child.lines[0]?.quantity.toString()).toBe('5.5');
  });

  it('delivers unlisted lines fully and makes a child only of the short ones', async () => {
    await seedBase();

    const response = await deliver(
      DRIVER,
      3,
      body(3, 0, { lines: [lineOf(3, '6', 1)], rest: 'LATER' })
    );

    expect(response.status).toBe(200);
    expect(bodyOf<DeliverBody>(response).order.total_amount).toBe(28000);
    const oil = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId(3, 2) } });
    expect(oil.deliveredQuantity?.toString()).toBe('2');
    expect(oil.amount).toBe(10000n);
    const child = await prisma.order.findFirstOrThrow({
      where: { parentOrderId: orderId(3) },
      include: { lines: true },
    });
    expect(child.lines).toHaveLength(1);
    expect(child.lines[0]?.labelApplied).toBe('Rice (sack)');
    expect(child.lines[0]?.quantity.toString()).toBe('4');
  });

  it('accepts a line delivered at 0 when another line is delivered', async () => {
    await seedBase();

    const response = await deliver(
      DRIVER,
      3,
      body(3, 0, { lines: [lineOf(3, 0, 1)], rest: 'LATER' })
    );

    expect(response.status).toBe(200);
    expect(bodyOf<DeliverBody>(response).order.total_amount).toBe(10000);
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId(3, 1) } });
    expect(line.amount).toBe(0n);
    const child = await prisma.order.findFirstOrThrow({ where: { parentOrderId: orderId(3) } });
    expect(child.totalAmount).toBe(30000n);
  });

  it('creates no child order when the rest is ABANDON (AC-2)', async () => {
    await seedBase();

    const response = await deliver(
      DRIVER,
      1,
      body(1, 24000, { lines: [lineOf(1, '8')], rest: 'ABANDON' })
    );

    expect(response.status).toBe(200);
    expect(await prisma.order.count({ where: { parentOrderId: { not: null } } })).toBe(0);
    expect(await prisma.order.count()).toBe(4);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId(1) } });
    expect(order).toMatchObject({ status: 'DELIVERED', totalAmount: 24000n });
  });

  describe('refusals (AC-3)', () => {
    it.each([
      ['a short line without rest', (): Record<string, unknown> => ({ lines: [lineOf(1, '8')] })],
      [
        'a delivered quantity above the ordered one',
        (): Record<string, unknown> => ({ lines: [lineOf(1, '10.001')], rest: 'LATER' }),
      ],
      [
        'every delivered quantity 0',
        (): Record<string, unknown> => ({ lines: [lineOf(1, 0)], rest: 'ABANDON' }),
      ],
      [
        'a delivered quantity with 4 decimals',
        (): Record<string, unknown> => ({ lines: [lineOf(1, '8.1234')], rest: 'LATER' }),
      ],
      [
        'a negative delivered quantity',
        (): Record<string, unknown> => ({ lines: [lineOf(1, '-1')], rest: 'LATER' }),
      ],
      [
        'the same line twice',
        (): Record<string, unknown> => ({
          lines: [lineOf(1, '8'), lineOf(1, '7')],
          rest: 'LATER',
        }),
      ],
      ['an unknown rest', (): Record<string, unknown> => ({ lines: [lineOf(1, '8')], rest: 'X' })],
    ])('answers 400 VALIDATION_ERROR for %s and writes nothing', async (_name, extra) => {
      await seedBase();

      const response = await deliver(DRIVER, 1, body(1, 0, extra()));

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      await expectNothingWritten(1);
    });

    it('answers 404 NOT_FOUND for a line of another order and writes nothing', async () => {
      await seedBase();

      const response = await deliver(
        DRIVER,
        1,
        body(1, 0, { lines: [lineOf(2, '1')], rest: 'LATER' })
      );

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      await expectNothingWritten(1);
    });
  });

  it('checks credit on the delivered total only (AC-4)', async () => {
    await seedBase({ balance: 0n, creditLimit: 25000n });

    const whole = await deliver(DRIVER, 1, body(1, 0));
    expect(whole.status).toBe(409);
    expect(bodyOf<ErrorBody>(whole).error.code).toBe('CREDIT_INSUFFICIENT');

    const partial = await deliver(
      DRIVER,
      1,
      body(5, 0, { lines: [lineOf(1, '8')], rest: 'LATER' })
    );

    expect(partial.status).toBe(200);
    const relationship = await prisma.customerRelationship.findUniqueOrThrow({
      where: { id: REL },
    });
    expect(relationship.balance).toBe(24000n);
  });

  it('keeps the short lines visible when a non-owner abandons the rest (AB-1, CWE-778)', async () => {
    await seedBase();

    const response = await deliver(
      DRIVER,
      1,
      body(1, 24000, { lines: [lineOf(1, '8')], rest: 'ABANDON' })
    );

    expect(response.status).toBe(200);
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId(1) } });
    expect(line.deliveredQuantity?.toString()).toBe('8');
    expect(line.quantity.toString()).toBe('10');
    expect(line.deletedAt).toBeNull();
  });

  it.each([['amount'], ['total_amount']])(
    'answers 400 when the body carries %s (AB-2, CWE-915)',
    async (field) => {
      await seedBase();

      const response = await deliver(DRIVER, 1, body(1, 0, { [field]: 1 }));

      expect(response.status).toBe(400);
      await expectNothingWritten(1);
    }
  );

  it('answers 400 when a line carries an amount (AB-2, CWE-915)', async () => {
    await seedBase();

    const response = await deliver(
      DRIVER,
      1,
      body(1, 0, { lines: [{ ...lineOf(1, '8'), amount: 1 }], rest: 'LATER' })
    );

    expect(response.status).toBe(400);
    await expectNothingWritten(1);
  });
});
