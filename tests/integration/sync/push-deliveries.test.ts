import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { RECEIPT_FIELDS } from '../../helpers/receipt-fields.js';
import { prisma } from '../../setup.js';

const SELLER = '0199e013-0000-7000-8000-000000000001';
const DRIVER = '0199e013-0000-7000-8000-000000000003';
const DRIVER_2 = '0199e013-0000-7000-8000-000000000004';
const OWNER_A = '0199e013-0000-7000-8000-000000000005';
const OWNER_B = '0199e013-0000-7000-8000-000000000006';
const CUSTOMER = '0199e013-0000-7000-8000-000000000007';
const ORG_A = '0199e013-0000-7000-8000-0000000000a1';
const ORG_B = '0199e013-0000-7000-8000-0000000000b1';
const REL = '0199e013-0000-7000-8000-0000000000c1';
const REL_OTHER = '0199e013-0000-7000-8000-0000000000c2';
const ORDER = '0199e013-0000-7000-8000-000000000501';
const ORDER_OTHER = '0199e013-0000-7000-8000-000000000502';
const DELIVERY = '0199e013-0000-7000-8000-000000000701';
const DELIVERY_2 = '0199e013-0000-7000-8000-000000000702';
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

const departure = (id = DELIVERY, extra: Record<string, unknown> = {}) => ({
  id,
  order_id: ORDER,
  departed_at: DEPARTED,
  ...extra,
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
    devices[id] = `0199e013-0000-7000-8000-0000000008${phone.slice(-2)}`;
    await prisma.device.create({
      data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
    });
  }
}

async function seedMember(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e013-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

async function seedOrder(
  id: string,
  relationshipId: string,
  status: 'CONFIRMED' | 'IN_DELIVERY' | 'DELIVERED' | 'CANCELLED',
  extra: Record<string, unknown> = {}
) {
  const closing =
    status === 'DELIVERED'
      ? {
          deliveredAt: new Date('2026-09-30T10:30:00.000Z'),
          deliveredById: DRIVER_2,
          ...RECEIPT_FIELDS,
        }
      : status === 'CANCELLED'
        ? {
            cancelledByParty: 'SUPPLIER' as const,
            cancelledById: OWNER_A,
            cancelledAt: LONG_AGO,
            cancellationReason: 'Erreur de saisie',
          }
        : {};
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      placedByParty: 'SUPPLIER',
      enteredById: OWNER_A,
      status,
      deliveryAddressApplied: 'Rue 1',
      deliveryCost: 0n,
      totalAmount: 0n,
      createdAt: LONG_AGO,
      ...closing,
      ...extra,
    },
  });
}

/** A delivery of ORDER by `driver`, left on the road (departed, not arrived, not failed). */
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

