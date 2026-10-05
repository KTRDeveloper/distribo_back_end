import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { customerRelationshipsAdapter } from '../../../src/modules/sync/adapters/relationship.adapter.js';
import {
  deliveriesAdapter,
  orderLinesAdapter,
  ordersAdapter,
} from '../../../src/modules/sync/adapters/order.adapter.js';
import {
  ledgerEntriesAdapter,
  notificationsAdapter,
} from '../../../src/modules/sync/adapters/money.adapter.js';
import { JUDGE_TABLE_ORDER, stripComputed } from '../../../src/modules/sync/sync.judge.js';
import type { SyncAdapter, TableChange } from '../../../src/modules/sync/sync.types.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const SELLER = '0199e010-0000-7000-8000-000000000001';
const DRIVER = '0199e010-0000-7000-8000-000000000002';
const OWNER_B = '0199e010-0000-7000-8000-000000000003';
const OWNER_A = '0199e010-0000-7000-8000-000000000004';
const MANAGER = '0199e010-0000-7000-8000-000000000005';
const CUSTOMER = '0199e010-0000-7000-8000-000000000006';
const ORG_A = '0199e010-0000-7000-8000-0000000000a1';
const ORG_B = '0199e010-0000-7000-8000-0000000000b1';
const REL_A = '0199e010-0000-7000-8000-0000000000c1';
const REL_B = '0199e010-0000-7000-8000-0000000000c2';
const PRODUCT_A = '0199e010-0000-7000-8000-0000000000d1';
const PRODUCT_B = '0199e010-0000-7000-8000-0000000000d2';
const ORDER_A = '0199e010-0000-7000-8000-000000000201';
const ORDER_B = '0199e010-0000-7000-8000-000000000202';
const LINE_A = '0199e010-0000-7000-8000-000000000301';
const LINE_B = '0199e010-0000-7000-8000-000000000302';
const NEW_ORDER = '0199e010-0000-7000-8000-000000000401';
const NEW_ORDER_2 = '0199e010-0000-7000-8000-000000000402';
const UNKNOWN_ID = '0199e010-0000-7000-8000-000000000999';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
};

const devices: Record<string, string> = {};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const push = (personId: string, changes: unknown) =>
  createAuthenticatedRequest(app, personId, devices[personId])
    .post(`/api/v1/sync/push?last_pulled_at=${Date.now()}`)
    .send({ changes });

const table = (part: Partial<{ created: unknown[]; updated: unknown[]; deleted: string[] }>) => ({
  created: [],
  updated: [],
  deleted: [],
  ...part,
});

/** Replaces an adapter's push with one that accepts every line it receives and records the call. */
function acceptAll(adapter: SyncAdapter, calls: TableChange[] = []) {
  return vi.spyOn(adapter, 'push').mockImplementation((_ctx, change) => {
    calls.push(change);
    const ids = [...change.created, ...change.updated]
      .map((row) => String(row['id']))
      .concat(change.deleted);
    return Promise.resolve(
      ids.map((id) => ({ table: change.table, id, kind: 'accepted' as const }))
    );
  });
}

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Judge Person',
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${phone.slice(1)}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
  devices[id] = `0199e010-0000-7000-8000-0000000007${phone.slice(-2)}`;
  await prisma.device.create({
    data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
  });
}

async function seedMember(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e010-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

async function seedOrder(id: string, lineId: string, relationshipId: string, productId: string) {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      placedByParty: 'SUPPLIER',
      enteredById: SELLER,
      totalAmount: 10000n,
      status: 'CONFIRMED',
      supplierNote: 'note',
      createdAt: LONG_AGO,
      lines: {
        create: {
          id: lineId,
          productId,
          labelApplied: 'Eau',
          quantity: 2,
          referencePrice: 5000n,
          unitPriceApplied: 5000n,
          amount: 10000n,
        },
      },
    },
  });
}

