import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0d4-0000-7000-8000-000000000001';
const MANAGER = '0199c0d4-0000-7000-8000-000000000002';
const SELLER = '0199c0d4-0000-7000-8000-000000000003';
const DRIVER_1 = '0199c0d4-0000-7000-8000-000000000004';
const DRIVER_2 = '0199c0d4-0000-7000-8000-000000000005';
const CUSTOMER = '0199c0d4-0000-7000-8000-000000000006';
const OTHER_OWNER = '0199c0d4-0000-7000-8000-000000000007';
const OTHER_DRIVER = '0199c0d4-0000-7000-8000-000000000008';

const SUPPLIER = '0199c0d4-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c0d4-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c0d4-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c0d4-0000-7000-8000-0000000000b2';
const REL = '0199c0d4-0000-7000-8000-0000000000e1';
const OTHER_REL = '0199c0d4-0000-7000-8000-0000000000e2';

const REG = new Date('2026-01-01T00:00:00.000Z');
const DEPARTED = new Date('2026-07-01T08:00:00.000Z');

const orderId = (n: number) => `0199c0d4-0000-7000-8000-0000000001${n}0`;
const lineId = (n: number) => `0199c0d4-0000-7000-8000-0000000002${n}0`;
const deliveryId = (n: number) => `0199c0d4-0000-7000-8000-0000000003${n}0`;
const gestureId = (n: number) => `0199c0d4-0000-7000-8000-0000000005${n}0`;

