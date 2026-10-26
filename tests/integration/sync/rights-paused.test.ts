import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';
import { seedProduct } from '../../helpers/catalog-fixtures.js';

const SELLER = '0199e039-0000-7000-8000-000000000001';
const MANAGER = '0199e039-0000-7000-8000-000000000002';
const OWNER_A = '0199e039-0000-7000-8000-000000000005';
const OWNER_B = '0199e039-0000-7000-8000-000000000006';
const CUSTOMER = '0199e039-0000-7000-8000-000000000007';
const ORG_A = '0199e039-0000-7000-8000-0000000000a1';
const ORG_B = '0199e039-0000-7000-8000-0000000000b1';
const REL = '0199e039-0000-7000-8000-0000000000c1';
const REL_B = '0199e039-0000-7000-8000-0000000000c2';
const NEW_REL = '0199e039-0000-7000-8000-0000000000c3';
const PRODUCT = '0199e039-0000-7000-8000-0000000000d1';
const PRODUCT_B = '0199e039-0000-7000-8000-0000000000d2';
const ORDER = '0199e039-0000-7000-8000-000000000501';
const ORDER_B = '0199e039-0000-7000-8000-000000000503';
const LINE = '0199e039-0000-7000-8000-000000000601';
const CREDIT_NOTE = '0199e039-0000-7000-8000-000000000804';
const PRICE = '0199e039-0000-7000-8000-000000000901';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const SOLD_AT = Date.parse('2026-09-30T06:00:00.000Z');

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
};
type Rows = Array<Record<string, unknown>>;
type PullBody = { changes: Record<string, { created: Rows }> };

const devices: Record<string, string> = {};

const push = async (personId: string, changes: unknown) =>
  createAuthenticatedRequest(app, personId, devices[personId])
    .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
    .send({ changes });

const pull = async (personId: string) =>
  bodyOf<PullBody>(
    await createAuthenticatedRequest(app, personId, devices[personId]).get('/api/v1/sync/pull')
  );

const table = (part: Partial<{ created: unknown[]; updated: unknown[]; deleted: string[] }>) => ({
  created: [],
  updated: [],
  deleted: [],
  ...part,
});

const sale = (index: number) => {
  const suffix = String(index).padStart(3, '0');
  return {
    order: {
      id: `0199e039-0000-7000-8000-00000000a${suffix}`,
      customer_relationship_id: REL,
      status: 'DELIVERED',
      delivery_cost: 0,
      created_at: SOLD_AT,
    },
    line: {
      id: `0199e039-0000-7000-8000-00000000b${suffix}`,
      order_id: `0199e039-0000-7000-8000-00000000a${suffix}`,
      product_variant_id: PRODUCT,
      quantity: 2,
      reference_price: 3000,
      unit_price_applied: 3000,
      delivered_quantity: 2,
    },
  };
};

const sales = (count: number) => {
  const made = Array.from({ length: count }, (_, i) => sale(i));
  return {
    orders: table({ created: made.map((s) => s.order) }),
    order_lines: table({ created: made.map((s) => s.line) }),
  };
};

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
    devices[id] = `0199e039-0000-7000-8000-0000000009${phone.slice(-2)}`;
    await prisma.device.create({
      data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
    });
  }
}

