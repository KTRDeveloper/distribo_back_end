import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const SELLER = '0199e016-0000-7000-8000-000000000001';
const OWNER_A = '0199e016-0000-7000-8000-000000000004';
const MANAGER_A = '0199e016-0000-7000-8000-000000000008';
const OWNER_B = '0199e016-0000-7000-8000-000000000005';
const CUSTOMER = '0199e016-0000-7000-8000-000000000006';
const ORG_A = '0199e016-0000-7000-8000-0000000000a1';
const ORG_B = '0199e016-0000-7000-8000-0000000000b1';
const REL = '0199e016-0000-7000-8000-0000000000c1';
const PRODUCT = '0199e016-0000-7000-8000-0000000000d1';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const ORDERS = [1, 2, 3].map((n) => `0199e016-0000-7000-8000-00000000050${n}`);
const LINES = [1, 2, 3].map((n) => `0199e016-0000-7000-8000-00000000060${n}`);

type PushBody = { accepted: number; rejected: unknown[]; aside: number };

let deviceId = '';

const push = async (changes: unknown) =>
  createAuthenticatedRequest(app, SELLER, deviceId)
    .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
    .send({ changes });

const table = (created: unknown[]) => ({ created, updated: [], deleted: [] });

const orderRow = (id: string, createdAt: number) => ({
  id,
  customer_relationship_id: REL,
  delivery_address_applied: 'Rue 1',
  delivery_cost: 0,
  desired_delivery_date: null,
  customer_note: null,
  created_at: createdAt,
});

const lineRow = (id: string, orderId: string, extra: Record<string, unknown> = {}) => ({
  id,
  order_id: orderId,
  product_variant_id: PRODUCT,
  quantity: '10',
  reference_price: 3000,
  unit_price_applied: 3000,
  ...extra,
});

const batchOf = (n: number, createdAt: number, lineExtra: Record<string, unknown> = {}) => ({
  orders: table(ORDERS.slice(0, n).map((id) => orderRow(id, createdAt))),
  order_lines: table(ORDERS.slice(0, n).map((id, i) => lineRow(LINES[i], id, lineExtra))),
});

const SUNDAY = Date.parse('2026-09-27T10:00:00.000Z');
const anomalies = (recipientId: string) =>
  prisma.notification.findMany({ where: { recipientId, sourceEvent: 'sync.anomalies' } });
const storedOrder = (id = ORDERS[0]) =>
  prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });

async function seedPerson(id: string, phone: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Controls Person',
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
      id: `0199e016-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

describe('controls on arrival (SYNC-016)', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600001601');
    await seedPerson(OWNER_A, '+237600001604');
    await seedPerson(MANAGER_A, '+237600001608');
    await seedPerson(OWNER_B, '+237600001605');
    await seedPerson(CUSTOMER, '+237600001606', false);
    deviceId = '0199e016-0000-7000-8000-000000000701';
    await prisma.device.create({
      data: { id: deviceId, personId: SELLER, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('04', OWNER_A, ORG_A, 'OWNER');
    await seedMember('08', MANAGER_A, ORG_A, 'MANAGER');
    await seedMember('05', OWNER_B, ORG_B, 'OWNER');
    await seedMember('01', SELLER, ORG_A, 'SELLER');
    // The database dates the price at creation: it has stood since before the orders below.
    await prisma.product.create({
      data: {
        id: PRODUCT,
        organizationId: ORG_A,
        name: 'Riz',
        unit: 'sac',
        price: 3000n,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        id: REL,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        createdById: OWNER_A,
        createdAt: LONG_AGO,
        deliveryAddress: 'Rue 1',
      },
    });
  });

  it('flags a sale at the old price as PRICE_CHANGED, with no price gap author (AC-1, CM-28)', async () => {
    // The seller sold at 3000 on Sunday offline; the price rose to 3200 since (the database dates
    // the change, so it is later than the Sunday order).
    await prisma.product.update({ where: { id: PRODUCT }, data: { price: 3200n } });

    const response = await push(batchOf(1, SUNDAY));

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
    const order = await storedOrder();
    expect(order.syncIssue).toMatch(/^PRICE_CHANGED: /);
    expect(order.syncIssue).toContain('vendu 3 000');
    expect(order.syncIssue).toMatch(/prix passé à 3 200 [a-z]+ à \d{1,2} h( \d{2})?$/);
    expect(order.lines[0]).toMatchObject({ priceSetById: null, priceSetAt: null });
    expect(order.lines[0].unitPriceApplied).toBe(3000n);
  });

  it('keeps a real discount a price gap, with no PRICE_CHANGED (AC-2)', async () => {
    const response = await push(batchOf(1, SUNDAY, { unit_price_applied: 2500 }));

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const order = await storedOrder();
    expect(order.syncIssue).toBeNull();
    expect(order.lines[0]).toMatchObject({ referencePrice: 3000n, priceSetById: SELLER });
    expect(order.lines[0].priceSetAt).not.toBeNull();
  });

  it('flags an order dated 2 hours ahead as DATE_IN_FUTURE and stores it (AC-3, CM-31)', async () => {
    const ahead = Date.now() + 2 * 3_600_000;

    const response = await push(batchOf(1, ahead));

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
    const order = await storedOrder();
    expect(order.syncIssue).toMatch(/^DATE_IN_FUTURE: /);
    expect(order.createdAt.getTime()).toBe(ahead);
  });

  it('does not flag a phone clock a few seconds ahead (AC-3)', async () => {
    const response = await push(batchOf(1, Date.now() + 30_000));

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect((await storedOrder()).syncIssue).toBeNull();
    expect(await prisma.notification.count()).toBe(0);
  });

  it('flags an order older than the last sync minus 92 days as DATE_OUT_OF_ORDER (AC-3, CM-31)', async () => {
    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSyncedAt: new Date('2026-09-01T00:00:00.000Z') },
    });

    const response = await push(batchOf(1, Date.parse('2026-05-01T10:00:00.000Z')));

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect((await storedOrder()).syncIssue).toMatch(/^DATE_OUT_OF_ORDER: /);
  });

  it('joins several issues of one order with " ; " (AC-3)', async () => {
    await prisma.product.update({ where: { id: PRODUCT }, data: { price: 3200n } });
    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSyncedAt: new Date('2026-09-01T00:00:00.000Z') },
    });

    await push(batchOf(1, Date.parse('2026-05-01T10:00:00.000Z')));

    const issue = (await storedOrder()).syncIssue ?? '';
    expect(issue).toMatch(/^PRICE_CHANGED: .* ; DATE_OUT_OF_ORDER: /);
  });

  it('tells the owner of the organization once per batch, and no one else (AC-4, v5.0.0-16.3.3)', async () => {
    const response = await push(batchOf(3, Date.now() + 2 * 3_600_000));

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const notes = await anomalies(OWNER_A);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ readStatus: 'UNREAD', organizationId: ORG_A });
    expect(notes[0].content).toBe('3 écarts à vérifier');
    // Another organization's owner, a manager and the seller are not told.
    for (const other of [OWNER_B, MANAGER_A, SELLER]) {
      expect(await anomalies(other)).toHaveLength(0);
    }
  });

  it('leaves a clean batch without issue or notification (AC-5)', async () => {
    const response = await push(batchOf(2, SUNDAY));

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 4, rejected: [], aside: 0 });
    expect((await storedOrder(ORDERS[0])).syncIssue).toBeNull();
    expect((await storedOrder(ORDERS[1])).syncIssue).toBeNull();
    expect(await prisma.notification.count()).toBe(0);
  });

  it('a repeated batch changes nothing: no second issue text, no second notification', async () => {
    const batch = batchOf(1, Date.now() + 2 * 3_600_000);
    await push(batch);
    const first = (await storedOrder()).syncIssue;

    const again = await push(batch);

    expect(again.status).toBe(200);
    expect((await storedOrder()).syncIssue).toBe(first);
    expect(await anomalies(OWNER_A)).toHaveLength(1);
  });

  it('compares a claimed reference with the price the server holds (AB-1, CWE-345)', async () => {
    // The phone claims the price was 2500 and sells at 2500: no gap on its face. The server has
    // held 3000 since before the order, so the discount must stay visible.
    const response = await push(
      batchOf(1, Date.now() + 1000, { reference_price: 2500, unit_price_applied: 2500 })
    );

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const line = (await storedOrder()).lines[0];
    expect(line).toMatchObject({
      referencePrice: 3000n,
      unitPriceApplied: 2500n,
      priceSetById: SELLER,
    });
    expect(line.priceSetAt).not.toBeNull();
    expect((await storedOrder()).syncIssue).toBeNull();
  });
});
