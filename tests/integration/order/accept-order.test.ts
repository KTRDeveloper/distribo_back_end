import { seedProduct } from '../../helpers/catalog-fixtures.js';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c011-0000-7000-8000-000000000001';
const MANAGER = '0199c011-0000-7000-8000-000000000002';
const SELLER = '0199c011-0000-7000-8000-000000000003';
const DRIVER = '0199c011-0000-7000-8000-000000000004';
const CUSTOMER = '0199c011-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c011-0000-7000-8000-000000000006';
const BIZ_MANAGER = '0199c011-0000-7000-8000-000000000007';

const SUPPLIER = '0199c011-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c011-0000-7000-8000-0000000000a2';
const BUSINESS = '0199c011-0000-7000-8000-0000000000a3';
const PRODUCT_A = '0199c011-0000-7000-8000-0000000000b1';
const PRODUCT_B = '0199c011-0000-7000-8000-0000000000b2';
const REL = '0199c011-0000-7000-8000-0000000000e1';
const BIZ_REL = '0199c011-0000-7000-8000-0000000000e2';
const ORDER_ID = '0199c011-0000-7000-8000-0000000000c1';
const OTHER_ORDER_ID = '0199c011-0000-7000-8000-0000000000c2';
const LINE_1 = '0199c011-0000-7000-8000-0000000000d1';
const LINE_2 = '0199c011-0000-7000-8000-0000000000d2';
const OTHER_LINE = '0199c011-0000-7000-8000-0000000000d3';
const GESTURE = '0199c011-0000-7000-8000-0000000000f1';
const GESTURE_2 = '0199c011-0000-7000-8000-0000000000f2';

const REG = new Date('2026-01-01T00:00:00.000Z');

type LineBody = {
  id: string;
  reference_price: number;
  unit_price_applied: number;
  amount: number;
  price_set_by_id?: string | null;
  price_set_at?: string | null;
};
type OrderBody = { id: string; status: string; total_amount: number; lines: LineBody[] };

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
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c011-0000-7000-8000-0000000001${n}0`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

/** A PENDING customer order: 10 x 2800 and 2 x 500, total 29000. */
async function seedOrder(
  id: string,
  relationshipId: string,
  lines: [string, string, string],
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' = 'PENDING',
  enteredById = CUSTOMER
) {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      placedByParty: 'CUSTOMER',
      enteredById,
      totalAmount: 29000n,
      status,
      ...(status === 'CANCELLED'
        ? {
            cancelledByParty: 'CUSTOMER' as const,
            cancelledById: CUSTOMER,
            cancelledAt: REG,
            cancellationReason: 'Changed mind',
          }
        : {}),
      lines: {
        create: [
          {
            id: lines[0],
            productVariantId: PRODUCT_A,
            labelApplied: 'Rice (sack)',
            quantity: '10',
            referencePrice: 2800n,
            unitPriceApplied: 2800n,
            amount: 28000n,
          },
          {
            id: lines[1],
            productVariantId: PRODUCT_B,
            labelApplied: 'Salt (kg)',
            quantity: '2',
            referencePrice: 500n,
            unitPriceApplied: 500n,
            amount: 1000n,
          },
        ],
      },
    },
  });
}

function accept(orderId: string, body: unknown, personId = SELLER, organizationId = SUPPLIER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/orders/${orderId}/accept`)
    .send(body as object);
}

async function stored() {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
  const lines = await prisma.orderLine.findMany({
    where: { orderId: ORDER_ID },
    orderBy: { id: 'asc' },
  });
  return { status: order.status, total: order.totalAmount, lines };
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600011001');
  await seedPerson(MANAGER, '+237600011002');
  await seedPerson(SELLER, '+237600011003');
  await seedPerson(DRIVER, '+237600011004');
  await seedPerson(CUSTOMER, '+237600011005');
  await seedPerson(OTHER_OWNER, '+237600011006');
  await seedPerson(BIZ_MANAGER, '+237600011007');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: BUSINESS, name: 'Business', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, MANAGER, 'MANAGER', 2);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await seedMember(BUSINESS, CUSTOMER, 'OWNER', 7);
  await seedMember(BUSINESS, BIZ_MANAGER, 'MANAGER', 6);
  await seedProduct(prisma, {
    id: PRODUCT_A,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 2800n,
  });
  await seedProduct(prisma, {
    id: PRODUCT_B,
    organizationId: SUPPLIER,
    name: 'Salt',
    unit: 'kg',
    price: 500n,
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
    },
  });
  await seedOrder(ORDER_ID, REL, [LINE_1, LINE_2, OTHER_LINE]);
});