type FailBody = {
  delivery: {
    id: string;
    order_id: string;
    assigned_to_id: string;
    departed_at: string | null;
    failed_at: string | null;
    failure_reason: string | null;
  };
  order_status: string;
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
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c0d4-0000-7000-8000-0000000004${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedOrder(
  n: number,
  status: 'CONFIRMED' | 'IN_DELIVERY' | 'DELIVERED',
  relationshipId = REL
) {
  await prisma.order.create({
    data: {
      id: orderId(n),
      customerRelationshipId: relationshipId,
      enteredById: SELLER,
      placedByParty: 'SUPPLIER',
      ...(status === 'DELIVERED' ? { deliveredAt: REG, deliveredById: DRIVER_1 } : {}),
      status,
      deliveryAddressApplied: `Street ${n}`,
      deliveryCost: 0n,
      totalAmount: 3000n,
      createdAt: new Date(Date.UTC(2026, 5, n)),
      lines: {
        create: {
          id: lineId(n),
          productId: relationshipId === OTHER_REL ? OTHER_PRODUCT : PRODUCT,
          labelApplied: 'Rice (sack)',
          quantity: '2',
          ...(status === 'DELIVERED' ? { deliveredQuantity: '2' } : {}),
          referencePrice: 1500n,
          unitPriceApplied: 1500n,
          amount: 3000n,
        },
      },
    },
  });
}

async function seedDelivery(
  n: number,
  orderNumber: number,
  driverId: string,
  state: 'assigned' | 'departed' | 'arrived' | 'failed' = 'departed'
) {
  await prisma.delivery.create({
    data: {
      id: deliveryId(n),
      orderId: orderId(orderNumber),
      assignedToId: driverId,
      departedAt: state === 'assigned' ? null : DEPARTED,
      arrivedAt: state === 'arrived' ? new Date('2026-07-01T09:00:00.000Z') : null,
      failedAt: state === 'failed' ? new Date('2026-07-01T09:00:00.000Z') : null,
      failureReason: state === 'failed' ? 'Earlier failure' : null,
    },
  });
}

function fail(
  personId: string,
  delivery: number,
  body: Record<string, unknown>,
  organizationId = SUPPLIER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/deliveries/${deliveryId(delivery)}/fail`)
    .send(body);
}

/**
 * Supplier with an owner, a manager, a seller and two drivers. Order 1 is IN_DELIVERY with a
 * delivery of DRIVER_1, order 2 is IN_DELIVERY with a delivery of DRIVER_2, order 3 is CONFIRMED
 * with a delivery assigned to DRIVER_1 that has not departed, order 4 has an arrived delivery,
 * order 5 has a failed delivery and is CONFIRMED, order 6 belongs to another business.
 */
async function seedBase() {
  await seedPerson(OWNER, '+237600085001');
  await seedPerson(MANAGER, '+237600085002');
  await seedPerson(SELLER, '+237600085003');
  await seedPerson(DRIVER_1, '+237600085004');
  await seedPerson(DRIVER_2, '+237600085005');
  await seedPerson(CUSTOMER, '+237600085006');
  await seedPerson(OTHER_OWNER, '+237600085007');
  await seedPerson(OTHER_DRIVER, '+237600085008');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, MANAGER, 'MANAGER', 2);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER_1, 'DRIVER', 4);
  await seedMember(SUPPLIER, DRIVER_2, 'DRIVER', 5);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 6);
  await seedMember(OTHER_ORG, OTHER_DRIVER, 'DRIVER', 7);
  await seedProduct(prisma, {
    id: PRODUCT,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 1500n,
  });
  await seedProduct(prisma, {
    id: OTHER_PRODUCT,
    organizationId: OTHER_ORG,
    name: 'Oil',
    unit: 'l',
    price: 900n,
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
      id: OTHER_REL,
      supplierOrganizationId: OTHER_ORG,
      customerPersonId: CUSTOMER,
      createdById: OTHER_OWNER,
      status: 'ACTIVE',
    },
  });
  await seedOrder(1, 'IN_DELIVERY');
  await seedOrder(2, 'IN_DELIVERY');
  await seedOrder(3, 'CONFIRMED');
  await seedOrder(4, 'DELIVERED');
  await seedOrder(5, 'CONFIRMED');
  await seedOrder(6, 'IN_DELIVERY', OTHER_REL);
  await seedDelivery(1, 1, DRIVER_1);
  await seedDelivery(2, 2, DRIVER_2);
  await seedDelivery(3, 3, DRIVER_1, 'assigned');
  await seedDelivery(4, 4, DRIVER_1, 'arrived');
  await seedDelivery(5, 5, DRIVER_1, 'failed');
  await seedDelivery(6, 6, OTHER_DRIVER);
}

describe('DLV-006 driver reports a failed delivery', () => {
  beforeEach(seedBase);

  it('marks the delivery failed with the reason and puts the order back to CONFIRMED (AC-1, C-21, CM-12)', async () => {
    const response = await fail(DRIVER_1, 1, { id: gestureId(1), reason: 'client absent' });

    expect(response.status).toBe(200);
    const body = bodyOf<FailBody>(response);
    expect(body.order_status).toBe('CONFIRMED');
    expect(body.delivery).toMatchObject({
      id: deliveryId(1),
      order_id: orderId(1),
      assigned_to_id: DRIVER_1,
      failure_reason: 'client absent',
    });
    expect(body.delivery.failed_at).not.toBeNull();
    const row = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(1) } });
    expect(row.failedAt).not.toBeNull();
    expect(row.arrivedAt).toBeNull();
    expect(row.failureReason).toBe('client absent');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId(1) } });
    expect(order.status).toBe('CONFIRMED');
  });

  it('shows the order again in the to-deliver list and the failed list (AC-1)', async () => {
    await fail(DRIVER_1, 1, { id: gestureId(1), reason: 'client absent' });

    const pool = await createAuthenticatedRequest(app, DRIVER_2).get(
      `/api/v1/organizations/${SUPPLIER}/deliveries/to-deliver`
    );
    const mine = await createAuthenticatedRequest(app, DRIVER_1).get(
      `/api/v1/organizations/${SUPPLIER}/deliveries/mine?status=failed`
    );

    const orders = bodyOf<{ items: Array<{ order_id: string }> }>(pool).items.map(
      (item) => item.order_id
    );
    expect(orders).toContain(orderId(1));
    expect(
      bodyOf<{ items: Array<{ order_id: string }> }>(mine).items.map((i) => i.order_id)
    ).toContain(orderId(1));
  });

  it('notifies the owner and the managers delivery.failed', async () => {
    await fail(DRIVER_1, 1, { id: gestureId(1), reason: 'client absent' });

    const notifications = await prisma.notification.findMany({
      where: { sourceEvent: 'delivery.failed' },
    });
    expect(notifications.map((n) => n.recipientId).sort()).toEqual([OWNER, MANAGER].sort());
    expect(notifications.every((n) => n.organizationId === SUPPLIER)).toBe(true);
  });

  it('lets another driver depart with it: a second delivery row exists (AC-2)', async () => {
    await fail(DRIVER_1, 1, { id: gestureId(1), reason: 'client absent' });

    const response = await createAuthenticatedRequest(app, DRIVER_2)
      .post(`/api/v1/organizations/${SUPPLIER}/orders/${orderId(1)}/depart`)
      .send({ id: gestureId(2) });

    expect(response.status).toBe(200);
    const rows = await prisma.delivery.findMany({ where: { orderId: orderId(1) } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.failedAt === null)).toHaveLength(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId(1) } })).status).toBe(
      'IN_DELIVERY'
    );
  });

  it.each([
    ['a MANAGER', MANAGER],
    ['an OWNER', OWNER],
  ])('lets %s fail the delivery of another driver', async (_label, caller) => {
    const response = await fail(caller, 1, { id: gestureId(1), reason: 'road closed' });

    expect(response.status).toBe(200);
    const row = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(1) } });
    expect(row).toMatchObject({ failureReason: 'road closed', assignedToId: DRIVER_1 });
    expect(row.failedAt).not.toBeNull();
  });

  describe('refusals (AC-3)', () => {
    async function expectUnchanged(delivery: number, order: number, status: string) {
      const row = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(delivery) } });
      expect(row.failureReason === null || row.failureReason === 'Earlier failure').toBe(true);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId(order) } })).status).toBe(
        status
      );
      expect(await prisma.notification.count()).toBe(0);
    }

    it.each([
      ['no reason', { id: gestureId(1) }],
      ['an empty reason', { id: gestureId(1), reason: '' }],
      ['a blank reason', { id: gestureId(1), reason: '   ' }],
      ['a reason over 2000 characters', { id: gestureId(1), reason: 'x'.repeat(2001) }],
      ['an unknown field', { id: gestureId(1), reason: 'absent', failed_at: '2026-01-01' }],
      ['a malformed id', { id: 'nope', reason: 'absent' }],
    ])('answers 400 VALIDATION_ERROR for %s', async (_label, body) => {
      const response = await fail(DRIVER_1, 1, body);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(
        (await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(1) } })).failedAt
      ).toBeNull();
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId(1) } })).status).toBe(
        'IN_DELIVERY'
      );
    });

    it('accepts a reason of exactly 2000 characters', async () => {
      const response = await fail(DRIVER_1, 1, { id: gestureId(1), reason: 'x'.repeat(2000) });

      expect(response.status).toBe(200);
    });

    it('answers 404 NOT_FOUND for the delivery of another driver', async () => {
      const response = await fail(DRIVER_1, 2, { id: gestureId(1), reason: 'absent' });

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      await expectUnchanged(2, 2, 'IN_DELIVERY');
    });

    it('answers 404 NOT_FOUND for an unknown delivery', async () => {
      const response = await fail(DRIVER_1, 9, { id: gestureId(1), reason: 'absent' });

      expect(response.status).toBe(404);
    });

    it('answers 409 INVALID_TRANSITION for a delivery already arrived', async () => {
      const response = await fail(DRIVER_1, 4, { id: gestureId(1), reason: 'absent' });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TRANSITION');
      const row = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(4) } });
      expect(row.failedAt).toBeNull();
      await expectUnchanged(4, 4, 'DELIVERED');
    });

    it('answers 409 INVALID_TRANSITION for a delivery already failed', async () => {
      const response = await fail(DRIVER_1, 5, { id: gestureId(1), reason: 'absent' });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TRANSITION');
      const row = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(5) } });
      expect(row.failureReason).toBe('Earlier failure');
      await expectUnchanged(5, 5, 'CONFIRMED');
    });

    it('answers 409 INVALID_TRANSITION for a delivery that has not departed', async () => {
      const response = await fail(DRIVER_1, 3, { id: gestureId(1), reason: 'absent' });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TRANSITION');
      await expectUnchanged(3, 3, 'CONFIRMED');
    });

    it('answers 401 without a token', async () => {
      const { default: request } = await import('supertest');
      const response = await request(app)
        .post(`/api/v1/organizations/${SUPPLIER}/deliveries/${deliveryId(1)}/fail`)
        .send({ id: gestureId(1), reason: 'absent' });

      expect(response.status).toBe(401);
    });
  });

  it('answers equal responses when the same id is posted twice (AC-4)', async () => {
    const first = await fail(DRIVER_1, 1, { id: gestureId(1), reason: 'client absent' });
    const second = await fail(DRIVER_1, 1, { id: gestureId(1), reason: 'client absent' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await prisma.notification.count({ where: { sourceEvent: 'delivery.failed' } })).toBe(2);
  });

  it('answers 404 to a driver failing the delivery of another and changes nothing (AB-1, WSTG-ATHZ-04)', async () => {
    const before = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(2) } });

    const response = await fail(DRIVER_1, 2, { id: gestureId(1), reason: 'sabotage' });

    expect(response.status).toBe(404);
    expect(await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(2) } })).toEqual(
      before
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId(2) } })).status).toBe(
      'IN_DELIVERY'
    );
  });

  it('lets exactly one of two parallel failures through and notifies once (CWE-362, v5.0.0-2.3.4)', async () => {
    const [first, second] = await Promise.all([
      fail(DRIVER_1, 1, { id: gestureId(1), reason: 'client absent' }),
      fail(MANAGER, 1, { id: gestureId(2), reason: 'road closed' }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(bodyOf<ErrorBody>(loser).error.code).toBe('INVALID_TRANSITION');
    expect(await prisma.notification.count({ where: { sourceEvent: 'delivery.failed' } })).toBe(2);
  });

  it('answers 404 to a member of another business and changes nothing (v5.0.0-8.2.2)', async () => {
    const foreignMember = await fail(OTHER_OWNER, 1, { id: gestureId(1), reason: 'x' }, SUPPLIER);
    const crossPath = await fail(OTHER_OWNER, 1, { id: gestureId(2), reason: 'x' }, OTHER_ORG);
    const ownMember = await fail(OWNER, 6, { id: gestureId(3), reason: 'x' });

    expect(foreignMember.status).toBe(404);
    expect(crossPath.status).toBe(404);
    expect(ownMember.status).toBe(404);
    expect(
      (await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(1) } })).failedAt
    ).toBeNull();
    expect(
      (await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(6) } })).failedAt
    ).toBeNull();
  });
});