describe('sync judge pipeline', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600001001');
    await seedPerson(DRIVER, '+237600001002');
    await seedPerson(OWNER_B, '+237600001003');
    await seedPerson(OWNER_A, '+237600001004');
    await seedPerson(MANAGER, '+237600001005');
    await seedPerson(CUSTOMER, '+237600001006');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id: id, name: name, createdAt: LONG_AGO } });
    }
    // An organization needs its single ACTIVE OWNER as soon as it has a collaboration.
    await seedMember('04', OWNER_A, ORG_A, 'OWNER');
    await seedMember('03', OWNER_B, ORG_B, 'OWNER');
    await seedMember('01', SELLER, ORG_A, 'SELLER');
    await seedMember('02', DRIVER, ORG_A, 'DRIVER');
    await seedMember('05', MANAGER, ORG_A, 'MANAGER');
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
        data: { id: id, organizationId: org, name: 'Eau', unit: 'carton', price: 5000n },
      });
    }
    await seedOrder(ORDER_A, LINE_A, REL_A, PRODUCT_A);
    await seedOrder(ORDER_B, LINE_B, REL_B, PRODUCT_B);
    await sleep(5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forbids a line of another organization with OUT_OF_SCOPE and changes nothing there (AC-1)', async () => {
    const calls: TableChange[] = [];
    acceptAll(ordersAdapter, calls);

    const response = await push(SELLER, {
      orders: table({ created: [{ id: NEW_ORDER, customer_relationship_id: REL_B }] }),
    });

    expect(response.status).toBe(200);
    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(0);
    expect(body.rejected).toEqual([
      expect.objectContaining({ table: 'orders', id: NEW_ORDER, code: 'OUT_OF_SCOPE' }),
    ]);
    expect(calls.flatMap((c) => c.created)).toEqual([]);
    expect(await prisma.order.count({ where: { customerRelationshipId: REL_B } })).toBe(1);
  });

  it('forbids a new credit_limit from a SELLER with FIELD_NOT_ALLOWED and keeps the limit (AC-2)', async () => {
    const calls: TableChange[] = [];
    acceptAll(customerRelationshipsAdapter, calls);

    const response = await push(SELLER, {
      customer_relationships: table({ updated: [{ id: REL_A, credit_limit: 1_000_000 }] }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([
      expect.objectContaining({
        table: 'customer_relationships',
        id: REL_A,
        code: 'FIELD_NOT_ALLOWED',
      }),
    ]);
    expect(calls.flatMap((c) => c.updated)).toEqual([]);
    const stored = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: REL_A } });
    expect(stored.creditLimit).toBe(50000n);
  });

  it('removes computed fields before the adapter and leaves the server values (AC-3, CM-27)', async () => {
    const calls: TableChange[] = [];
    acceptAll(customerRelationshipsAdapter, calls);

    const response = await push(SELLER, {
      customer_relationships: table({
        updated: [
          { id: REL_A, customer_label: 'Renamed', balance: 999999, server_updated_at: 1000 },
        ],
      }),
    });

    expect(bodyOf<PushBody>(response).accepted).toBe(1);
    const received = calls.flatMap((c) => c.updated);
    expect(received).toEqual([{ id: REL_A, customer_label: 'Renamed' }]);
    const stored = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: REL_A } });
    expect(stored.balance).toBe(0n);
    expect(stored.serverUpdatedAt.getTime()).toBeGreaterThan(1000);
  });

  it('takes the author of a create from the session (AC-4)', async () => {
    const calls: TableChange[] = [];
    acceptAll(ordersAdapter, calls);

    await push(SELLER, {
      orders: table({
        created: [{ id: NEW_ORDER, customer_relationship_id: REL_A, entered_by_id: OWNER_B }],
      }),
    });

    expect(calls.flatMap((c) => c.created)).toEqual([
      expect.objectContaining({ id: NEW_ORDER, entered_by_id: SELLER }),
    ]);
  });

  it('judges tables in the fixed order, parents before children (AC-5)', async () => {
    const order: string[] = [];
    for (const adapter of [
      customerRelationshipsAdapter,
      ordersAdapter,
      orderLinesAdapter,
      deliveriesAdapter,
      ledgerEntriesAdapter,
      notificationsAdapter,
    ]) {
      vi.spyOn(adapter, 'push').mockImplementation((_ctx, change) => {
        order.push(change.table);
        return Promise.resolve([]);
      });
    }
    const empty = table({ deleted: [UNKNOWN_ID] });

    await push(OWNER_A, {
      notifications: empty,
      ledger_entries: empty,
      deliveries: empty,
      order_lines: empty,
      orders: empty,
      customer_relationships: empty,
    });

    expect(JUDGE_TABLE_ORDER).toEqual([
      'customer_relationships',
      'orders',
      'order_lines',
      'deliveries',
      'ledger_entries',
      'notifications',
    ]);
    expect(order.length).toBeLessThanOrEqual(6);
    const expected = JUDGE_TABLE_ORDER.filter((name) => order.includes(name));
    expect(order).toEqual(expected);
  });

  it('hands honest lines to their adapter (AC-6, CM-28)', async () => {
    const orderCalls: TableChange[] = [];
    const relCalls: TableChange[] = [];
    acceptAll(ordersAdapter, orderCalls);
    acceptAll(customerRelationshipsAdapter, relCalls);

    const response = await push(SELLER, {
      customer_relationships: table({ updated: [{ id: REL_A, delivery_address: 'Rue 9' }] }),
      orders: table({
        created: [{ id: NEW_ORDER, customer_relationship_id: REL_A, status: 'CONFIRMED' }],
        updated: [{ id: ORDER_A, supplier_note: 'new note' }],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(3);
    expect(body.rejected).toEqual([]);
    expect(orderCalls.flatMap((c) => c.created.map((r) => r['id']))).toEqual([NEW_ORDER]);
    expect(orderCalls.flatMap((c) => c.updated.map((r) => r['id']))).toEqual([ORDER_A]);
    expect(relCalls.flatMap((c) => c.updated.map((r) => r['id']))).toEqual([REL_A]);
  });

  it('passes a whole row whose unchanged fields equal the stored ones (AC-6)', async () => {
    const calls: TableChange[] = [];
    acceptAll(ordersAdapter, calls);

    const response = await push(SELLER, {
      orders: table({
        updated: [
          {
            id: ORDER_A,
            customer_relationship_id: REL_A,
            status: 'CONFIRMED',
            total_amount: 10000,
            created_at: LONG_AGO.getTime(),
            supplier_note: 'edited',
          },
        ],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect(calls.flatMap((c) => c.updated)).toHaveLength(1);
  });

  it('does not let a rejected line stop the honest ones of the same batch (CM-28)', async () => {
    const calls: TableChange[] = [];
    acceptAll(ordersAdapter, calls);

    const response = await push(SELLER, {
      orders: table({
        created: [
          { id: NEW_ORDER, customer_relationship_id: REL_B },
          { id: NEW_ORDER_2, customer_relationship_id: REL_A },
        ],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(1);
    expect(body.rejected.map((r) => r.id)).toEqual([NEW_ORDER]);
    expect(calls.flatMap((c) => c.created.map((r) => r['id']))).toEqual([NEW_ORDER_2]);
  });

  it('forbids writing a row of another organization by knowing its id (AB-1)', async () => {
    const orderCalls: TableChange[] = [];
    const lineCalls: TableChange[] = [];
    acceptAll(ordersAdapter, orderCalls);
    acceptAll(orderLinesAdapter, lineCalls);

    const response = await push(SELLER, {
      orders: table({ updated: [{ id: ORDER_B, supplier_note: 'hijacked' }], deleted: [ORDER_B] }),
      order_lines: table({ updated: [{ id: LINE_B, unit_price_applied: 1 }] }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(0);
    expect(body.rejected.map((r) => r.code)).toEqual([
      'OUT_OF_SCOPE',
      'OUT_OF_SCOPE',
      'OUT_OF_SCOPE',
    ]);
    expect(orderCalls).toEqual([]);
    expect(lineCalls).toEqual([]);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_B } });
    expect(stored.supplierNote).toBe('note');
    expect(stored.deletedAt).toBeNull();
  });

  it('answers the same for an unknown id as for a foreign one (no existence leak, AB-1)', async () => {
    acceptAll(ordersAdapter);

    const response = await push(SELLER, {
      orders: table({
        updated: [
          { id: UNKNOWN_ID, supplier_note: 'x' },
          { id: 'not-a-uuid', supplier_note: 'x' },
        ],
        deleted: [UNKNOWN_ID, 'not-a-uuid'],
      }),
    });

    expect(response.status).toBe(200);
    const body = bodyOf<PushBody>(response);
    expect(body.rejected.map((r) => r.code)).toEqual([
      'OUT_OF_SCOPE',
      'OUT_OF_SCOPE',
      'OUT_OF_SCOPE',
      'OUT_OF_SCOPE',
    ]);
  });

  it('forbids a DRIVER from changing unit_price_applied (AB-2)', async () => {
    const calls: TableChange[] = [];
    acceptAll(orderLinesAdapter, calls);

    const response = await push(DRIVER, {
      order_lines: table({ updated: [{ id: LINE_A, unit_price_applied: 1 }] }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([
      expect.objectContaining({ table: 'order_lines', id: LINE_A, code: 'FIELD_NOT_ALLOWED' }),
    ]);
    expect(calls).toEqual([]);
    const stored = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE_A } });
    expect(stored.unitPriceApplied).toBe(5000n);
  });

  it('lets a SELLER change unit_price_applied, which the rules table allows (AC-6)', async () => {
    acceptAll(orderLinesAdapter);

    const response = await push(SELLER, {
      order_lines: table({ updated: [{ id: LINE_A, unit_price_applied: 4500 }] }),
    });

    expect(bodyOf<PushBody>(response).accepted).toBe(1);
  });

  it('forbids a field the role may not write even next to an allowed one (AB-2)', async () => {
    const calls: TableChange[] = [];
    acceptAll(customerRelationshipsAdapter, calls);

    const response = await push(SELLER, {
      customer_relationships: table({
        updated: [{ id: REL_A, customer_label: 'ok', status: 'ENDED' }],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected[0]?.code).toBe('FIELD_NOT_ALLOWED');
    expect(calls).toEqual([]);
  });

  it('forbids creating a row the role has no right to create (AB-2)', async () => {
    const calls: TableChange[] = [];
    acceptAll(ordersAdapter, calls);
    acceptAll(ledgerEntriesAdapter, calls);

    const response = await push(DRIVER, {
      orders: table({ created: [{ id: NEW_ORDER, customer_relationship_id: REL_A }] }),
      ledger_entries: table({
        created: [
          {
            id: NEW_ORDER_2,
            customer_relationship_id: REL_A,
            kind: 'CREDIT_NOTE',
            amount: 100,
          },
        ],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected.map((r) => r.code)).toEqual(['FIELD_NOT_ALLOWED', 'ONLINE_ONLY']);
    expect(calls).toEqual([]);
  });

  it('does not let a ledger entry be changed or deleted (immutable table)', async () => {
    const calls: TableChange[] = [];
    acceptAll(ledgerEntriesAdapter, calls);
    const entryId = '0199e010-0000-7000-8000-000000000501';
    await prisma.ledgerEntry.create({
      data: {
        id: entryId,
        customerRelationshipId: REL_A,
        kind: 'PAYMENT',
        mode: 'CASH',
        amount: 100n,
        recordedById: SELLER,
        occurredAt: LONG_AGO,
      },
    });

    const response = await push(OWNER_A, {
      ledger_entries: table({ updated: [{ id: entryId, amount: 1 }], deleted: [entryId] }),
    });

    expect(bodyOf<PushBody>(response).rejected.map((r) => r.code)).toEqual([
      'ONLINE_ONLY',
      'ONLINE_ONLY',
    ]);
    expect(calls).toEqual([]);
  });

  it('gives a customer person no write right on their own relationship (fail closed)', async () => {
    const calls: TableChange[] = [];
    acceptAll(customerRelationshipsAdapter, calls);

    const response = await push(CUSTOMER, {
      customer_relationships: table({ updated: [{ id: REL_A, delivery_address: 'Rue 1' }] }),
    });

    expect(bodyOf<PushBody>(response).rejected[0]?.code).toBe('FIELD_NOT_ALLOWED');
    expect(calls).toEqual([]);
  });

  it('does not take a notification of another recipient into scope', async () => {
    const calls: TableChange[] = [];
    acceptAll(notificationsAdapter, calls);
    const notificationId = '0199e010-0000-7000-8000-000000000601';
    await prisma.notification.create({
      data: {
        id: notificationId,
        recipientId: OWNER_B,
        content: 'hello',
        sourceEvent: 'sync.test',
      },
    });

    const response = await push(SELLER, {
      notifications: table({ updated: [{ id: notificationId, read_status: 'READ' }] }),
    });

    expect(bodyOf<PushBody>(response).rejected[0]?.code).toBe('OUT_OF_SCOPE');
    expect(calls).toEqual([]);
  });

  it('refuses a created relationship naming another organization', async () => {
    const calls: TableChange[] = [];
    acceptAll(customerRelationshipsAdapter, calls);

    const response = await push(SELLER, {
      customer_relationships: table({
        created: [{ id: NEW_ORDER, supplier_organization_id: ORG_B, customer_label: 'x' }],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected[0]?.code).toBe('OUT_OF_SCOPE');
    expect(calls).toEqual([]);
  });

  it('stripComputed removes the computed fields of a table and keeps the rest (CM-27)', () => {
    expect(
      stripComputed('orders', {
        id: 'o',
        total_amount: 1,
        server_updated_at: 2,
        scope_version: 3,
        last_synced_at: 4,
        supplier_note: 'keep',
      })
    ).toEqual({ id: 'o', supplier_note: 'keep' });
    expect(
      stripComputed('customer_relationships', {
        id: 'r',
        balance: 1,
        credit_limit_set_at: 2,
        ended_by_party: 'X',
        amount_held: 3,
        price_updated_at: 4,
        customer_label: 'keep',
      })
    ).toEqual({ id: 'r', customer_label: 'keep' });
    expect(stripComputed('order_lines', { id: 'l', amount: 5, unit_price_applied: 6 })).toEqual({
      id: 'l',
      unit_price_applied: 6,
    });
    expect(
      stripComputed('ledger_entries', { id: 'e', kind: 'SALE', amount: 5, balance_effect: 5 })
    ).toEqual({ id: 'e', kind: 'SALE' });
    expect(
      stripComputed('ledger_entries', { id: 'e', kind: 'PAYMENT', amount: 5, balance_effect: 5 })
    ).toEqual({ id: 'e', kind: 'PAYMENT', amount: 5 });
  });
});
