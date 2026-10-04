import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0d4-0000-7000-8000-000000000001';
const MANAGER = '0199c0d4-0000-7000-8000-000000000002';
const SELLER = '0199c0d4-0000-7000-8000-000000000003';
const DRIVER_1 = '0199c0d4-0000-7000-8000-000000000004';
const DRIVER_2 = '0199c0d4-0000-7000-8000-000000000005';
const CUSTOMER = '0199c0d4-0000-7000-8000-000000000006';
const OTHER_OWNER = '0199c0d4-0000-7000-8000-000000000007';
const OTHER_DRIVER = '0199c0d4-0000-7000-8000-000000000008';
const PENDING_DRIVER = '0199c0d4-0000-7000-8000-000000000009';

const SUPPLIER = '0199c0d4-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c0d4-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c0d4-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c0d4-0000-7000-8000-0000000000b2';
const REL = '0199c0d4-0000-7000-8000-0000000000e1';
const OTHER_REL = '0199c0d4-0000-7000-8000-0000000000e2';

const REG = new Date('2026-01-01T00:00:00.000Z');

const orderId = (n: number) => `0199c0d4-0000-7000-8000-0000000001${n}0`;
const lineId = (n: number) => `0199c0d4-0000-7000-8000-0000000002${n}0`;
const existingDeliveryId = (n: number) => `0199c0d4-0000-7000-8000-0000000003${n}0`;
const gestureId = (n: number) => `0199c0d4-0000-7000-8000-0000000005${n}0`;

type DepartBody = {
  delivery: { id: string; order_id: string; assigned_to_id: string; departed_at: string | null };
  order_status: string;
};

async function seedPerson(id: string, phone: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      ...(registered
        ? { phoneVerifiedAt: REG, passwordHash: 'test-password-hash', registeredAt: REG }
        : {}),
    },
  });
}

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  n: number,
  status: 'ACTIVE' | 'INVITED' = 'ACTIVE'
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c0d4-0000-7000-8000-0000000004${n}f`,
      personId,
      organizationId: orgId,
      role,
      status,
      ...(status === 'ACTIVE' ? { acceptedAt: REG } : {}),
    },
  });
}

async function seedOrder(
  n: number,
  options: {
    status?: 'PENDING' | 'CONFIRMED' | 'IN_DELIVERY' | 'DELIVERED' | 'CANCELLED';
    address?: string | null;
    relationshipId?: string;
  } = {}
) {
  const status = options.status ?? 'CONFIRMED';
  await prisma.order.create({
    data: {
      id: orderId(n),
      customerRelationshipId: options.relationshipId ?? REL,
      enteredById: SELLER,
      placedByParty: status === 'PENDING' ? 'CUSTOMER' : 'SUPPLIER',
      ...(status === 'DELIVERED' ? { deliveredAt: REG, deliveredById: DRIVER_1 } : {}),
      ...(status === 'CANCELLED'
        ? {
            cancelledByParty: 'SUPPLIER' as const,
            cancelledById: MANAGER,
            cancelledAt: REG,
            cancellationReason: 'Out of stock',
          }
        : {}),
      status,
      deliveryAddressApplied: 'address' in options ? options.address : `Street ${n}`,
      deliveryCost: 0n,
      totalAmount: 3000n,
      createdAt: new Date(Date.UTC(2026, 5, n)),
      lines: {
        create: {
          id: lineId(n),
          productId: options.relationshipId === OTHER_REL ? OTHER_PRODUCT : PRODUCT,
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

async function seedDelivery(n: number, orderNumber: number, driverId: string, departed = false) {
  await prisma.delivery.create({
    data: {
      id: existingDeliveryId(n),
      orderId: orderId(orderNumber),
      assignedToId: driverId,
      departedAt: departed ? new Date(Date.UTC(2026, 6, 1, 8)) : null,
    },
  });
}

function depart(
  personId: string,
  order: number,
  body: Record<string, unknown>,
  organizationId = SUPPLIER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/orders/${orderId(order)}/depart`)
    .send(body);
}

/**
 * Supplier with an owner, a manager, a seller and two drivers; order 1 is CONFIRMED with an
 * address, order 2 has no address, order 3 is PENDING, order 4 is IN_DELIVERY, order 5 belongs to
 * another business. A driver of another organization and a pending collaborator exist too.
 */
