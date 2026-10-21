import { seedProduct } from '../../helpers/catalog-fixtures.js';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c017-0000-7000-8000-000000000001';
const SELLER = '0199c017-0000-7000-8000-000000000003';
const DRIVER = '0199c017-0000-7000-8000-000000000004';
const CUSTOMER = '0199c017-0000-7000-8000-000000000005';
const OTHER_PERSON = '0199c017-0000-7000-8000-000000000006';
const BUYER_OWNER = '0199c017-0000-7000-8000-000000000007';
const BUYER_MANAGER = '0199c017-0000-7000-8000-000000000008';
const BUYER_SELLER = '0199c017-0000-7000-8000-000000000009';

const SUPPLIER = '0199c017-0000-7000-8000-0000000000a1';
const BUYER = '0199c017-0000-7000-8000-0000000000a2';
const OTHER_BUYER = '0199c017-0000-7000-8000-0000000000a3';
const PRODUCT_A = '0199c017-0000-7000-8000-0000000000b1';
const REL = '0199c017-0000-7000-8000-0000000000e1';
const ORG_REL = '0199c017-0000-7000-8000-0000000000e2';
const ORDER_ID = '0199c017-0000-7000-8000-0000000000c1';
const ORG_ORDER_ID = '0199c017-0000-7000-8000-0000000000c2';
const LINE_1 = '0199c017-0000-7000-8000-0000000000d1';
const LINE_2 = '0199c017-0000-7000-8000-0000000000d2';
const GESTURE = '0199c017-0000-7000-8000-0000000000f1';
const GESTURE_2 = '0199c017-0000-7000-8000-0000000000f2';

const REG = new Date('2026-01-01T00:00:00.000Z');

type OrderBody = {
  id: string;
  status: string;
  cancelled_by_party: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
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
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c017-0000-7000-8000-0000000001${n}0`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedOrder(
  id: string,
  relationshipId: string,
  lineId: string,
  status: 'PENDING' | 'CONFIRMED',
  placedByParty: 'CUSTOMER' | 'SUPPLIER' = 'CUSTOMER',
  enteredById = CUSTOMER
) {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      placedByParty,
      enteredById,
      totalAmount: 28000n,
      status,
      lines: {
        create: [
          {
            id: lineId,
            productId: PRODUCT_A,
            labelApplied: 'Rice (sack)',
            quantity: '10',
            referencePrice: 2800n,
            unitPriceApplied: 2800n,
            amount: 28000n,
          },
        ],
      },
    },
  });
}

function cancel(orderId: string, body: unknown, personId = CUSTOMER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/orders/${orderId}/cancel`)
    .send(body as object);
}

