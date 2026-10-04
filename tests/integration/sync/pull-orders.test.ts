import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const OWNER = '0199e006-0000-7000-8000-000000000001';
const MANAGER = '0199e006-0000-7000-8000-000000000002';
const SELLER = '0199e006-0000-7000-8000-000000000003';
const DRIVER = '0199e006-0000-7000-8000-000000000004';
const DRIVER_2 = '0199e006-0000-7000-8000-000000000005';
const CUSTOMER = '0199e006-0000-7000-8000-000000000006';
const OWNER_B = '0199e006-0000-7000-8000-000000000007';
const CUSTOMER_B = '0199e006-0000-7000-8000-000000000008';
const ORG_A = '0199e006-0000-7000-8000-0000000000a1';
const ORG_B = '0199e006-0000-7000-8000-0000000000b1';
const REL_A = '0199e006-0000-7000-8000-0000000000c1';
const REL_B = '0199e006-0000-7000-8000-0000000000c2';
const PRODUCT_A = '0199e006-0000-7000-8000-0000000000d1';
const PRODUCT_B = '0199e006-0000-7000-8000-0000000000d2';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const ORDER = {
  pending: '0199e006-0000-7000-8000-000000000201',
  confirmedAddress: '0199e006-0000-7000-8000-000000000202',
  confirmedNoAddress: '0199e006-0000-7000-8000-000000000203',
  inDelivery: '0199e006-0000-7000-8000-000000000204',
  deliveredRecent: '0199e006-0000-7000-8000-000000000205',
  deliveredOld: '0199e006-0000-7000-8000-000000000206',
  cancelledOld: '0199e006-0000-7000-8000-000000000207',
  otherDriverDelivered: '0199e006-0000-7000-8000-000000000208',
  orgB: '0199e006-0000-7000-8000-000000000209',
} as const;
const DELIVERY_OWN = '0199e006-0000-7000-8000-000000000301';
const DELIVERY_OTHER = '0199e006-0000-7000-8000-000000000302';
const DELIVERY_B = '0199e006-0000-7000-8000-000000000303';
const lineOf = (orderId: string) => `${orderId.slice(0, -3)}9${orderId.slice(-2)}`;

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/pull${query}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const idsOf = (rows: Rows) => rows.map((r) => r['id'] as string).sort();
const sorted = (ids: string[]) => [...ids].sort();

async function seedPerson(id: string, phone: string, name: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: name,
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${name.toLowerCase().replace(/\W/g, '')}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
}

