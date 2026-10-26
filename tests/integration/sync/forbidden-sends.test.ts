import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { logger } from '../../../src/lib/logger.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const SELLER = '0199e018-0000-7000-8000-000000000001';
const OWNER_A = '0199e018-0000-7000-8000-000000000004';
const OWNER_B = '0199e018-0000-7000-8000-000000000005';
const CUSTOMER = '0199e018-0000-7000-8000-000000000006';
const CUSTOMER_B = '0199e018-0000-7000-8000-000000000007';
const ORG_A = '0199e018-0000-7000-8000-0000000000a1';
const ORG_B = '0199e018-0000-7000-8000-0000000000b1';
const REL = '0199e018-0000-7000-8000-0000000000c1';
const REL_B = '0199e018-0000-7000-8000-0000000000c2';
const PRODUCT = '0199e018-0000-7000-8000-0000000000d1';
const DEVICE = '0199e018-0000-7000-8000-000000000701';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const ORDER_OK_1 = '0199e018-0000-7000-8000-000000000501';
const ORDER_OK_2 = '0199e018-0000-7000-8000-000000000502';
const ORDER_BAD = '0199e018-0000-7000-8000-000000000503';
const LINE_OK_1 = '0199e018-0000-7000-8000-000000000601';
const LINE_OK_2 = '0199e018-0000-7000-8000-000000000602';
const PRIVATE_ADDRESS = 'Secret street 99';

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
  resync_required: boolean;
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

const order = (id: string, relationship: string, address = 'Rue 1') => ({
  id,
  customer_relationship_id: relationship,
  delivery_address_applied: address,
  delivery_cost: 0,
  desired_delivery_date: null,
  customer_note: null,
  created_at: Date.now() - 1000,
});

const line = (id: string, orderId: string) => ({
  id,
  order_id: orderId,
  product_variant_id: PRODUCT,
  quantity: '10',
  reference_price: 3000,
  unit_price_applied: 3000,
});

