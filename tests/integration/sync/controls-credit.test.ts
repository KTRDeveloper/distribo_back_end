import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const SELLER = '0199e017-0000-7000-8000-000000000001';
const OWNER_A = '0199e017-0000-7000-8000-000000000004';
const OWNER_B = '0199e017-0000-7000-8000-000000000005';
const CUSTOMER = '0199e017-0000-7000-8000-000000000006';
const ORG_A = '0199e017-0000-7000-8000-0000000000a1';
const ORG_B = '0199e017-0000-7000-8000-0000000000b1';
const REL = '0199e017-0000-7000-8000-0000000000c1';
const PRODUCT = '0199e017-0000-7000-8000-0000000000d1';
const ORDER = '0199e017-0000-7000-8000-000000000501';
const ORDER_2 = '0199e017-0000-7000-8000-000000000502';
const LINE = '0199e017-0000-7000-8000-000000000601';
const LINE_2 = '0199e017-0000-7000-8000-000000000602';
const DEVICE = '0199e017-0000-7000-8000-000000000701';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const DAY = 86_400_000;

type PushBody = {
  accepted: number;
  rejected: unknown[];
  aside: number;
};

const push = async (changes: unknown) =>
  createAuthenticatedRequest(app, SELLER, DEVICE)
    .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
    .send({ changes });

const table = (part: Partial<{ created: unknown[]; updated: unknown[]; deleted: string[] }>) => ({
  created: [],
  updated: [],
  deleted: [],
  ...part,
});

const newOrder = (id: string, lineId: string, createdAt: number) => ({
  orders: table({
    created: [
      {
        id,
        customer_relationship_id: REL,
        delivery_address_applied: 'Rue 1',
        delivery_cost: 0,
        desired_delivery_date: null,
        customer_note: null,
        created_at: createdAt,
      },
    ],
  }),
  order_lines: table({
    created: [
      {
        id: lineId,
        order_id: id,
        product_id: PRODUCT,
        quantity: '10',
        reference_price: 3000,
        unit_price_applied: 3000,
      },
    ],
  }),
});

const deliveredNow = (id: string) => ({
  orders: table({ updated: [{ id, status: 'DELIVERED' }] }),
});

const syncedAgo = (days: number) =>
  prisma.device.update({
    where: { id: DEVICE },
    data: { lastSyncedAt: new Date(Date.now() - days * DAY) },
  });

const storedOrder = (id = ORDER) => prisma.order.findUniqueOrThrow({ where: { id } });
const anomalies = (recipientId: string) =>
  prisma.notification.findMany({ where: { recipientId, sourceEvent: 'sync.anomalies' } });

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
}

async function seedMember(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e017-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

/** A CONFIRMED order of 10 sacks at 3000 (total 30000) for the seller to deliver. */
async function seedConfirmed(id: string, lineId: string) {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: REL,
      placedByParty: 'SUPPLIER',
      enteredById: OWNER_A,
      status: 'CONFIRMED',
      deliveryAddressApplied: 'Rue 1',
      deliveryCost: 0n,
      totalAmount: 30000n,
      createdAt: LONG_AGO,
      lines: {
        create: {
          id: lineId,
          productId: PRODUCT,
          labelApplied: 'Riz (sac)',
          quantity: '10',
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 30000n,
        },
      },
    },
  });
}

const setLimit = (creditLimit: bigint | null) =>
  prisma.customerRelationship.update({
    where: { id: REL },
    data: { creditLimit, creditLimitSetById: OWNER_A, creditLimitSetAt: new Date() },
  });