async function seedBase() {
  await seedPerson(OWNER, '+237600084001');
  await seedPerson(MANAGER, '+237600084002');
  await seedPerson(SELLER, '+237600084003');
  await seedPerson(DRIVER_1, '+237600084004');
  await seedPerson(DRIVER_2, '+237600084005');
  await seedPerson(CUSTOMER, '+237600084006');
  await seedPerson(OTHER_OWNER, '+237600084007');
  await seedPerson(OTHER_DRIVER, '+237600084008');
  await seedPerson(PENDING_DRIVER, '+237600084009');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, MANAGER, 'MANAGER', 2);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER_1, 'DRIVER', 4);
  await seedMember(SUPPLIER, DRIVER_2, 'DRIVER', 5);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 6);
  await seedMember(OTHER_ORG, OTHER_DRIVER, 'DRIVER', 7);
  await seedMember(SUPPLIER, PENDING_DRIVER, 'DRIVER', 8, 'INVITED');
  await prisma.product.create({
    data: { id: PRODUCT, organizationId: SUPPLIER, name: 'Rice', unit: 'sack', price: 1500n },
  });
  await prisma.product.create({
    data: { id: OTHER_PRODUCT, organizationId: OTHER_ORG, name: 'Oil', unit: 'l', price: 900n },
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
  await seedOrder(1);
  await seedOrder(2, { address: null });
  await seedOrder(3, { status: 'PENDING' });
  await seedOrder(4, { status: 'IN_DELIVERY' });
  await seedOrder(5, { relationshipId: OTHER_REL });
  await seedOrder(6, { status: 'DELIVERED' });
  await seedOrder(7, { status: 'CANCELLED' });
}

describe('DLV-005 driver departs with an order', () => {
  beforeEach(seedBase);

  it('creates a departed delivery for the caller and puts the order in delivery (AC-1, CM-12)', async () => {
    const response = await depart(DRIVER_1, 1, { id: gestureId(1) });

    expect(response.status).toBe(200);
    const body = bodyOf<DepartBody>(response);
    expect(body.order_status).toBe('IN_DELIVERY');
    expect(body.delivery).toMatchObject({
      id: gestureId(1),
      order_id: orderId(1),
      assigned_to_id: DRIVER_1,
    });
    expect(body.delivery.departed_at).not.toBeNull();
    const rows = await prisma.delivery.findMany({ where: { orderId: orderId(1) } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.departedAt).not.toBeNull();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId(1) } });
    expect(order.status).toBe('IN_DELIVERY');
  });

  it('notifies the customer order.status_changed', async () => {
    await depart(DRIVER_1, 1, { id: gestureId(1) });

    const notifications = await prisma.notification.findMany({ where: { recipientId: CUSTOMER } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      sourceEvent: 'order.status_changed',
      organizationId: SUPPLIER,
    });
  });

  it('gives departed_at to the same delivery row when the order was assigned to the caller (AC-2)', async () => {
    await seedDelivery(1, 1, DRIVER_1);

    const response = await depart(DRIVER_1, 1, { id: gestureId(1) });

    expect(response.status).toBe(200);
    expect(bodyOf<DepartBody>(response).delivery.id).toBe(existingDeliveryId(1));
    const rows = await prisma.delivery.findMany({ where: { orderId: orderId(1) } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: existingDeliveryId(1), assignedToId: DRIVER_1 });
    expect(rows[0]?.departedAt).not.toBeNull();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId(1) } })).status).toBe(
      'IN_DELIVERY'
    );
  });

  it.each([
    ['a MANAGER', MANAGER],
    ['an OWNER', OWNER],
  ])('lets %s depart with an order assigned to another driver', async (_label, caller) => {
    await seedDelivery(1, 1, DRIVER_2);

    const response = await depart(caller, 1, { id: gestureId(1) });

    expect(response.status).toBe(200);
    expect(await prisma.delivery.count({ where: { orderId: orderId(1) } })).toBe(1);
    const row = await prisma.delivery.findUniqueOrThrow({ where: { id: existingDeliveryId(1) } });
    expect(row.assignedToId).toBe(caller);
    expect(row.departedAt).not.toBeNull();
  });

  it('departs with an order whose earlier delivery failed (new delivery)', async () => {
    await prisma.delivery.create({
      data: {
        id: existingDeliveryId(1),
        orderId: orderId(1),
        assignedToId: DRIVER_2,
        departedAt: REG,
        failedAt: REG,
        failureReason: 'Customer absent',
      },
    });

    const response = await depart(DRIVER_1, 1, { id: gestureId(1) });

    expect(response.status).toBe(200);
    expect(await prisma.delivery.count({ where: { orderId: orderId(1) } })).toBe(2);
  });

  describe('refusals (AC-3)', () => {
    async function expectNothingChanged(order: number, status: string, deliveries = 0) {
      const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId(order) } });
      expect(row.status).toBe(status);
      expect(await prisma.delivery.count()).toBe(deliveries);
      expect(await prisma.notification.count()).toBe(0);
    }

    it('answers 409 ASSIGNED_TO_OTHER for an order assigned to another driver', async () => {
      await seedDelivery(1, 1, DRIVER_2);

      const response = await depart(DRIVER_1, 1, { id: gestureId(1) });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ASSIGNED_TO_OTHER');
      const row = await prisma.delivery.findUniqueOrThrow({ where: { id: existingDeliveryId(1) } });
      expect(row).toMatchObject({ assignedToId: DRIVER_2, departedAt: null });
      await expectNothingChanged(1, 'CONFIRMED', 1);
    });

    it('answers 409 DELIVERY_IN_PROGRESS for an order already IN_DELIVERY', async () => {
      const response = await depart(DRIVER_1, 4, { id: gestureId(1) });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('DELIVERY_IN_PROGRESS');
      await expectNothingChanged(4, 'IN_DELIVERY');
    });

    it.each([
      ['PENDING', 3, 'PENDING'],
      ['DELIVERED', 6, 'DELIVERED'],
      ['CANCELLED', 7, 'CANCELLED'],
    ])('answers 409 INVALID_TRANSITION for a %s order', async (_label, n, status) => {
      const response = await depart(DRIVER_1, n, { id: gestureId(1) });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TRANSITION');
      await expectNothingChanged(n, status);
    });

    it('answers 400 VALIDATION_ERROR for an order without an address', async () => {
      const response = await depart(DRIVER_1, 2, { id: gestureId(1) });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      await expectNothingChanged(2, 'CONFIRMED');
    });

    it('answers 404 NOT_FOUND for an unknown order', async () => {
      const response = await depart(DRIVER_1, 9, { id: gestureId(1) });

      expect(response.status).toBe(404);
    });

    it.each([
      ['an unknown field', { id: gestureId(1), assigned_to_id: OWNER }],
      ['a missing id', {}],
      ['a malformed id', { id: 'nope' }],
    ])('answers 400 VALIDATION_ERROR for %s', async (_label, body) => {
      const response = await depart(DRIVER_1, 1, body);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      await expectNothingChanged(1, 'CONFIRMED');
    });

    it('answers 401 without a token', async () => {
      const { default: request } = await import('supertest');
      const response = await request(app)
        .post(`/api/v1/organizations/${SUPPLIER}/orders/${orderId(1)}/depart`)
        .send({ id: gestureId(1) });

      expect(response.status).toBe(401);
    });
  });

  it('lets exactly one of two drivers depart at once (AC-4, C-21, CWE-362)', async () => {
    const [first, second] = await Promise.all([
      depart(DRIVER_1, 1, { id: gestureId(1) }),
      depart(DRIVER_2, 1, { id: gestureId(2) }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(bodyOf<ErrorBody>(loser).error.code).toBe('DELIVERY_IN_PROGRESS');
    expect(await prisma.delivery.count({ where: { orderId: orderId(1) } })).toBe(1);
    expect(await prisma.notification.count({ where: { recipientId: CUSTOMER } })).toBe(1);
  });

  it('creates one delivery when the same id is posted twice (AC-5)', async () => {
    const first = await depart(DRIVER_1, 1, { id: gestureId(1) });
    const second = await depart(DRIVER_1, 1, { id: gestureId(1) });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await prisma.delivery.count()).toBe(1);
    expect(await prisma.notification.count({ where: { recipientId: CUSTOMER } })).toBe(1);
  });

  it('refuses a second driver with an order already on the road and keeps the first delivery (AB-1, WSTG-BUSL-06)', async () => {
    const first = await depart(DRIVER_1, 1, { id: gestureId(1) });
    const before = await prisma.delivery.findUniqueOrThrow({ where: { id: gestureId(1) } });

    const second = await depart(DRIVER_2, 1, { id: gestureId(2) });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await prisma.delivery.count()).toBe(1);
    const after = await prisma.delivery.findUniqueOrThrow({ where: { id: gestureId(1) } });
    expect(after).toEqual(before);
    expect(after.assignedToId).toBe(DRIVER_1);
  });

  it('answers 404 to a member of another business and changes nothing (AB-2, WSTG-ATHZ-04)', async () => {
    const foreignMember = await depart(OTHER_DRIVER, 1, { id: gestureId(1) }, SUPPLIER);
    const foreignOrder = await depart(DRIVER_1, 5, { id: gestureId(2) });
    const ownOrg = await depart(OTHER_DRIVER, 5, { id: gestureId(3) }, OTHER_ORG);
    const crossPath = await depart(OTHER_DRIVER, 1, { id: gestureId(4) }, OTHER_ORG);

    expect(foreignMember.status).toBe(404);
    expect(foreignOrder.status).toBe(404);
    expect(ownOrg.status).toBe(200);
    expect(crossPath.status).toBe(404);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId(1) } })).status).toBe(
      'CONFIRMED'
    );
    expect(await prisma.delivery.count({ where: { orderId: orderId(1) } })).toBe(0);
  });
});