const refusals = () =>
  prisma.notification.findMany({ where: { recipientId: SELLER, sourceEvent: 'sync.refused' } });

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
      id: `0199e018-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

describe('forbidden sends are refused, recorded and trigger a resync (SYNC-018)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await seedPerson(SELLER, '+237600001801', 'Sam Seller');
    await seedPerson(OWNER_A, '+237600001804', 'Olga Owner');
    await seedPerson(OWNER_B, '+237600001805', 'Otto Owner');
    await seedPerson(CUSTOMER, '+237600001806', 'Cora Customer', false);
    await seedPerson(CUSTOMER_B, '+237600001807', 'Cleo Customer', false);
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
    for (const [id, org, customer, owner] of [
      [REL, ORG_A, CUSTOMER, OWNER_A],
      [REL_B, ORG_B, CUSTOMER_B, OWNER_B],
    ]) {
      await prisma.customerRelationship.create({
        data: {
          id,
          supplierOrganizationId: org,
          customerPersonId: customer,
          customerLabel: 'Chez Client',
          createdById: owner,
          createdAt: LONG_AGO,
          status: 'ACTIVE',
          deliveryAddress: 'Rue 1',
        },
      });
    }
  });

  const mixedBatch = () => ({
    orders: table({
      created: [
        order(ORDER_OK_1, REL),
        order(ORDER_OK_2, REL),
        order(ORDER_BAD, REL_B, PRIVATE_ADDRESS),
      ],
    }),
    order_lines: table({ created: [line(LINE_OK_1, ORDER_OK_1), line(LINE_OK_2, ORDER_OK_2)] }),
  });

  it('refuses the forbidden line, stores the good ones and asks for a resync (AC-1, CM-28)', async () => {
    const response = await push(mixedBatch());

    expect(response.status).toBe(200);
    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]).toMatchObject({
      table: 'orders',
      id: ORDER_BAD,
      code: 'OUT_OF_SCOPE',
    });
    expect(body.resync_required).toBe(true);
    expect(body.accepted).toBe(4);
    const stored = await prisma.order.findMany({
      where: { id: { in: [ORDER_OK_1, ORDER_OK_2, ORDER_BAD] } },
    });
    expect(stored.map((o) => o.id).sort()).toEqual([ORDER_OK_1, ORDER_OK_2]);
  });

  it('tells the author once, with the count and the code (AC-2)', async () => {
    await push(mixedBatch());

    const notifications = await refusals();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.readAt ?? null).toBeNull();
    expect(notifications[0]?.content).toContain('1 opération(s) non enregistrée(s)');
    expect(notifications[0]?.content).toContain('OUT_OF_SCOPE');
    expect(notifications[0]?.content).toContain('orders');
    expect(notifications[0]?.content).not.toContain(PRIVATE_ADDRESS);
  });

  it('notifies in English for an English-speaking author', async () => {
    await prisma.person.update({ where: { id: SELLER }, data: { preferredLanguage: 'EN' } });

    await push(mixedBatch());

    const [notification] = await refusals();
    expect(notification?.content).toContain('1 operation(s) not recorded');
  });

  it('names at most 5 lines in the notification but counts all of them (AC-2)', async () => {
    const ids = Array.from(
      { length: 7 },
      (_, i) => `0199e018-0000-7000-8000-0000000008${String(i).padStart(2, '0')}`
    );

    await push({ orders: table({ created: ids.map((id) => order(id, REL_B)) }) });

    const [notification] = await refusals();
    expect(notification?.content).toContain('7 opération(s) non enregistrée(s)');
    expect(notification?.content.match(/orders:OUT_OF_SCOPE/g)).toHaveLength(5);
  });

  it('sets aside a line no adapter can write, applies the rest and tells the author (AC-3, C-36)', async () => {
    const response = await push({
      widgets: table({ created: [{ id: 'w1' }] }),
      orders: table({ created: [order(ORDER_OK_1, REL)] }),
      order_lines: table({ created: [line(LINE_OK_1, ORDER_OK_1)] }),
    });

    expect(response.status).toBe(200);
    const body = bodyOf<PushBody>(response);
    expect(body.aside).toBe(1);
    expect(body.accepted).toBe(2);
    expect(body.rejected).toEqual([]);
    expect(await prisma.order.count({ where: { id: ORDER_OK_1 } })).toBe(1);
    const notifications = await refusals();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.content).toContain('1 opération(s) non enregistrée(s)');
  });

  it('logs table, id, code and person id and no field value (AC-4, v5.0.0-16.3.2)', async () => {
    const warn = vi.spyOn(logger, 'warn');

    await push(mixedBatch());

    const entries = warn.mock.calls
      .map(([entry]) => entry as Record<string, unknown>)
      .filter((entry) => entry['event'] === 'sync_line_refused');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      table: 'orders',
      recordId: ORDER_BAD,
      code: 'OUT_OF_SCOPE',
      personId: SELLER,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PRIVATE_ADDRESS);
  });

  it('answers a clean batch with nothing rejected, no resync and no notification (AC-5)', async () => {
    const response = await push({
      orders: table({ created: [order(ORDER_OK_1, REL)] }),
      order_lines: table({ created: [line(LINE_OK_1, ORDER_OK_1)] }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([]);
    expect(body.resync_required).toBe(false);
    expect(await refusals()).toHaveLength(0);
  });

  it('reveals only the three judge codes however many lines are forbidden (AB-1, CWE-200)', async () => {
    const ids = Array.from(
      { length: 6 },
      (_, i) => `0199e018-0000-7000-8000-0000000009${String(i).padStart(2, '0')}`
    );
    const unknown = '0199e018-0000-7000-8000-000000000999';

    const response = await push({
      orders: table({
        created: ids.map((id) => order(id, REL_B)),
        updated: [{ id: unknown, delivery_address_applied: 'x' }],
      }),
      ledger_entries: table({ updated: [{ id: unknown }], deleted: [unknown] }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected.length).toBeGreaterThanOrEqual(8);
    const codes = new Set(body.rejected.map((r) => r.code));
    for (const code of codes) {
      expect(['OUT_OF_SCOPE', 'FIELD_NOT_ALLOWED', 'ONLINE_ONLY']).toContain(code);
    }
    expect(body.resync_required).toBe(true);
  });
});