describe('push of deliveries and order status changes (SYNC-013)', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600001301', 'Sam Seller');
    await seedPerson(DRIVER, '+237600001303', 'Dora Driver');
    await seedPerson(DRIVER_2, '+237600001304', 'Denis Driver');
    await seedPerson(OWNER_A, '+237600001305', 'Olga Owner');
    await seedPerson(OWNER_B, '+237600001306', 'Otto Owner');
    await seedPerson(CUSTOMER, '+237600001307', 'Cora Customer', false);
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
    for (const [id, org] of [
      [REL, ORG_A],
      [REL_OTHER, ORG_B],
    ]) {
      await prisma.customerRelationship.create({
        data: {
          id,
          supplierOrganizationId: org,
          customerPersonId: CUSTOMER,
          createdById: OWNER_A,
          createdAt: LONG_AGO,
          deliveryAddress: 'Rue 1',
        },
      });
    }
  });

  it('stores the departure for the driver and puts the order in delivery (AC-1, CM-12)', async () => {
    await seedOrder(ORDER, REL, 'CONFIRMED');

    const response = await push(DRIVER, {
      deliveries: table({ created: [departure(DELIVERY, { assigned_to_id: DRIVER_2 })] }),
    });

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, rejected: [], aside: 0 });
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY } });
    expect(delivery).toMatchObject({
      orderId: ORDER,
      assignedToId: DRIVER,
      departedAt: new Date(DEPARTED),
      arrivedAt: null,
      failedAt: null,
      syncIssue: null,
    });
    expect((await storedOrder()).status).toBe('IN_DELIVERY');
  });

  it('stores a second departure closed and leaves the order to the first (AC-2, CM-23, C-36)', async () => {
    await seedOrder(ORDER, REL, 'IN_DELIVERY');
    await seedDelivery(DELIVERY, DRIVER_2);
    const before = Date.now();

    const response = await push(DRIVER, {
      deliveries: table({ created: [departure(DELIVERY_2)] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    const second = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY_2 } });
    expect(second.assignedToId).toBe(DRIVER);
    expect(second.failureReason).toBe('Livraison déjà prise par Denis Driver');
    expect(second.syncIssue).toBe('Livraison déjà prise par Denis Driver');
    expect(second.failedAt?.getTime()).toBeGreaterThanOrEqual(before);
    const first = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY } });
    expect(first).toMatchObject({ failedAt: null, arrivedAt: null, assignedToId: DRIVER_2 });
    expect((await storedOrder()).status).toBe('IN_DELIVERY');
  });

  it('puts the order back to CONFIRMED when the driver reports a failure (AC-3)', async () => {
    await seedOrder(ORDER, REL, 'IN_DELIVERY');
    await seedDelivery(DELIVERY, DRIVER);

    const response = await push(DRIVER, {
      deliveries: table({
        updated: [
          {
            id: DELIVERY,
            order_id: ORDER,
            failed_at: Date.parse('2026-09-30T09:00:00.000Z'),
            failure_reason: 'Client absent',
          },
        ],
      }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, rejected: [], aside: 0 });
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY } });
    expect(delivery.failedAt).toEqual(new Date('2026-09-30T09:00:00.000Z'));
    expect(delivery.failureReason).toBe('Client absent');
    expect((await storedOrder()).status).toBe('CONFIRMED');
  });

  it('stores a departure that already failed in the same push (AC-3)', async () => {
    await seedOrder(ORDER, REL, 'CONFIRMED');

    const response = await push(DRIVER, {
      deliveries: table({
        created: [
          departure(DELIVERY, {
            failed_at: Date.parse('2026-09-30T09:00:00.000Z'),
            failure_reason: 'Route coupée',
          }),
        ],
      }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY } });
    expect(delivery.failureReason).toBe('Route coupée');
    expect((await storedOrder()).status).toBe('CONFIRMED');
  });

  it('keeps a delivered order delivered and names who delivered and when (AC-4, CM-12)', async () => {
    await seedOrder(ORDER, REL, 'DELIVERED');

    const response = await push(SELLER, {
      orders: table({
        updated: [{ id: ORDER, status: 'CANCELLED', cancellation_reason: 'Client annulé' }],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const order = await storedOrder();
    expect(order).toMatchObject({
      status: 'DELIVERED',
      cancelledAt: null,
      cancellationReason: null,
    });
    expect(order.syncIssue).toBe(
      'Annulation impossible : commande livrée par Denis Driver à 2026-09-30 10:30 UTC'
    );
  });

  it('cancels a CONFIRMED order with its reason (AC-5)', async () => {
    await seedOrder(ORDER, REL, 'CONFIRMED');

    const response = await push(SELLER, {
      orders: table({
        updated: [{ id: ORDER, status: 'CANCELLED', cancellation_reason: 'Client annulé' }],
      }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, rejected: [], aside: 0 });
    expect(await storedOrder()).toMatchObject({
      status: 'CANCELLED',
      cancelledByParty: 'SUPPLIER',
      cancelledById: SELLER,
      cancellationReason: 'Client annulé',
      syncIssue: null,
    });
    expect((await storedOrder()).cancelledAt).not.toBeNull();
  });

  it('sets aside a supplier cancellation without a reason (AC-5)', async () => {
    await seedOrder(ORDER, REL, 'CONFIRMED');

    const response = await push(SELLER, {
      orders: table({ updated: [{ id: ORDER, status: 'CANCELLED' }] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 1 });
    expect((await storedOrder()).status).toBe('CONFIRMED');
  });

  it('flags a cancellation of an order already on the road and keeps its status (AC-4)', async () => {
    await seedOrder(ORDER, REL, 'IN_DELIVERY');

    const response = await push(SELLER, {
      orders: table({ updated: [{ id: ORDER, status: 'CANCELLED', cancellation_reason: 'x' }] }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const order = await storedOrder();
    expect(order.status).toBe('IN_DELIVERY');
    expect(order.syncIssue).toMatch(/^Annulation impossible/);
  });

  it('writes the supplier note whatever the status (AC-5)', async () => {
    await seedOrder(ORDER, REL, 'DELIVERED');

    const response = await push(SELLER, {
      orders: table({ updated: [{ id: ORDER, supplier_note: 'Rappeler le client' }] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, rejected: [], aside: 0 });
    expect(await storedOrder()).toMatchObject({
      status: 'DELIVERED',
      supplierNote: 'Rappeler le client',
    });
  });

  it('stores one delivery when the same departure is pushed twice (AC-6)', async () => {
    await seedOrder(ORDER, REL, 'CONFIRMED');
    const batch = { deliveries: table({ created: [departure()] }) };

    const first = await push(DRIVER, batch);
    const second = await push(DRIVER, batch);

    expect(bodyOf<PushBody>(first)).toMatchObject({ accepted: 1, rejected: [] });
    expect(bodyOf<PushBody>(second)).toMatchObject({ accepted: 1, rejected: [], aside: 0 });
    expect(await prisma.delivery.count()).toBe(1);
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY } });
    expect(delivery).toMatchObject({ failedAt: null, syncIssue: null });
    expect((await storedOrder()).status).toBe('IN_DELIVERY');
  });

  it.each(['DELIVERED', 'IN_DELIVERY', 'PENDING'])(
    'refuses a phone that pushes status %s directly and keeps the status (AB-1, WSTG-BUSL-06)',
    async (status) => {
      await seedOrder(ORDER, REL, 'CONFIRMED');

      const response = await push(SELLER, { orders: table({ updated: [{ id: ORDER, status }] }) });

      expect(response.status).toBe(200);
      expect(bodyOf<PushBody>(response).rejected).toEqual([]);
      const order = await storedOrder();
      expect(order).toMatchObject({ status: 'CONFIRMED', deliveredAt: null, deliveredById: null });
      expect(order.syncIssue).not.toBeNull();
    }
  );

  it('still applies the departure of an order whose edit ended as an issue in the same push (C-36)', async () => {
    await seedOrder(ORDER, REL, 'CONFIRMED');

    const response = await push(SELLER, {
      orders: table({ updated: [{ id: ORDER, status: 'DELIVERED' }] }),
      deliveries: table({ created: [departure()] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
    expect(await prisma.delivery.count()).toBe(1);
    expect((await storedOrder()).status).toBe('IN_DELIVERY');
  });

  it('forbids a driver to cancel an order (AB-2, WSTG-ATHZ-03)', async () => {
    await seedOrder(ORDER, REL, 'CONFIRMED');

    const response = await push(DRIVER, {
      orders: table({
        updated: [{ id: ORDER, status: 'CANCELLED', cancellation_reason: 'Je veux' }],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([
      expect.objectContaining({ table: 'orders', id: ORDER, code: 'FIELD_NOT_ALLOWED' }),
    ]);
    expect(await storedOrder()).toMatchObject({ status: 'CONFIRMED', cancelledAt: null });
  });

  it('does not let a driver fail the delivery of another driver (ASVS 8.2.1)', async () => {
    await seedOrder(ORDER, REL, 'IN_DELIVERY');
    await seedDelivery(DELIVERY, DRIVER_2);

    const response = await push(DRIVER, {
      deliveries: table({
        updated: [{ id: DELIVERY, failed_at: Date.now() - 1000, failure_reason: 'Tentative' }],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([
      expect.objectContaining({ table: 'deliveries', id: DELIVERY, code: 'OUT_OF_SCOPE' }),
    ]);
    expect(
      (await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY } })).failedAt
    ).toBeNull();
    expect((await storedOrder()).status).toBe('IN_DELIVERY');
  });

  it('refuses a departure on an order of another business and stores nothing (ASVS 8.2.2)', async () => {
    await seedOrder(ORDER_OTHER, REL_OTHER, 'CONFIRMED');

    const response = await push(DRIVER, {
      deliveries: table({ created: [{ ...departure(), order_id: ORDER_OTHER }] }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([
      expect.objectContaining({ table: 'deliveries', id: DELIVERY, code: 'OUT_OF_SCOPE' }),
    ]);
    expect(await prisma.delivery.count()).toBe(0);
    expect((await storedOrder(ORDER_OTHER)).status).toBe('CONFIRMED');
  });

  it('turns a departure on a cancelled order into an issue and stores no delivery (CM-12)', async () => {
    await seedOrder(ORDER, REL, 'CANCELLED');

    const response = await push(DRIVER, { deliveries: table({ created: [departure()] }) });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, rejected: [], aside: 0 });
    expect(await prisma.delivery.count()).toBe(0);
    const order = await storedOrder();
    expect(order.status).toBe('CANCELLED');
    expect(order.syncIssue).toMatch(/^Départ impossible/);
  });

  it('takes the assigned, not yet departed delivery over when the assigned driver leaves (CM-23)', async () => {
    await seedOrder(ORDER, REL, 'CONFIRMED');
    await prisma.delivery.create({ data: { id: DELIVERY, orderId: ORDER, assignedToId: DRIVER } });

    const response = await push(DRIVER, {
      deliveries: table({ created: [departure(DELIVERY_2)] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    const second = await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY_2 } });
    expect(second).toMatchObject({ failedAt: null, assignedToId: DRIVER });
    expect(
      (await prisma.delivery.findUniqueOrThrow({ where: { id: DELIVERY } })).deletedAt
    ).not.toBeNull();
    expect((await storedOrder()).status).toBe('IN_DELIVERY');
  });
});
