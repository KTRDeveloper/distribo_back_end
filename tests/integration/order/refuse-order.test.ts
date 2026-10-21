import { seedProduct } from '../../helpers/catalog-fixtures.js';
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

function refuse(orderId: string, body: unknown, personId = SELLER, organizationId = SUPPLIER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/orders/${orderId}/refuse`)
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
  await prisma.order.create({
    data: {
      id: ORDER_ID,
      customerRelationshipId: REL,
      placedByParty: 'CUSTOMER',
      enteredById: CUSTOMER,
      totalAmount: 28000n,
      status: 'PENDING',
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

describe('ORD-012 supplier refuses an order', () => {
  it('cancels a PENDING order with the supplier, the caller, a time and the reason (AC-1, C-16, CM-12)', async () => {
    const response = await refuse(ORDER_ID, { id: GESTURE, reason: 'rupture de stock' });

    expect(response.status).toBe(200);
    expect(bodyOf<OrderBody>(response)).toMatchObject({
      id: ORDER_ID,
      status: 'CANCELLED',
      cancelled_by_party: 'SUPPLIER',
      cancelled_by_id: SELLER,
      cancellation_reason: 'rupture de stock',
    });
    expect(bodyOf<OrderBody>(response).cancelled_at).toEqual(expect.any(String));
    const after = await stored();
    expect(after).toMatchObject({
      status: 'CANCELLED',
      cancelledByParty: 'SUPPLIER',
      cancelledById: SELLER,
      cancellationReason: 'rupture de stock',
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

  describe('refusals (AC-2)', () => {
    it.each([
      ['no reason', { id: GESTURE }],
      ['an empty reason', { id: GESTURE, reason: '' }],
      ['a blank reason', { id: GESTURE, reason: '   ' }],
      ['a reason of 2001 characters', { id: GESTURE, reason: 'a'.repeat(2001) }],
      ['an unknown field', { id: GESTURE, reason: 'stock', status: 'DELIVERED' }],
    ])('answers 400 VALIDATION_ERROR for %s and changes nothing', async (_name, body) => {
      const response = await refuse(ORDER_ID, body);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect((await stored()).status).toBe('PENDING');
      expect(await prisma.notification.count()).toBe(0);
    });

    it('accepts a reason of exactly 2000 characters', async () => {
      const response = await refuse(ORDER_ID, { id: GESTURE, reason: 'a'.repeat(2000) });
      expect(response.status).toBe(200);
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
        const response = await refuse(ORDER_ID, { id: GESTURE, reason: 'stock' });
        expect(response.status).toBe(409);
        expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TRANSITION');
        expect(await stored()).toEqual(before);
        expect(await prisma.notification.count()).toBe(0);
      }
    );

    it('answers 403 FORBIDDEN for a DRIVER', async () => {
      const response = await refuse(ORDER_ID, { id: GESTURE, reason: 'stock' }, DRIVER);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
      expect((await stored()).status).toBe('PENDING');
    });

    it('answers 400 for a malformed order id and 401 without a token', async () => {
      const malformed = await refuse('not-a-uuid', { id: GESTURE, reason: 'stock' });
      expect(malformed.status).toBe(400);
      const response = await request(app)
        .post(`/api/v1/organizations/${SUPPLIER}/orders/${ORDER_ID}/refuse`)
        .send({ id: GESTURE, reason: 'stock' });
      expect(response.status).toBe(401);
    });
  });

  it('answers the second identical gesture with the first answer (AC-3)', async () => {
    const body = { id: GESTURE, reason: 'rupture de stock' };
    const first = await refuse(ORDER_ID, body, OWNER);
    const second = await refuse(ORDER_ID, body, OWNER);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(
      await prisma.notification.count({ where: { sourceEvent: 'order.status_changed' } })
    ).toBe(1);
  });

  it('lets exactly one of two parallel refusals win (CM-12, v5.0.0-2.3.1)', async () => {
    const [a, b] = await Promise.all([
      refuse(ORDER_ID, { id: GESTURE, reason: 'one' }, OWNER),
      refuse(ORDER_ID, { id: GESTURE_2, reason: 'two' }, SELLER),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(
      await prisma.notification.count({ where: { sourceEvent: 'order.status_changed' } })
    ).toBe(1);
  });

  describe('other business (AB-1, WSTG-ATHZ-04)', () => {
    it('answers 404 when a member of another business refuses the order', async () => {
      const before = await stored();
      const response = await refuse(
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
      const response = await refuse(ORDER_ID, { id: GESTURE, reason: 'stock' }, OTHER_OWNER);
      expect(response.status).toBe(404);
      expect((await stored()).status).toBe('PENDING');
    });
  });
});