async function seedCollaboration(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e006-0000-7000-8000-0000000001${suffix}`,
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
  data: {
    status: 'CONFIRMED' | 'PENDING' | 'IN_DELIVERY' | 'DELIVERED' | 'CANCELLED';
    address?: string;
    deliveredAt?: Date;
    deliveredById?: string;
    cancelledAt?: Date;
    placedBy?: 'SUPPLIER' | 'CUSTOMER';
  }
) {
  const cancelled = data.status === 'CANCELLED';
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      placedByParty: data.placedBy ?? (data.status === 'PENDING' ? 'CUSTOMER' : 'SUPPLIER'),
      enteredById: SELLER,
      totalAmount: 10000n,
      status: data.status,
      deliveryAddressApplied: data.address ?? null,
      deliveredAt: data.deliveredAt ?? null,
      deliveredById: data.deliveredById ?? null,
      cancelledAt: cancelled ? (data.cancelledAt ?? new Date()) : null,
      cancelledByParty: cancelled ? 'SUPPLIER' : null,
      cancelledById: cancelled ? OWNER : null,
      cancellationReason: cancelled ? 'no stock' : null,
      customerNote: 'note-client',
      supplierNote: 'note-fournisseur',
      syncIssue: 'issue-interne',
      createdAt: LONG_AGO,
    },
  });
  await prisma.orderLine.create({
    data: {
      id: lineOf(id),
      orderId: id,
      productId: relationshipId === REL_B ? PRODUCT_B : PRODUCT_A,
      labelApplied: 'Eau',
      quantity: 2,
      referencePrice: 5000n,
      unitPriceApplied: 5000n,
      amount: 10000n,
    },
  });
}

describe('GET /api/v1/sync/pull (orders, lines and deliveries)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600000601', 'Owner A');
    await seedPerson(MANAGER, '+237600000602', 'Manager A');
    await seedPerson(SELLER, '+237600000603', 'Seller A');
    await seedPerson(DRIVER, '+237600000604', 'Driver A');
    await seedPerson(DRIVER_2, '+237600000605', 'Driver Two');
    await seedPerson(CUSTOMER, '+237600000606', 'Customer');
    await seedPerson(OWNER_B, '+237600000607', 'Owner B');
    await seedPerson(CUSTOMER_B, '+237600000608', 'Customer B');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedCollaboration('01', OWNER, ORG_A, 'OWNER');
    await seedCollaboration('02', MANAGER, ORG_A, 'MANAGER');
    await seedCollaboration('03', SELLER, ORG_A, 'SELLER');
    await seedCollaboration('04', DRIVER, ORG_A, 'DRIVER');
    await seedCollaboration('05', DRIVER_2, ORG_A, 'DRIVER');
    await seedCollaboration('06', OWNER_B, ORG_B, 'OWNER');

    await prisma.customerRelationship.create({
      data: {
        id: REL_A,
        createdById: SELLER,
        createdAt: LONG_AGO,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        customerLabel: 'Chez Mama',
        creditLimit: 50000n,
        balance: 0n,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        id: REL_B,
        createdById: OWNER_B,
        createdAt: LONG_AGO,
        supplierOrganizationId: ORG_B,
        customerPersonId: CUSTOMER_B,
        customerLabel: 'Client B',
        creditLimit: 0n,
        balance: 0n,
      },
    });
    for (const [id, org] of [
      [PRODUCT_A, ORG_A],
      [PRODUCT_B, ORG_B],
    ]) {
      await prisma.product.create({
        data: { id, organizationId: org, name: 'Eau', unit: 'carton', price: 5000n },
      });
    }

    const recent = new Date(Date.now() - 5 * DAY);
    const old = new Date(Date.now() - 100 * DAY);
    await seedOrder(ORDER.pending, REL_A, { status: 'PENDING' });
    await seedOrder(ORDER.confirmedAddress, REL_A, { status: 'CONFIRMED', address: 'Rue 1' });
    await seedOrder(ORDER.confirmedNoAddress, REL_A, { status: 'CONFIRMED' });
    await seedOrder(ORDER.inDelivery, REL_A, { status: 'IN_DELIVERY', address: 'Rue 2' });
    await seedOrder(ORDER.deliveredRecent, REL_A, {
      status: 'DELIVERED',
      deliveredAt: recent,
      deliveredById: DRIVER,
    });
    await seedOrder(ORDER.deliveredOld, REL_A, {
      status: 'DELIVERED',
      deliveredAt: old,
      deliveredById: DRIVER,
    });
    await seedOrder(ORDER.cancelledOld, REL_A, { status: 'CANCELLED', cancelledAt: old });
    await seedOrder(ORDER.otherDriverDelivered, REL_A, {
      status: 'DELIVERED',
      deliveredAt: recent,
      deliveredById: DRIVER_2,
    });
    await seedOrder(ORDER.orgB, REL_B, { status: 'CONFIRMED', address: 'Rue B' });

    await prisma.delivery.create({
      data: { id: DELIVERY_OWN, orderId: ORDER.inDelivery, assignedToId: DRIVER },
    });
    await prisma.delivery.create({
      data: { id: DELIVERY_OTHER, orderId: ORDER.confirmedAddress, assignedToId: DRIVER_2 },
    });
    await prisma.delivery.create({
      data: { id: DELIVERY_B, orderId: ORDER.orgB, assignedToId: OWNER_B },
    });
  });

  it('seller: all open orders and recent closed ones of the organization, with lines (AC-1, CM-30)', async () => {
    const body = bodyOf<PullBody>(await pull(SELLER));

    const orders = body.changes['orders'].created;
    expect(idsOf(orders)).toEqual(
      sorted([
        ORDER.pending,
        ORDER.confirmedAddress,
        ORDER.confirmedNoAddress,
        ORDER.inDelivery,
        ORDER.deliveredRecent,
        ORDER.otherDriverDelivered,
      ])
    );
    expect(orders.find((o) => o['id'] === ORDER.pending)).toMatchObject({
      sync_issue: 'issue-interne',
      customer_note: 'note-client',
      entered_by_id: SELLER,
      total_amount: 10000,
    });
    expect(typeof orders[0]['server_updated_at']).toBe('number');
    expect(typeof orders[0]['created_at']).toBe('number');

    const lines = body.changes['order_lines'].created;
    expect(idsOf(lines)).toEqual(sorted(orders.map((o) => lineOf(o['id'] as string))));
    expect(lines[0]).not.toHaveProperty('price_set_by_id');
    expect(lines[0]).toMatchObject({ label_applied: 'Eau', amount: 10000 });
    expect(idsOf(body.changes['deliveries'].created)).toEqual(
      sorted([DELIVERY_OWN, DELIVERY_OTHER])
    );
  });

  it('owner and manager: the price author on lines, the seller never (AC-1, v5.0.0-8.2.3)', async () => {
    await prisma.orderLine.update({
      where: { id: lineOf(ORDER.confirmedAddress) },
      data: { unitPriceApplied: 4000n, amount: 8000n, priceSetById: OWNER, priceSetAt: new Date() },
    });
    for (const person of [OWNER, MANAGER]) {
      const lines = bodyOf<PullBody>(await pull(person)).changes['order_lines'].created;
      expect(lines.find((l) => l['id'] === lineOf(ORDER.confirmedAddress))).toMatchObject({
        price_set_by_id: OWNER,
      });
    }
    const sellerLines = bodyOf<PullBody>(await pull(SELLER)).changes['order_lines'].created;
    for (const line of sellerLines) expect(line).not.toHaveProperty('price_set_by_id');
  });

  it('driver: the pool, orders they delivered and their own deliveries, no PENDING order (AC-2, CM-30)', async () => {
    const body = bodyOf<PullBody>(await pull(DRIVER));

    const orders = body.changes['orders'].created;
    expect(idsOf(orders)).toEqual(
      sorted([ORDER.confirmedAddress, ORDER.inDelivery, ORDER.deliveredRecent])
    );
    for (const order of orders) {
      expect(order).not.toHaveProperty('sync_issue');
      expect(order).toHaveProperty('customer_note');
      expect(order).not.toHaveProperty('price_set_by_id');
    }
    expect(idsOf(body.changes['order_lines'].created)).toEqual(
      sorted(orders.map((o) => lineOf(o['id'] as string)))
    );
    expect(idsOf(body.changes['deliveries'].created)).toEqual([DELIVERY_OWN]);
  });

  it('customer: their orders in the customer view without sync_issue (AC-3)', async () => {
    const body = bodyOf<PullBody>(await pull(CUSTOMER));

    const orders = body.changes['orders'].created;
    expect(idsOf(orders)).toEqual(
      sorted([
        ORDER.pending,
        ORDER.confirmedAddress,
        ORDER.confirmedNoAddress,
        ORDER.inDelivery,
        ORDER.deliveredRecent,
        ORDER.otherDriverDelivered,
      ])
    );
    for (const order of orders) {
      expect(order).not.toHaveProperty('sync_issue');
      expect(order).not.toHaveProperty('entered_by_id');
      expect(order).not.toHaveProperty('delivered_by_id');
      expect(order).toHaveProperty('customer_note', 'note-client');
    }
    for (const line of body.changes['order_lines'].created) {
      expect(line).not.toHaveProperty('price_set_by_id');
    }
    expect(body.changes['deliveries'].created).toEqual([]);
  });

  it('lines: an updated order is sent with its lines (AC-4, C-35)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);
    await prisma.order.update({
      where: { id: ORDER.pending },
      data: { supplierNote: 'revu' },
    });

    const body = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${first.timestamp}`));

    expect(idsOf(body.changes['orders'].updated)).toEqual([ORDER.pending]);
    expect(body.changes['orders'].created).toEqual([]);
    expect(idsOf(body.changes['order_lines'].updated)).toEqual([lineOf(ORDER.pending)]);
  });

  it('lines: a deleted line is listed by id on an incremental pull (C-35)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);
    await prisma.orderLine.update({
      where: { id: lineOf(ORDER.inDelivery) },
      data: { deletedAt: new Date() },
    });

    const body = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${first.timestamp}`));

    expect(body.changes['order_lines'].deleted).toEqual([lineOf(ORDER.inDelivery)]);
    expect(body.changes['orders'].updated).toEqual([]);
  });

  it('a soft-deleted order is listed by id on an incremental pull, never on a first pull (C-35)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);
    await prisma.order.update({ where: { id: ORDER.pending }, data: { deletedAt: new Date() } });

    const body = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${first.timestamp}`));
    const fresh = bodyOf<PullBody>(await pull(SELLER));

    expect(body.changes['orders'].deleted).toEqual([ORDER.pending]);
    expect(idsOf(fresh.changes['orders'].created)).not.toContain(ORDER.pending);
    expect(fresh.changes['orders'].deleted).toEqual([]);
  });

  it('incremental: only the changed delivery is updated (AC-5)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);
    await prisma.delivery.update({
      where: { id: DELIVERY_OWN },
      data: { departedAt: new Date() },
    });

    const body = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${first.timestamp}`));

    expect(idsOf(body.changes['deliveries'].updated)).toEqual([DELIVERY_OWN]);
    expect(body.changes['deliveries'].created).toEqual([]);
    expect(body.changes['orders'].updated).toEqual([]);
    expect(body.changes['order_lines'].updated).toEqual([]);
    expect(typeof body.changes['deliveries'].updated[0]['departed_at']).toBe('number');
  });

  it('driver: someone else delivery changes are not sent (AC-5, CM-30)', async () => {
    const first = bodyOf<PullBody>(await pull(DRIVER));
    await sleep(20);
    await prisma.delivery.update({
      where: { id: DELIVERY_OTHER },
      data: { departedAt: new Date() },
    });

    const body = bodyOf<PullBody>(await pull(DRIVER, `?last_pulled_at=${first.timestamp}`));

    expect(body.changes['deliveries']).toEqual({ created: [], updated: [], deleted: [] });
  });

  it('other business: no order, line or delivery of B arrives (AB-1, WSTG-ATHZ-04)', async () => {
    for (const person of [OWNER, MANAGER, SELLER, DRIVER, CUSTOMER]) {
      const body = bodyOf<PullBody>(await pull(person));
      const everything = JSON.stringify(body.changes);
      expect(everything).not.toContain(ORDER.orgB);
      expect(everything).not.toContain(lineOf(ORDER.orgB));
      expect(everything).not.toContain(DELIVERY_B);
    }
    const ownerB = bodyOf<PullBody>(await pull(OWNER_B));
    expect(idsOf(ownerB.changes['orders'].created)).toEqual([ORDER.orgB]);
    expect(idsOf(ownerB.changes['deliveries'].created)).toEqual([DELIVERY_B]);
  });

  it('a customer of B and a driver of A see nothing of the other business (AB-1)', async () => {
    const body = bodyOf<PullBody>(await pull(CUSTOMER_B));
    expect(idsOf(body.changes['orders'].created)).toEqual([ORDER.orgB]);
    const stranger = bodyOf<PullBody>(await pull(DRIVER_2));
    expect(idsOf(stranger.changes['orders'].created)).not.toContain(ORDER.orgB);
  });
});
