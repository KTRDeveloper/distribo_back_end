import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { seedProduct } from '../../helpers/catalog-fixtures';
import { orderAdapters } from '../../../src/modules/sync/adapters/order.adapter.js';
import type { Viewer } from '../../../src/modules/sync/sync.types.js';
import { prisma } from '../../setup.js';

const SELLER = '0199e046-0000-7000-8000-000000000001';
const DRIVER = '0199e046-0000-7000-8000-000000000003';
const OWNER_A = '0199e046-0000-7000-8000-000000000005';
const OWNER_B = '0199e046-0000-7000-8000-000000000006';
const CUSTOMER = '0199e046-0000-7000-8000-000000000007';
const ORG_A = '0199e046-0000-7000-8000-0000000000a1';
const ORG_B = '0199e046-0000-7000-8000-0000000000b1';
const REL = '0199e046-0000-7000-8000-0000000000c1';
const PRODUCT = '0199e046-0000-7000-8000-0000000000d1';
const O1 = '0199e046-0000-7000-8000-000000000501';
const O2 = '0199e046-0000-7000-8000-000000000502';
const O3 = '0199e046-0000-7000-8000-000000000503';
const LINE1 = '0199e046-0000-7000-8000-000000000601';
const LINE2 = '0199e046-0000-7000-8000-000000000602';
const LINE3 = '0199e046-0000-7000-8000-000000000603';
const DELIVERY = '0199e046-0000-7000-8000-000000000701';
const SALE = '0199e046-0000-7000-8000-000000000801';
const PAYMENT = '0199e046-0000-7000-8000-000000000802';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

const DELIVERED_ISSUE =
  "Livrée alors que le client l'avait modifiée : vérifiez la nouvelle version";
const NO_EFFECT = 'Changement hors ligne sans effet : le client avait déjà modifié cette commande';

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
    devices[id] = `0199e046-0000-7000-8000-0000000009${phone.slice(-2)}`;
    await prisma.device.create({
      data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
    });
  }
}

