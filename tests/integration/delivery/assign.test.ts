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

type DeliveryBody = {
  id: string;
  order_id: string;
  assigned_to_id: string;
  departed_at: string | null;
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
    status?: 'PENDING' | 'CONFIRMED' | 'IN_DELIVERY';
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

function assign(
  personId: string,
  order: number,
  body: Record<string, unknown>,
  organizationId = SUPPLIER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/orders/${orderId(order)}/assign`)
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
  await seedOrder(1);
  await seedOrder(2, { address: null });
  await seedOrder(3, { status: 'PENDING' });
  await seedOrder(4, { status: 'IN_DELIVERY' });
  await seedOrder(5, { relationshipId: OTHER_REL });
}

describe('DLV-004 manager assigns an order to a driver', () => {
  beforeEach(seedBase);

  it('assigns a CONFIRMED order with an address and notifies the driver (AC-1, C-21)', async () => {
    const response = await assign(MANAGER, 1, { id: gestureId(1), driver_person_id: DRIVER_1 });

    expect(response.status).toBe(201);
    expect(bodyOf<DeliveryBody>(response)).toEqual({
      id: gestureId(1),
      order_id: orderId(1),
      assigned_to_id: DRIVER_1,
      departed_at: null,
    });
    const rows = await prisma.delivery.findMany({ where: { orderId: orderId(1) } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ assignedToId: DRIVER_1, departedAt: null });
    const notifications = await prisma.notification.findMany({
      where: { recipientId: DRIVER_1 },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      sourceEvent: 'delivery.assigned',
      organizationId: SUPPLIER,
    });
  });

  it('lets an OWNER assign too (role MANAGER and above)', async () => {
    const response = await assign(OWNER, 1, { id: gestureId(1), driver_person_id: DRIVER_1 });

    expect(response.status).toBe(201);
  });

  it('lets a MANAGER assign an order to a collaborator of any role (driver or above)', async () => {
    const response = await assign(MANAGER, 1, { id: gestureId(1), driver_person_id: SELLER });

    expect(response.status).toBe(201);
  });

  it('reassigns the same delivery row to another driver before departure (AC-2)', async () => {
    await assign(MANAGER, 1, { id: gestureId(1), driver_person_id: DRIVER_1 });

    const response = await assign(MANAGER, 1, { id: gestureId(2), driver_person_id: DRIVER_2 });

    expect(response.status).toBe(201);
    expect(bodyOf<DeliveryBody>(response)).toMatchObject({
      id: gestureId(1),
      assigned_to_id: DRIVER_2,
      departed_at: null,
    });
    const rows = await prisma.delivery.findMany({ where: { orderId: orderId(1) } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: gestureId(1), assignedToId: DRIVER_2 });
    expect(await prisma.notification.count({ where: { recipientId: DRIVER_2 } })).toBe(1);
  });

  describe('refusals (AC-3)', () => {
    async function expectNothingChanged() {
      expect(await prisma.notification.count({ where: { sourceEvent: 'delivery.assigned' } })).toBe(
        0
      );
    }

    it('answers 409 DELIVERY_IN_PROGRESS for a delivery already departed', async () => {
      await seedDelivery(1, 1, DRIVER_1, true);

      const response = await assign(MANAGER, 1, {
        id: gestureId(1),
        driver_person_id: DRIVER_2,
      });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('DELIVERY_IN_PROGRESS');
      const row = await prisma.delivery.findUniqueOrThrow({ where: { id: existingDeliveryId(1) } });
      expect(row.assignedToId).toBe(DRIVER_1);
      expect(await prisma.delivery.count()).toBe(1);
      await expectNothingChanged();
    });

    it('answers 400 VALIDATION_ERROR for an order without a delivery address', async () => {
      const response = await assign(MANAGER, 2, {
        id: gestureId(1),
        driver_person_id: DRIVER_1,
      });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.delivery.count()).toBe(0);
      await expectNothingChanged();
    });

    it.each([
      ['PENDING', 3],
      ['IN_DELIVERY', 4],
    ])('answers 409 INVALID_TRANSITION for a %s order', async (_status, n) => {
      const response = await assign(MANAGER, n, {
        id: gestureId(1),
        driver_person_id: DRIVER_1,
      });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('INVALID_TRANSITION');
      expect(await prisma.delivery.count()).toBe(0);
      await expectNothingChanged();
    });

    it.each([
      ['a driver of another organization', OTHER_DRIVER],
      ['a collaborator who has not accepted', PENDING_DRIVER],
      ['a person who is no collaborator', CUSTOMER],
      ['an unknown person', '0199c0d4-0000-7000-8000-0000000009ff'],
    ])('answers 404 NOT_FOUND for %s', async (_label, driver) => {
      const response = await assign(MANAGER, 1, { id: gestureId(1), driver_person_id: driver });

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await prisma.delivery.count()).toBe(0);
      await expectNothingChanged();
    });

    it('answers 404 NOT_FOUND for a former collaborator (revoked)', async () => {
      await prisma.collaboration.updateMany({
        where: { personId: DRIVER_1, organizationId: SUPPLIER },
        data: { status: 'REVOKED' },
      });

      const response = await assign(MANAGER, 1, {
        id: gestureId(1),
        driver_person_id: DRIVER_1,
      });

      expect(response.status).toBe(404);
      expect(await prisma.delivery.count()).toBe(0);
    });

    it('answers 404 NOT_FOUND for an order of another business or an unknown order', async () => {
      const other = await assign(MANAGER, 5, { id: gestureId(1), driver_person_id: DRIVER_1 });
      const unknown = await assign(MANAGER, 9, { id: gestureId(2), driver_person_id: DRIVER_1 });

      expect(other.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(await prisma.delivery.count()).toBe(0);
    });

    it.each([
      ['a SELLER', SELLER],
      ['a DRIVER', DRIVER_1],
    ])('answers 403 FORBIDDEN for %s', async (_label, caller) => {
      const response = await assign(caller, 1, {
        id: gestureId(1),
        driver_person_id: DRIVER_2,
      });

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
      expect(await prisma.delivery.count()).toBe(0);
      await expectNothingChanged();
    });

    it('answers 404 to a member of another organization (never confirms the order)', async () => {
      const response = await assign(OTHER_OWNER, 1, {
        id: gestureId(1),
        driver_person_id: OTHER_DRIVER,
      });

      expect(response.status).toBe(404);
      expect(await prisma.delivery.count()).toBe(0);
    });

    it.each([
      ['an unknown field', { id: gestureId(1), driver_person_id: DRIVER_1, assigned_to_id: OWNER }],
      ['a missing driver', { id: gestureId(1) }],
      ['a malformed driver id', { id: gestureId(1), driver_person_id: 'nope' }],
      ['a missing id', { driver_person_id: DRIVER_1 }],
    ])('answers 400 VALIDATION_ERROR for %s', async (_label, body) => {
      const response = await assign(MANAGER, 1, body);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.delivery.count()).toBe(0);
    });
  });

  it('creates one delivery when the same id is posted twice (AC-4)', async () => {
    const body = { id: gestureId(1), driver_person_id: DRIVER_1 };

    const first = await assign(MANAGER, 1, body);
    const second = await assign(MANAGER, 1, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.delivery.count()).toBe(1);
    expect(await prisma.notification.count({ where: { recipientId: DRIVER_1 } })).toBe(1);
  });

  it('assigns a new delivery after a failed one (one delivery per attempt)', async () => {
    await prisma.delivery.create({
      data: {
        id: existingDeliveryId(1),
        orderId: orderId(1),
        assignedToId: DRIVER_1,
        departedAt: REG,
        failedAt: REG,
        failureReason: 'Customer absent',
      },
    });

    const response = await assign(MANAGER, 1, { id: gestureId(1), driver_person_id: DRIVER_2 });

    expect(response.status).toBe(201);
    expect(bodyOf<DeliveryBody>(response).id).toBe(gestureId(1));
    expect(await prisma.delivery.count({ where: { orderId: orderId(1) } })).toBe(2);
  });

  it('a driver cannot assign orders to themselves (AB-1, WSTG-ATHZ-03)', async () => {
    const response = await assign(DRIVER_1, 1, { id: gestureId(1), driver_person_id: DRIVER_1 });

    expect(response.status).toBe(403);
    expect(await prisma.delivery.count()).toBe(0);
  });

  it('answers 401 without a token', async () => {
    const { default: request } = await import('supertest');
    const response = await request(app)
      .post(`/api/v1/organizations/${SUPPLIER}/orders/${orderId(1)}/assign`)
      .send({ id: gestureId(1), driver_person_id: DRIVER_1 });

    expect(response.status).toBe(401);
  });
});