async function seedMember(
  suffix: string,
  personId: string,
  org: string,
  role: string,
  status: 'ACTIVE' | 'PAUSED' = 'ACTIVE'
) {
  await prisma.collaboration.create({
    data: {
      id: `0199e039-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status,
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

/** The seat was paused on the server (scope_version 3) and the phone saw only `seen`. */
async function pausedWhileOffline(personId: string, seen = 2) {
  await prisma.person.update({ where: { id: personId }, data: { scopeVersion: 3 } });
  await prisma.device.update({
    where: { id: devices[personId] },
    data: { scopeVersionSeen: seen },
  });
}

const noticesOf = (personId: string, event: string) =>
  prisma.notification.findMany({ where: { recipientId: personId, sourceEvent: event } });

describe('a paused collaborator gets the grace of a revoked one (SYNC-039)', () => {
  beforeEach(async () => {
    await seedPerson(SELLER, '+237600003901', 'Sam Seller');
    await seedPerson(MANAGER, '+237600003902', 'Mia Manager');
    await seedPerson(OWNER_A, '+237600003905', 'Olga Owner');
    await seedPerson(OWNER_B, '+237600003906', 'Otto Owner');
    await seedPerson(CUSTOMER, '+237600003907', 'Cora Customer', false);
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('05', OWNER_A, ORG_A, 'OWNER');
    await seedMember('06', OWNER_B, ORG_B, 'OWNER');
    for (const [id, org] of [
      [PRODUCT, ORG_A],
      [PRODUCT_B, ORG_B],
    ]) {
      await seedProduct(prisma, {
        id,
        organizationId: org,
        name: 'Riz',
        unit: 'sac',
        price: 3000n,
      });
    }
    for (const [id, org] of [
      [REL, ORG_A],
      [REL_B, ORG_B],
    ]) {
      await prisma.customerRelationship.create({
        data: {
          id,
          supplierOrganizationId: org,
          customerPersonId: CUSTOMER,
          createdById: OWNER_A,
          createdAt: LONG_AGO,
          status: 'ACTIVE',
          deliveryAddress: 'Rue 1',
        },
      });
    }
    await prisma.order.create({
      data: {
        id: ORDER,
        customerRelationshipId: REL,
        placedByParty: 'SUPPLIER',
        enteredById: OWNER_A,
        status: 'CONFIRMED',
        deliveryAddressApplied: 'Rue 1',
        deliveryCost: 0n,
        totalAmount: 6000n,
        createdAt: LONG_AGO,
        lines: {
          create: {
            id: LINE,
            productVariantId: PRODUCT,
            labelApplied: 'Riz (sac)',
            quantity: '2',
            referencePrice: 3000n,
            unitPriceApplied: 3000n,
            amount: 6000n,
          },
        },
      },
    });
  });

  describe('a seller whose seat was paused while offline', () => {
    beforeEach(async () => {
      await seedMember('01', SELLER, ORG_A, 'SELLER', 'PAUSED');
      await pausedWhileOffline(SELLER);
    });

    it('keeps the 2 late sales and tells the owner once (AC-1, CM-29)', async () => {
      const response = await push(SELLER, sales(2));

      expect(response.status).toBe(200);
      expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
      expect(await prisma.order.count({ where: { enteredById: SELLER } })).toBe(2);
      const notices = await noticesOf(OWNER_A, 'sync.rights_changed');
      expect(notices).toHaveLength(1);
      expect(notices[0]?.content).toBe("2 opération(s) faites avec d'anciens droits");
      expect(notices[0]?.organizationId).toBe(ORG_A);
      expect(await noticesOf(OWNER_B, 'sync.rights_changed')).toHaveLength(0);
    });

    it('refuses a new customer, a cancellation and a note (AC-2)', async () => {
      const response = await push(SELLER, {
        customer_relationships: table({
          created: [
            {
              id: NEW_REL,
              supplier_organization_id: ORG_A,
              customer_label: 'Chez Paul',
              delivery_address: 'Rue 9',
            },
          ],
        }),
        orders: table({
          updated: [
            {
              id: ORDER,
              status: 'CANCELLED',
              cancelled_by_party: 'SUPPLIER',
              cancellation_reason: 'Erreur',
            },
          ],
        }),
      });
      const note = await push(SELLER, {
        orders: table({ updated: [{ id: ORDER, supplier_note: 'Passer demain' }] }),
      });

      expect(
        bodyOf<PushBody>(response)
          .rejected.map((r) => r.table)
          .sort()
      ).toEqual(['customer_relationships', 'orders']);
      expect(bodyOf<PushBody>(note).rejected).toHaveLength(1);
      expect(await prisma.customerRelationship.count({ where: { id: NEW_REL } })).toBe(0);
      const stored = await prisma.order.findUniqueOrThrow({ where: { id: ORDER } });
      expect(stored).toMatchObject({ status: 'CONFIRMED', supplierNote: null });
    });

    it('pulls nothing of the business (AC-4)', async () => {
      const body = await pull(SELLER);

      for (const name of ['products', 'customer_relationships', 'orders', 'order_lines']) {
        expect(body.changes[name]?.created ?? []).toEqual([]);
      }
    });
  });

  it('applies the normal rules when the phone knows the pause (AC-3)', async () => {
    await seedMember('01', SELLER, ORG_A, 'SELLER', 'PAUSED');
    await pausedWhileOffline(SELLER, 3);

    const response = await push(SELLER, sales(1));

    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(0);
    expect(body.rejected.length).toBeGreaterThan(0);
    expect(body.rejected.every((r) => r.code === 'OUT_OF_SCOPE')).toBe(true);
    expect(await prisma.order.count({ where: { enteredById: SELLER } })).toBe(0);
    expect(await noticesOf(OWNER_A, 'sync.rights_changed')).toHaveLength(0);
  });

  it('judges a resumed seat by its role, and pulls the business again (AC-5)', async () => {
    await seedMember('01', SELLER, ORG_A, 'SELLER', 'PAUSED');
    await pausedWhileOffline(SELLER);
    await prisma.collaboration.updateMany({
      where: { personId: SELLER, organizationId: ORG_A },
      data: { status: 'ACTIVE' },
    });
    await prisma.person.update({ where: { id: SELLER }, data: { scopeVersion: 4 } });

    const pulled = await pull(SELLER);
    const response = await push(SELLER, sales(1));

    expect(pulled.changes['products']?.created.length).toBeGreaterThan(0);
    expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], accepted: 2 });
    expect(await prisma.order.count({ where: { enteredById: SELLER } })).toBe(1);
  });

  it('opens nothing for a paused manager beyond sales (AB-1, CWE-284)', async () => {
    await seedMember('02', MANAGER, ORG_A, 'MANAGER', 'PAUSED');
    await pausedWhileOffline(MANAGER);

    const response = await push(MANAGER, {
      orders: table({
        created: [
          {
            id: ORDER_B,
            customer_relationship_id: REL_B,
            status: 'DELIVERED',
            delivery_cost: 0,
            created_at: SOLD_AT,
          },
        ],
      }),
      ledger_entries: table({
        created: [
          { id: CREDIT_NOTE, customer_relationship_id: REL, kind: 'CREDIT_NOTE', amount: 1000 },
        ],
      }),
      customer_prices: table({
        updated: [
          { id: PRICE, customer_relationship_id: REL, product_variant_id: PRODUCT, price: 10 },
        ],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(0);
    expect(body.rejected).toHaveLength(3);
    expect(await prisma.order.count({ where: { id: ORDER_B } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { id: CREDIT_NOTE } })).toBe(0);
    expect(await noticesOf(OWNER_B, 'sync.rights_changed')).toHaveLength(0);
  });
});