function cancelPurchase(
  orderId: string,
  body: unknown,
  personId = BUYER_MANAGER,
  organizationId = BUYER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/purchases/${orderId}/cancel`)
    .send(body as object);
}

async function stored(id = ORDER_ID) {
  return prisma.order.findUniqueOrThrow({ where: { id } });
}

async function setStatus(status: 'IN_DELIVERY' | 'DELIVERED' | 'CANCELLED', id = ORDER_ID) {
  await prisma.order.update({ where: { id }, data: { status: 'CONFIRMED' } });
  if (status === 'DELIVERED') {
    await prisma.orderLine.updateMany({
      where: { orderId: id },
      data: { deliveredQuantity: '10' },
    });
  }
  await prisma.order.update({
    where: { id },
    data:
      status === 'CANCELLED'
        ? {
            status,
            cancelledByParty: 'SUPPLIER',
            cancelledById: SELLER,
            cancelledAt: REG,
            cancellationReason: 'Out of stock',
          }
        : status === 'DELIVERED'
          ? { status, deliveredAt: REG, deliveredById: SELLER }
          : { status },
  });
}

async function statusNotifications() {
  return prisma.notification.findMany({
    where: { sourceEvent: 'order.status_changed' },
    orderBy: { recipientId: 'asc' },
  });
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600017001');
  await seedPerson(SELLER, '+237600017003');
  await seedPerson(DRIVER, '+237600017004');
  await seedPerson(CUSTOMER, '+237600017005');
  await seedPerson(OTHER_PERSON, '+237600017006');
  await seedPerson(BUYER_OWNER, '+237600017007');
  await seedPerson(BUYER_MANAGER, '+237600017008');
  await seedPerson(BUYER_SELLER, '+237600017009');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: BUYER, name: 'Buyer', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_BUYER, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
  await seedMember(BUYER, BUYER_OWNER, 'OWNER', 7);
  await seedMember(BUYER, BUYER_MANAGER, 'MANAGER', 8);
  await seedMember(BUYER, BUYER_SELLER, 'SELLER', 9);
  await seedMember(OTHER_BUYER, OTHER_PERSON, 'OWNER', 6);
  await seedProduct(prisma, {
    id: PRODUCT_A,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 2800n,
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
  await prisma.customerRelationship.create({
    data: {
      id: ORG_REL,
      supplierOrganizationId: SUPPLIER,
      customerOrganizationId: BUYER,
      createdById: BUYER_OWNER,
      status: 'ACTIVE',
    },
  });
  await seedOrder(ORDER_ID, REL, LINE_1, 'PENDING');
  await seedOrder(ORG_ORDER_ID, ORG_REL, LINE_2, 'CONFIRMED', 'CUSTOMER', BUYER_SELLER);
});

describe('ORD-017 customer cancels an order before departure', () => {
  it('cancels a PENDING order, sets the four cancellation fields and notifies the supplier team (AC-1, C-16)', async () => {
    const response = await cancel(ORDER_ID, { id: GESTURE });

    expect(response.status).toBe(200);
    expect(bodyOf<OrderBody>(response)).toMatchObject({
      id: ORDER_ID,
      status: 'CANCELLED',
      cancelled_by_party: 'CUSTOMER',
      cancellation_reason: null,
    });
    expect(bodyOf<OrderBody>(response).cancelled_at).toEqual(expect.any(String));
    // The customer view never shows the supplier team's person ids.
    expect(response.body).not.toHaveProperty('cancelled_by_id');
    expect(await stored()).toMatchObject({
      status: 'CANCELLED',
      cancelledByParty: 'CUSTOMER',
      cancelledById: CUSTOMER,
      cancellationReason: null,
    });
    expect((await stored()).cancelledAt).not.toBeNull();

    const notifications = await statusNotifications();
    expect(notifications.map((n) => n.recipientId).sort()).toEqual([OWNER, SELLER].sort());
    expect(notifications[0]).toMatchObject({
      relatedEntityType: 'order',
      relatedEntityId: ORDER_ID,
    });
  });

  it('cancels a CONFIRMED order and stores the reason, whoever entered it (AC-2)', async () => {
    await prisma.order.update({
      where: { id: ORDER_ID },
      data: { status: 'CONFIRMED', placedByParty: 'SUPPLIER', enteredById: SELLER },
    });
    const response = await cancel(ORDER_ID, { id: GESTURE, reason: 'Changed my mind' });

    expect(response.status).toBe(200);
    expect(bodyOf<OrderBody>(response)).toMatchObject({
      status: 'CANCELLED',
      cancelled_by_party: 'CUSTOMER',
      cancellation_reason: 'Changed my mind',
    });
    expect(await stored()).toMatchObject({
      status: 'CANCELLED',
      cancelledById: CUSTOMER,
      cancellationReason: 'Changed my mind',
    });
  });

  describe('organization (AC-3)', () => {
    it('lets a MANAGER cancel an order a colleague entered', async () => {
      const response = await cancelPurchase(ORG_ORDER_ID, { id: GESTURE, reason: 'Budget cut' });

      expect(response.status).toBe(200);
      expect(bodyOf<OrderBody>(response)).toMatchObject({
        status: 'CANCELLED',
        cancelled_by_party: 'CUSTOMER',
        cancellation_reason: 'Budget cut',
      });
      expect(await stored(ORG_ORDER_ID)).toMatchObject({
        status: 'CANCELLED',
        cancelledByParty: 'CUSTOMER',
        cancelledById: BUYER_MANAGER,
      });
      expect((await statusNotifications()).map((n) => n.recipientId).sort()).toEqual(
        [OWNER, SELLER].sort()
      );
    });

    it('lets an OWNER cancel', async () => {
      const response = await cancelPurchase(ORG_ORDER_ID, { id: GESTURE }, BUYER_OWNER);
      expect(response.status).toBe(200);
      expect((await stored(ORG_ORDER_ID)).cancelledById).toBe(BUYER_OWNER);
    });

    it('answers 403 FORBIDDEN for a SELLER and changes nothing', async () => {
      const before = await stored(ORG_ORDER_ID);
      const response = await cancelPurchase(ORG_ORDER_ID, { id: GESTURE }, BUYER_SELLER);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
      expect(await stored(ORG_ORDER_ID)).toEqual(before);
      expect(await prisma.notification.count()).toBe(0);
    });

    it('answers 404 for a manager of another business, and for a non-member of the path', async () => {
      const before = await stored(ORG_ORDER_ID);
      const asOther = await cancelPurchase(
        ORG_ORDER_ID,
        { id: GESTURE },
        OTHER_PERSON,
        OTHER_BUYER
      );
      expect(asOther.status).toBe(404);
      const nonMember = await cancelPurchase(ORG_ORDER_ID, { id: GESTURE }, OTHER_PERSON);
      expect(nonMember.status).toBe(404);
      expect(await stored(ORG_ORDER_ID)).toEqual(before);
    });

    it('answers 404 when the order belongs to a person relationship, not the organization', async () => {
      const response = await cancelPurchase(ORDER_ID, { id: GESTURE });
      expect(response.status).toBe(404);
      expect((await stored()).status).toBe('PENDING');
    });

    it('does not let the person route cancel an organization order', async () => {
      const response = await cancel(ORG_ORDER_ID, { id: GESTURE }, BUYER_MANAGER);
      expect(response.status).toBe(404);
      expect((await stored(ORG_ORDER_ID)).status).toBe('CONFIRMED');
    });
  });

  describe('refusals (AC-4)', () => {
    it.each(['IN_DELIVERY', 'DELIVERED', 'CANCELLED'] as const)(
      'answers 409 INVALID_TRANSITION for a %s order and changes nothing',
      async (status) => {
        await setStatus(status);
        const before = await stored();
        const response = await cancel(ORDER_ID, { id: GESTURE, reason: 'late' });
        expect(response.status).toBe(409);
        expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TRANSITION');
        expect(await stored()).toEqual(before);
        expect(await prisma.notification.count()).toBe(0);
      }
    );

    it('answers 404 NOT_FOUND for the order of another customer and changes nothing', async () => {
      const before = await stored();
      const response = await cancel(ORDER_ID, { id: GESTURE }, OTHER_PERSON);
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await stored()).toEqual(before);
      expect(await prisma.notification.count()).toBe(0);
    });

    it('answers 404 for an unknown order', async () => {
      const response = await cancel('0199c017-0000-7000-8000-0000000000c9', { id: GESTURE });
      expect(response.status).toBe(404);
    });

    it.each([
      ['no gesture id', {}],
      ['an empty reason', { id: GESTURE, reason: '' }],
      ['a reason of 2001 characters', { id: GESTURE, reason: 'a'.repeat(2001) }],
      ['an unknown field', { id: GESTURE, status: 'DELIVERED' }],
      ['a forged party', { id: GESTURE, cancelled_by_party: 'SUPPLIER' }],
    ])('answers 400 VALIDATION_ERROR for %s and changes nothing', async (_name, body) => {
      const response = await cancel(ORDER_ID, body);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect((await stored()).status).toBe('PENDING');
    });

    it('answers 400 for a malformed order id and 401 without a token', async () => {
      expect((await cancel('not-a-uuid', { id: GESTURE })).status).toBe(400);
      const response = await request(app)
        .post(`/api/v1/orders/${ORDER_ID}/cancel`)
        .send({ id: GESTURE });
      expect(response.status).toBe(401);
    });
  });

  describe('abuse cases', () => {
    it('AB-1: person B cannot cancel the order of person A (WSTG-ATHZ-04)', async () => {
      const before = await stored();
      const response = await cancel(ORDER_ID, { id: GESTURE, reason: 'mine now' }, OTHER_PERSON);
      expect(response.status).toBe(404);
      expect(await stored()).toEqual(before);
    });

    it('AB-2: an order IN_DELIVERY answers 409 and the delivery continues (WSTG-BUSL-06)', async () => {
      await setStatus('IN_DELIVERY');
      const response = await cancel(ORDER_ID, { id: GESTURE });
      expect(response.status).toBe(409);
      expect((await stored()).status).toBe('IN_DELIVERY');
    });
  });

  it('answers the second identical gesture with the first answer and notifies the team once', async () => {
    const body = { id: GESTURE, reason: 'twice' };
    const first = await cancel(ORDER_ID, body);
    const second = await cancel(ORDER_ID, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await statusNotifications()).toHaveLength(2);
  });

  it('lets exactly one of two parallel cancellations win (v5.0.0-2.3.1)', async () => {
    const [a, b] = await Promise.all([
      cancel(ORDER_ID, { id: GESTURE, reason: 'one' }),
      cancel(ORDER_ID, { id: GESTURE_2, reason: 'two' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await statusNotifications()).toHaveLength(2);
  });
});