describe('controls on arrival: credit, restricted mode, long absence (SYNC-017)', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600001701', 'Sam Seller');
    await seedPerson(OWNER_A, '+237600001704', 'Olga Owner');
    await seedPerson(OWNER_B, '+237600001705', 'Otto Owner');
    await seedPerson(CUSTOMER, '+237600001706', 'Cora Customer', false);
    await prisma.device.create({
      data: { id: DEVICE, personId: SELLER, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('04', OWNER_A, ORG_A, 'OWNER');
    await seedMember('05', OWNER_B, ORG_B, 'OWNER');
    await seedMember('01', SELLER, ORG_A, 'SELLER');
    await prisma.product.create({
      data: { id: PRODUCT, organizationId: ORG_A, name: 'Riz', unit: 'sac', price: 3000n },
    });
    await prisma.customerRelationship.create({
      data: {
        id: REL,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        customerLabel: 'Chez Cora',
        createdById: OWNER_A,
        createdAt: LONG_AGO,
        status: 'ACTIVE',
        creditLimit: 15000n,
        deliveryAddress: 'Rue 1',
      },
    });
  });

  it('flags a delivery over the limit as CREDIT_EXCEEDED and records the delivery (AC-1, CM-15)', async () => {
    await seedConfirmed(ORDER, LINE);

    const response = await push(deliveredNow(ORDER));

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const order = await storedOrder();
    expect(order.status).toBe('DELIVERED');
    expect(order.syncIssue).toBe('CREDIT_EXCEEDED: Chez Cora : plafond dépassé de 15 000');
    const relationship = await prisma.customerRelationship.findUniqueOrThrow({
      where: { id: REL },
    });
    expect(relationship.balance).toBe(30000n);
  });

  it('flags an operation dated more than 3 days after the last sync as RESTRICTED_MODE (AC-2, CM-31)', async () => {
    await syncedAgo(6);
    const operation = Date.now() - 1 * DAY;

    const response = await push(newOrder(ORDER, LINE, operation));

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
    const order = await storedOrder();
    expect(order.syncIssue).toMatch(
      /^RESTRICTED_MODE: opération faite après 3 jours sans synchronisation/
    );
    expect(order.createdAt.getTime()).toBe(operation);
  });

  it('does not flag an operation dated exactly 3 days after the last sync (AC-2 boundary)', async () => {
    const last = Date.now() - 10 * DAY;
    await prisma.device.update({ where: { id: DEVICE }, data: { lastSyncedAt: new Date(last) } });

    await push(newOrder(ORDER, LINE, last + 3 * DAY));

    expect((await storedOrder()).syncIssue).toBeNull();
  });

  it('tells the owners once that the device came back after 6 days (AC-3)', async () => {
    await syncedAgo(6);

    const response = await push({});

    expect(response.status).toBe(200);
    const notes = await anomalies(OWNER_A);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ readStatus: 'UNREAD', organizationId: ORG_A });
    expect(notes[0].content).toBe("Sam Seller s'est resynchronisé après 6 jours");
    // Another organization's owner and the seller are not told.
    expect(await anomalies(OWNER_B)).toHaveLength(0);
    expect(await anomalies(SELLER)).toHaveLength(0);

    // The push moved last_synced_at forward: the next one is no long absence.
    await push({});
    expect(await anomalies(OWNER_A)).toHaveLength(1);
  });

  it('adds no line for a device that synced 3 days ago or less (AC-3 boundary)', async () => {
    await syncedAgo(2);

    await push({});

    expect(await prisma.notification.count()).toBe(0);
  });

  it('refuses nothing: every control together still answers 200 and stores everything (AC-4)', async () => {
    await seedConfirmed(ORDER, LINE);
    await syncedAgo(6);

    const response = await push({
      ...deliveredNow(ORDER),
      orders: table({
        updated: [{ id: ORDER, status: 'DELIVERED' }],
        created: newOrder(ORDER_2, LINE_2, Date.now() - 1 * DAY).orders.created,
      }),
      order_lines: newOrder(ORDER_2, LINE_2, Date.now() - 1 * DAY).order_lines,
    });

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    expect((await storedOrder(ORDER)).syncIssue).toMatch(/^CREDIT_EXCEEDED: /);
    expect((await storedOrder(ORDER_2)).syncIssue).toMatch(/^RESTRICTED_MODE: /);
    expect((await anomalies(OWNER_A)).some((note) => note.content.includes('après 6 jours'))).toBe(
      true
    );
  });

  it('sets no issue for a delivery within the limit and a recent sync (AC-5)', async () => {
    await setLimit(100000n);
    await seedConfirmed(ORDER, LINE);
    await syncedAgo(0.04);

    const response = await push(deliveredNow(ORDER));

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect((await storedOrder()).syncIssue).toBeNull();
    expect(await prisma.notification.count({ where: { sourceEvent: 'sync.anomalies' } })).toBe(0);
  });

  it('sets no credit issue when the customer has no limit (AC-5, CM-15)', async () => {
    await setLimit(null);
    await seedConfirmed(ORDER, LINE);

    await push(deliveredNow(ORDER));

    expect((await storedOrder()).syncIssue).toBeNull();
  });

  it('stores and flags operations a tampered phone dates late (AB-1, CWE-345)', async () => {
    await syncedAgo(40);
    // The phone claims an operation 30 days after its last sync, still in the past.
    const operation = Date.now() - 10 * DAY;

    const response = await push(newOrder(ORDER, LINE, operation));

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [] });
    const order = await storedOrder();
    expect(order.createdAt.getTime()).toBe(operation);
    expect(order.syncIssue).toMatch(/^RESTRICTED_MODE: /);
    expect((await anomalies(OWNER_A)).some((note) => note.content.includes('après 40 jours'))).toBe(
      true
    );
  });
});
