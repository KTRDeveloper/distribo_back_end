import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c012-0000-7000-8000-000000000001';
const SELLER = '0199c012-0000-7000-8000-000000000003';
const DRIVER = '0199c012-0000-7000-8000-000000000004';
const CUSTOMER = '0199c012-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c012-0000-7000-8000-000000000006';

const SUPPLIER = '0199c012-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c012-0000-7000-8000-0000000000a2';
const PRODUCT_A = '0199c012-0000-7000-8000-0000000000b1';
const REL = '0199c012-0000-7000-8000-0000000000e1';
const ORDER_ID = '0199c012-0000-7000-8000-0000000000c1';
const LINE_1 = '0199c012-0000-7000-8000-0000000000d1';
const GESTURE = '0199c012-0000-7000-8000-0000000000f1';
const GESTURE_2 = '0199c012-0000-7000-8000-0000000000f2';

const REG = new Date('2026-01-01T00:00:00.000Z');

type OrderBody = {
  id: string;
  status: string;
  cancelled_by_party: string | null;
  cancelled_by_id: string | null;
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
  role: 'OWNER' | 'SELLER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c012-0000-7000-8000-0000000001${n}0`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

function cancel(orderId: string, body: unknown, personId = SELLER, organizationId = SUPPLIER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/orders/${orderId}/cancel`)
    .send(body as object);
}

async function stored() {
  return prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600012001');
  await seedPerson(SELLER, '+237600012003');
  await seedPerson(DRIVER, '+237600012004');
  await seedPerson(CUSTOMER, '+237600012005');
  await seedPerson(OTHER_OWNER, '+237600012006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await prisma.product.create({
    data: { id: PRODUCT_A, organizationId: SUPPLIER, name: 'Rice', unit: 'sack', price: 2800n },
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
  await prisma.order.create({
    data: {
      id: ORDER_ID,
      customerRelationshipId: REL,
      placedByParty: 'CUSTOMER',
      enteredById: CUSTOMER,
      totalAmount: 28000n,
      status: 'CONFIRMED',
      lines: {
        create: [
          {
            id: LINE_1,
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
});

async function setStatus(status: 'IN_DELIVERY' | 'DELIVERED' | 'CANCELLED') {
  if (status === 'DELIVERED') {
    await prisma.orderLine.updateMany({
      where: { orderId: ORDER_ID },
      data: { deliveredQuantity: '10' },
    });
  }
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
        : status === 'DELIVERED'
          ? { status, deliveredAt: REG, deliveredById: SELLER }
          : { status },
  });
}

describe('ORD-016 supplier cancels an order before departure', () => {
  it('cancels a CONFIRMED order with the four cancellation fields and notifies the customer (AC-1, C-16)', async () => {
    const response = await cancel(ORDER_ID, { id: GESTURE, reason: 'article plus disponible' });

    expect(response.status).toBe(200);
    expect(bodyOf<OrderBody>(response)).toMatchObject({
      id: ORDER_ID,
      status: 'CANCELLED',
      cancelled_by_party: 'SUPPLIER',
      cancelled_by_id: SELLER,
      cancellation_reason: 'article plus disponible',
    });
    expect(bodyOf<OrderBody>(response).cancelled_at).toEqual(expect.any(String));
    const after = await stored();
    expect(after).toMatchObject({
      status: 'CANCELLED',
      cancelledByParty: 'SUPPLIER',
      cancelledById: SELLER,
      cancellationReason: 'article plus disponible',
    });
    expect(after.cancelledAt).not.toBeNull();

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

  it('also cancels a PENDING order (ACC-003 rule cancel)', async () => {
    const pendingId = '0199c012-0000-7000-8000-0000000000c2';
    await prisma.order.create({
      data: {
        id: pendingId,
        customerRelationshipId: REL,
        placedByParty: 'CUSTOMER',
        enteredById: CUSTOMER,
        totalAmount: 0n,
        status: 'PENDING',
      },
    });
    const response = await cancel(pendingId, { id: GESTURE, reason: 'stock' }, OWNER);
    expect(response.status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pendingId } })).status).toBe(
      'CANCELLED'
    );
  });

  describe('refusals (AC-2)', () => {
    it.each([
      ['no reason', { id: GESTURE }],
      ['an empty reason', { id: GESTURE, reason: '' }],
      ['a blank reason', { id: GESTURE, reason: '   ' }],
      ['a reason of 2001 characters', { id: GESTURE, reason: 'a'.repeat(2001) }],
      ['an unknown field', { id: GESTURE, reason: 'stock', status: 'DELIVERED' }],
    ])('answers 400 VALIDATION_ERROR for %s and changes nothing', async (_name, body) => {
      const response = await cancel(ORDER_ID, body);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect((await stored()).status).toBe('CONFIRMED');
      expect(await prisma.notification.count()).toBe(0);
    });

    it.each(['IN_DELIVERY', 'DELIVERED', 'CANCELLED'] as const)(
      'answers 409 INVALID_TRANSITION for a %s order and changes nothing',
      async (status) => {
        await setStatus(status);
        const before = await stored();
        const response = await cancel(ORDER_ID, { id: GESTURE, reason: 'stock' });
        expect(response.status).toBe(409);
        expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TRANSITION');
        expect(await stored()).toEqual(before);
        expect(await prisma.notification.count()).toBe(0);
      }
    );

    it('answers 403 FORBIDDEN for a DRIVER', async () => {
      const response = await cancel(ORDER_ID, { id: GESTURE, reason: 'stock' }, DRIVER);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
      expect((await stored()).status).toBe('CONFIRMED');
    });

    it('answers 400 for a malformed order id and 401 without a token', async () => {
      const malformed = await cancel('not-a-uuid', { id: GESTURE, reason: 'stock' });
      expect(malformed.status).toBe(400);
      const response = await request(app)
        .post(`/api/v1/organizations/${SUPPLIER}/orders/${ORDER_ID}/cancel`)
        .send({ id: GESTURE, reason: 'stock' });
      expect(response.status).toBe(401);
    });
  });

  it('keeps the supplier note next to the cancellation reason (AC-3)', async () => {
    await prisma.order.update({
      where: { id: ORDER_ID },
      data: { supplierNote: 'Livraison lundi' },
    });
    const response = await cancel(ORDER_ID, { id: GESTURE, reason: 'article plus disponible' });

    expect(response.status).toBe(200);
    expect(bodyOf<OrderBody & { supplier_note: string | null }>(response)).toMatchObject({
      supplier_note: 'Livraison lundi',
      cancellation_reason: 'article plus disponible',
    });
    expect(await stored()).toMatchObject({
      supplierNote: 'Livraison lundi',
      cancellationReason: 'article plus disponible',
    });
  });

  it('answers the second identical gesture with the first answer', async () => {
    const body = { id: GESTURE, reason: 'rupture de stock' };
    const first = await cancel(ORDER_ID, body, OWNER);
    const second = await cancel(ORDER_ID, body, OWNER);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(
      await prisma.notification.count({ where: { sourceEvent: 'order.status_changed' } })
    ).toBe(1);
  });

  it('lets exactly one of two parallel cancellations win (v5.0.0-2.3.1)', async () => {
    const [a, b] = await Promise.all([
      cancel(ORDER_ID, { id: GESTURE, reason: 'one' }, OWNER),
      cancel(ORDER_ID, { id: GESTURE_2, reason: 'two' }, SELLER),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(
      await prisma.notification.count({ where: { sourceEvent: 'order.status_changed' } })
    ).toBe(1);
  });

  describe('other business (AB-2, WSTG-ATHZ-04)', () => {
    it('answers 404 when a member of another business cancels the order', async () => {
      const before = await stored();
      const response = await cancel(
        ORDER_ID,
        { id: GESTURE, reason: 'stock' },
        OTHER_OWNER,
        OTHER_ORG
      );
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await stored()).toEqual(before);
      expect(await prisma.notification.count()).toBe(0);
    });

    it('answers 404 when a non-member uses the supplier path', async () => {
      const response = await cancel(ORDER_ID, { id: GESTURE, reason: 'stock' }, OTHER_OWNER);
      expect(response.status).toBe(404);
      expect((await stored()).status).toBe('CONFIRMED');
    });
  });
});