describe('ORD-011 supplier accepts an order, lowering prices if needed', () => {
  it('accepts as is: CONFIRMED, same prices and total, customer notified (AC-1, CM-12)', async () => {
    const response = await accept(ORDER_ID, { id: GESTURE });

    expect(response.status).toBe(200);
    const body = bodyOf<OrderBody>(response);
    expect(body).toMatchObject({ id: ORDER_ID, status: 'CONFIRMED', total_amount: 29000 });
    expect(body.lines.map((line) => line.unit_price_applied).sort()).toEqual([2800, 500].sort());
    const after = await stored();
    expect(after.status).toBe('CONFIRMED');
    expect(after.total).toBe(29000n);
    expect(after.lines.every((line) => line.priceSetById === null)).toBe(true);

    const notifications = await prisma.notification.findMany({
      where: { sourceEvent: 'order.status_changed' },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      recipientId: CUSTOMER,
      relatedEntityType: 'order',
      relatedEntityId: ORDER_ID,
    });
  });

  it('notifies the person who entered an organization order (AC-1)', async () => {
    await prisma.customerRelationship.create({
      data: {
        id: BIZ_REL,
        supplierOrganizationId: SUPPLIER,
        customerOrganizationId: BUSINESS,
        createdById: OWNER,
        status: 'ACTIVE',
      },
    });
    await seedOrder(
      OTHER_ORDER_ID,
      BIZ_REL,
      [
        '0199c011-0000-7000-8000-0000000000d4',
        '0199c011-0000-7000-8000-0000000000d5',
        '0199c011-0000-7000-8000-0000000000d6',
      ],
      'PENDING',
      BIZ_MANAGER
    );

    const response = await accept(OTHER_ORDER_ID, { id: GESTURE });

    expect(response.status).toBe(200);
    const notifications = await prisma.notification.findMany({
      where: { sourceEvent: 'order.status_changed' },
    });
    expect(notifications.map((n) => n.recipientId)).toEqual([BIZ_MANAGER]);
  });

  it.each([
    ['OWNER', OWNER],
    ['MANAGER', MANAGER],
  ])(
    'lets a %s accept and lower a price, and sees the author (AC-2, C-20, CM-16)',
    async (_n, personId) => {
      const response = await accept(
        ORDER_ID,
        { id: GESTURE, line_prices: [{ line_id: LINE_1, unit_price_applied: 2500 }] },
        personId
      );

      expect(response.status).toBe(200);
      const body = bodyOf<OrderBody>(response);
      const line = body.lines.find((l) => l.id === LINE_1)!;
      expect(line).toMatchObject({
        reference_price: 2800,
        unit_price_applied: 2500,
        amount: 25000,
        price_set_by_id: personId,
      });
      expect(line.price_set_at).toEqual(expect.any(String));
      expect(body.total_amount).toBe(26000);
      const untouched = body.lines.find((l) => l.id === LINE_2)!;
      expect(untouched).toMatchObject({
        unit_price_applied: 500,
        amount: 1000,
        price_set_by_id: null,
      });
    }
  );

  it('lowers a price to zero and rounds the amount half up (C-20)', async () => {
    const response = await accept(ORDER_ID, {
      id: GESTURE,
      line_prices: [
        { line_id: LINE_1, unit_price_applied: 0 },
        { line_id: LINE_2, unit_price_applied: 499 },
      ],
    });
    expect(response.status).toBe(200);
    const after = await stored();
    expect(after.status).toBe('CONFIRMED');
    expect(after.total).toBe(998n);
    const line1 = after.lines.find((l) => l.id === LINE_1)!;
    expect(line1).toMatchObject({ unitPriceApplied: 0n, referencePrice: 2800n, amount: 0n });
  });

  it('keeps a price sent equal to the current one unmarked (C-20)', async () => {
    const response = await accept(ORDER_ID, {
      id: GESTURE,
      line_prices: [{ line_id: LINE_1, unit_price_applied: 2800 }],
    });
    expect(response.status).toBe(200);
    const after = await stored();
    expect(
      after.lines.every((line) => line.priceSetById === null && line.priceSetAt === null)
    ).toBe(true);
    expect(after.total).toBe(29000n);
  });

  it('stores the author on a SELLER acceptance but hides it from the SELLER view (AC-2)', async () => {
    const response = await accept(ORDER_ID, {
      id: GESTURE,
      line_prices: [{ line_id: LINE_1, unit_price_applied: 2500 }],
    });
    expect(response.status).toBe(200);
    const line = bodyOf<OrderBody>(response).lines.find((l) => l.id === LINE_1)!;
    expect(line.unit_price_applied).toBe(2500);
    expect(line).not.toHaveProperty('price_set_by_id');
    const stored1 = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE_1 } });
    expect(stored1.priceSetById).toBe(SELLER);
    expect(stored1.priceSetAt).not.toBeNull();
  });

  describe('refusals (AC-3)', () => {
    it('refuses a price above the current one with 400 and changes nothing (AB-1)', async () => {
      const before = await stored();
      const response = await accept(ORDER_ID, {
        id: GESTURE,
        line_prices: [
          { line_id: LINE_2, unit_price_applied: 400 },
          { line_id: LINE_1, unit_price_applied: 2801 },
        ],
      });
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('PRICE_INCREASE_REFUSED');
      expect(await stored()).toEqual(before);
      expect(await prisma.notification.count()).toBe(0);
    });

    it.each([
      ['a negative price', -1],
      ['a fractional price', 1.5],
    ])('refuses %s with 400 VALIDATION_ERROR', async (_name, price) => {
      const before = await stored();
      const response = await accept(ORDER_ID, {
        id: GESTURE,
        line_prices: [{ line_id: LINE_1, unit_price_applied: price }],
      });
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await stored()).toEqual(before);
    });

    it('refuses unknown fields and duplicate lines with 400', async () => {
      const unknown = await accept(ORDER_ID, { id: GESTURE, status: 'DELIVERED' });
      expect(unknown.status).toBe(400);
      const nested = await accept(ORDER_ID, {
        id: GESTURE_2,
        line_prices: [{ line_id: LINE_1, unit_price_applied: 1, amount: 1 }],
      });
      expect(nested.status).toBe(400);
      const duplicate = await accept(ORDER_ID, {
        id: GESTURE_2,
        line_prices: [
          { line_id: LINE_1, unit_price_applied: 1 },
          { line_id: LINE_1, unit_price_applied: 2 },
        ],
      });
      expect(duplicate.status).toBe(400);
      expect((await stored()).status).toBe('PENDING');
    });

    it('answers 404 for a line of another order and changes nothing', async () => {
      await prisma.customerRelationship.create({
        data: {
          id: BIZ_REL,
          supplierOrganizationId: SUPPLIER,
          customerOrganizationId: BUSINESS,
          createdById: OWNER,
          status: 'ACTIVE',
        },
      });
      const otherLine = '0199c011-0000-7000-8000-0000000000d4';
      await seedOrder(OTHER_ORDER_ID, BIZ_REL, [
        otherLine,
        '0199c011-0000-7000-8000-0000000000d5',
        '0199c011-0000-7000-8000-0000000000d6',
      ]);
      const before = await stored();
      const response = await accept(ORDER_ID, {
        id: GESTURE,
        line_prices: [
          { line_id: LINE_1, unit_price_applied: 2000 },
          { line_id: otherLine, unit_price_applied: 1 },
        ],
      });
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await stored()).toEqual(before);
      const other = await prisma.orderLine.findUniqueOrThrow({ where: { id: otherLine } });
      expect(other.unitPriceApplied).toBe(2800n);
    });

    it.each(['CONFIRMED', 'CANCELLED'] as const)(
      'answers 409 INVALID_TRANSITION for a %s order',
      async (status) => {
        await prisma.order.update({
          where: { id: ORDER_ID },
          data:
            status === 'CANCELLED'
              ? {
                  status,
                  cancelledByParty: 'CUSTOMER',
                  cancelledById: CUSTOMER,
                  cancelledAt: REG,
                  cancellationReason: 'Changed mind',
                }
              : { status },
        });
        const before = await stored();
        const response = await accept(ORDER_ID, {
          id: GESTURE,
          line_prices: [{ line_id: LINE_1, unit_price_applied: 100 }],
        });
        expect(response.status).toBe(409);
        expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TRANSITION');
        expect(await stored()).toEqual(before);
        expect(await prisma.notification.count()).toBe(0);
      }
    );

    it('refuses a DRIVER with 403', async () => {
      const response = await accept(ORDER_ID, { id: GESTURE }, DRIVER);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
      expect((await stored()).status).toBe('PENDING');
    });

    it('answers 400 for a malformed order id and 401 without a token', async () => {
      const malformed = await accept('not-a-uuid', { id: GESTURE });
      expect(malformed.status).toBe(400);
      const response = await request(app)
        .post(`/api/v1/organizations/${SUPPLIER}/orders/${ORDER_ID}/accept`)
        .send({ id: GESTURE });
      expect(response.status).toBe(401);
    });
  });

  it('answers the second identical gesture with the first answer (AC-4)', async () => {
    const body = { id: GESTURE, line_prices: [{ line_id: LINE_1, unit_price_applied: 2500 }] };
    const first = await accept(ORDER_ID, body, OWNER);
    const second = await accept(ORDER_ID, body, OWNER);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(
      await prisma.notification.count({ where: { sourceEvent: 'order.status_changed' } })
    ).toBe(1);
  });

  it('lets exactly one of two parallel accepts win (CM-12, v5.0.0-2.3.1)', async () => {
    const [a, b] = await Promise.all([
      accept(ORDER_ID, { id: GESTURE }, OWNER),
      accept(ORDER_ID, { id: GESTURE_2 }, MANAGER),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(
      await prisma.notification.count({ where: { sourceEvent: 'order.status_changed' } })
    ).toBe(1);
  });

  describe('scope (AB-2)', () => {
    it('answers 404 when a member of another business accepts the order', async () => {
      const before = await stored();
      const response = await accept(ORDER_ID, { id: GESTURE }, OTHER_OWNER, OTHER_ORG);
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await stored()).toEqual(before);
    });

    it('answers 404 when a non-member uses the supplier path', async () => {
      const response = await accept(ORDER_ID, { id: GESTURE }, OTHER_OWNER, SUPPLIER);
      expect(response.status).toBe(404);
      expect((await stored()).status).toBe('PENDING');
    });

    it('answers 404 for an unknown order', async () => {
      const response = await accept(OTHER_ORDER_ID, { id: GESTURE });
      expect(response.status).toBe(404);
    });

    it('answers 404 for the customer organization using its own path', async () => {
      await prisma.customerRelationship.create({
        data: {
          id: BIZ_REL,
          supplierOrganizationId: SUPPLIER,
          customerOrganizationId: BUSINESS,
          createdById: OWNER,
          status: 'ACTIVE',
        },
      });
      await seedOrder(
        OTHER_ORDER_ID,
        BIZ_REL,
        [
          '0199c011-0000-7000-8000-0000000000d4',
          '0199c011-0000-7000-8000-0000000000d5',
          '0199c011-0000-7000-8000-0000000000d6',
        ],
        'PENDING',
        BIZ_MANAGER
      );
      const response = await accept(OTHER_ORDER_ID, { id: GESTURE }, BIZ_MANAGER, BUSINESS);
      expect(response.status).toBe(404);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: OTHER_ORDER_ID } });
      expect(order.status).toBe('PENDING');
    });
  });
});