async function seedMember(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e046-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

/**
 * An order the customer placed, 10 sacks at 3000. A replaced version is cancelled by the customer,
 * deleted and linked to its replacement (ORD-039); a current version is PENDING.
 */
async function seedVersion(id: string, lineId: string, replacedBy: string | null) {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: REL,
      placedByParty: 'CUSTOMER',
      enteredById: CUSTOMER,
      status: replacedBy ? 'CANCELLED' : 'PENDING',
      deliveryAddressApplied: 'Rue 1',
      deliveryCost: 0n,
      totalAmount: 30000n,
      createdAt: LONG_AGO,
      ...(replacedBy
        ? {
            cancelledByParty: 'CUSTOMER' as const,
            cancelledById: CUSTOMER,
            cancelledAt: LONG_AGO,
            deletedAt: LONG_AGO,
            replacedByOrderId: replacedBy,
          }
        : {}),
      lines: {
        create: {
          id: lineId,
          productVariantId: PRODUCT,
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

const stored = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
const linesOf = (id: string) => prisma.orderLine.findMany({ where: { orderId: id } });
const entriesOf = (orderId: string) => prisma.ledgerEntry.findMany({ where: { orderId } });

describe('an offline gesture on a replaced order (SYNC-046)', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600004601', 'Sam Seller');
    await seedPerson(DRIVER, '+237600004603', 'Dora Driver');
    await seedPerson(OWNER_A, '+237600004605', 'Olga Owner');
    await seedPerson(OWNER_B, '+237600004606', 'Otto Owner');
    await seedPerson(CUSTOMER, '+237600004607', 'Cora Customer');
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
    await seedProduct(prisma, {
      id: PRODUCT,
      organizationId: ORG_A,
      name: 'Riz',
      unit: 'sac',
      price: 3000n,
    });
    await prisma.customerRelationship.create({
      data: {
        id: REL,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        createdById: OWNER_A,
        createdAt: LONG_AGO,
        status: 'ACTIVE',
        creditLimit: 100000n,
        deliveryAddress: 'Rue 1',
      },
    });
  });

  it('lets a delivery of the old version win and flags both versions (AC-1, C-58)', async () => {
    await seedVersion(O2, LINE2, null);
    await seedVersion(O1, LINE1, O2);

    const response = await push(SELLER, {
      orders: table({ updated: [{ id: O1, status: 'DELIVERED' }] }),
      ledger_entries: table({
        created: [
          { id: SALE, customer_relationship_id: REL, order_id: O1, kind: 'SALE', amount: 30000 },
          {
            id: PAYMENT,
            customer_relationship_id: REL,
            order_id: O1,
            kind: 'PAYMENT',
            amount: 30000,
            mode: 'CASH',
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
    expect(await stored(O1)).toMatchObject({
      status: 'DELIVERED',
      deletedAt: null,
      replacedByOrderId: O2,
      syncIssue: DELIVERED_ISSUE,
    });
    expect((await entriesOf(O1)).map((e) => e.kind).sort()).toEqual(['PAYMENT', 'SALE']);
    expect(await stored(O2)).toMatchObject({ status: 'PENDING', syncIssue: DELIVERED_ISSUE });
    expect(await linesOf(O2)).toHaveLength(1);
    expect(await entriesOf(O2)).toHaveLength(0);
  });

  const gestures = [
    ['an acceptance', 'orders', { updated: [{ id: O1, status: 'CONFIRMED' }] }, SELLER, O1],
    [
      'a lower line price',
      'order_lines',
      { updated: [{ id: LINE1, order_id: O1, unit_price_applied: 2500 }] },
      SELLER,
      LINE1,
    ],
    [
      'a departure',
      'deliveries',
      {
        created: [{ id: DELIVERY, order_id: O1, departed_at: Date.parse('2026-09-30T08:00:00Z') }],
      },
      DRIVER,
      DELIVERY,
    ],
    [
      'a refusal',
      'orders',
      { updated: [{ id: O1, status: 'CANCELLED', cancellation_reason: 'Stock épuisé' }] },
      SELLER,
      O1,
    ],
    [
      'a supplier note',
      'orders',
      { updated: [{ id: O1, supplier_note: 'Appeler avant' }] },
      SELLER,
      O1,
    ],
  ];

  /** Runs the adapter of `tableName` alone on a judged line and returns its outcomes. */
  const throughAdapter = (tableName: string, part: object, personId: string, role: string) => {
    const viewer: Viewer = {
      personId,
      deviceId: 'device',
      memberships: [{ organizationId: ORG_A, role: role as 'SELLER', status: 'ACTIVE' }],
      scopeVersion: 0,
      isOnline: false,
    };
    const adapter = orderAdapters.find((a) => a.table === tableName);
    return prisma.$transaction((tx) =>
      adapter!.push({ viewer, tx }, { table: tableName as 'orders', ...table(part) })
    );
  };

  it.each(gestures)(
    'answers %s ORDER_REPLACED (AC-2)',
    async (_name, tableName, part, person, rowId) => {
      await seedVersion(O2, LINE2, null);
      await seedVersion(O1, LINE1, O2);

      const outcomes = await throughAdapter(
        tableName,
        part,
        person,
        person === DRIVER ? 'DRIVER' : 'SELLER'
      );

      expect(outcomes).toEqual([
        { table: tableName, id: rowId, kind: 'issue', code: 'ORDER_REPLACED', message: NO_EFFECT },
      ]);
    }
  );

  it.each(gestures)(
    'leaves the old version untouched on %s (AC-2)',
    async (_name, tableName, part, person) => {
      await seedVersion(O2, LINE2, null);
      await seedVersion(O1, LINE1, O2);
      const before = await stored(O1);
      const linesBefore = await linesOf(O1);

      const response = await push(person, { [tableName]: table(part) });

      expect(response.status).toBe(200);
      expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
      expect(await stored(O1)).toEqual(before);
      expect(await linesOf(O1)).toEqual(linesBefore);
      expect(await prisma.delivery.count()).toBe(0);
      expect(await stored(O2)).toMatchObject({ status: 'PENDING', syncIssue: NO_EFFECT });
    }
  );

  it('flags the current version at the end of a chain of replacements (AC-3)', async () => {
    await seedVersion(O3, LINE3, null);
    await seedVersion(O2, LINE2, O3);
    await seedVersion(O1, LINE1, O2);

    const response = await push(SELLER, {
      orders: table({ updated: [{ id: O1, supplier_note: 'Appeler avant' }] }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect(await stored(O3)).toMatchObject({ syncIssue: NO_EFFECT });
    expect((await stored(O2)).syncIssue).toBeNull();
    expect((await stored(O1)).syncIssue).toBeNull();
  });

  it('refuses the delivery of another business and changes nothing (AB-1, WSTG-ATHZ-04)', async () => {
    await seedVersion(O2, LINE2, null);
    await seedVersion(O1, LINE1, O2);
    const before = await stored(O1);

    const response = await push(OWNER_B, {
      orders: table({ updated: [{ id: O1, status: 'DELIVERED' }] }),
    });

    expect(bodyOf<PushBody>(response).rejected).toMatchObject([
      { table: 'orders', id: O1, code: 'OUT_OF_SCOPE' },
    ]);
    expect(await stored(O1)).toEqual(before);
    expect((await stored(O2)).syncIssue).toBeNull();
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });
  it('keeps the old version deleted when the delivery is refused (fail closed)', async () => {
    await seedVersion(O2, LINE2, null);
    await seedVersion(O1, LINE1, O2);
    const before = await stored(O1);

    const response = await push(SELLER, {
      orders: table({ updated: [{ id: O1, status: 'DELIVERED' }] }),
      order_lines: table({ updated: [{ id: LINE1, order_id: O1, delivered_quantity: 'abc' }] }),
    });

    expect(response.status).toBe(200);
    expect(await stored(O1)).toEqual(before);
    expect((await stored(O2)).syncIssue).toBeNull();
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it('lets the database clear only the deleted mark of a replaced order (SYNC-046 migration)', async () => {
    await seedVersion(O2, LINE2, null);
    await seedVersion(O1, LINE1, O2);
    const cancelled = {
      id: '0199e046-0000-7000-8000-000000000504',
      lineId: '0199e046-0000-7000-8000-000000000604',
    };
    await prisma.order.create({
      data: {
        id: cancelled.id,
        customerRelationshipId: REL,
        placedByParty: 'CUSTOMER',
        enteredById: CUSTOMER,
        status: 'CANCELLED',
        deliveryCost: 0n,
        totalAmount: 0n,
        cancelledByParty: 'CUSTOMER',
        cancelledById: CUSTOMER,
        cancelledAt: LONG_AGO,
        deletedAt: LONG_AGO,
      },
    });

    // A cancelled order without a link stays frozen; a replaced one only loses its deleted mark.
    await expect(
      prisma.order.update({ where: { id: cancelled.id }, data: { deletedAt: null } })
    ).rejects.toThrow(/can only change/);
    await expect(
      prisma.order.update({ where: { id: O1 }, data: { deletedAt: null, deliveryCost: 5n } })
    ).rejects.toThrow(/can only change/);
    await prisma.order.update({ where: { id: O1 }, data: { deletedAt: null } });
    expect(await stored(O1)).toMatchObject({ deletedAt: null, replacedByOrderId: O2 });
  });
});
