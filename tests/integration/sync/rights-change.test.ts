import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const MANAGER = '0199e019-0000-7000-8000-000000000001';
const DRIVER = '0199e019-0000-7000-8000-000000000003';
const OWNER_A = '0199e019-0000-7000-8000-000000000005';
const OWNER_B = '0199e019-0000-7000-8000-000000000006';
const CUSTOMER = '0199e019-0000-7000-8000-000000000007';
const ORG_A = '0199e019-0000-7000-8000-0000000000a1';
const ORG_B = '0199e019-0000-7000-8000-0000000000b1';
const REL = '0199e019-0000-7000-8000-0000000000c1';
const REL_B = '0199e019-0000-7000-8000-0000000000c2';
const NEW_REL = '0199e019-0000-7000-8000-0000000000c3';
const PRODUCT = '0199e019-0000-7000-8000-0000000000d1';
const PRODUCT_B = '0199e019-0000-7000-8000-0000000000d2';
const ORDER = '0199e019-0000-7000-8000-000000000501';
const ORDER_2 = '0199e019-0000-7000-8000-000000000502';
const ORDER_B = '0199e019-0000-7000-8000-000000000503';
const LINE = '0199e019-0000-7000-8000-000000000601';
const LINE_2 = '0199e019-0000-7000-8000-000000000602';
const DELIVERY = '0199e019-0000-7000-8000-000000000701';
const DELIVERY_2 = '0199e019-0000-7000-8000-000000000702';
const PAYMENT = '0199e019-0000-7000-8000-000000000802';
const PAYMENT_2 = '0199e019-0000-7000-8000-000000000803';
const CREDIT_NOTE = '0199e019-0000-7000-8000-000000000804';
const PRICE = '0199e019-0000-7000-8000-000000000901';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const SOLD_AT = Date.parse('2026-09-30T06:00:00.000Z');

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

/** A sale made and delivered offline: the order and its one line. */
const sale = (index: number) => {
  const suffix = String(index).padStart(3, '0');
  return {
    order: {
      id: `0199e019-0000-7000-8000-00000000a${suffix}`,
      customer_relationship_id: REL,
      status: 'DELIVERED',
      delivery_cost: 0,
      created_at: SOLD_AT,
    },
    line: {
      id: `0199e019-0000-7000-8000-00000000b${suffix}`,
      order_id: `0199e019-0000-7000-8000-00000000a${suffix}`,
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

const paymentRow = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id,
  customer_relationship_id: REL,
  kind: 'PAYMENT',
  amount,
  mode: 'CASH',
  occurred_at: Date.parse('2026-10-01T09:00:00.000Z'),
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
    devices[id] = `0199e019-0000-7000-8000-0000000009${phone.slice(-2)}`;
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
  status: 'ACTIVE' | 'REVOKED' = 'ACTIVE'
) {
  await prisma.collaboration.create({
    data: {
      id: `0199e019-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status,
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

/** The person's rights changed on the server (scope_version 3) and the phone saw only 2. */
async function rightsChangedWhileOffline(personId: string, seen = 2) {
  await prisma.person.update({ where: { id: personId }, data: { scopeVersion: 3 } });
  await prisma.device.update({
    where: { id: devices[personId] },
    data: { scopeVersionSeen: seen },
  });
}

async function seedOrder(id: string, lineId: string, status: 'CONFIRMED' | 'IN_DELIVERY') {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: REL,
      placedByParty: 'SUPPLIER',
      enteredById: OWNER_A,
      status,
      deliveryAddressApplied: 'Rue 1',
      deliveryCost: 0n,
      totalAmount: 6000n,
      createdAt: LONG_AGO,
      lines: {
        create: {
          id: lineId,
          productId: PRODUCT,
          labelApplied: 'Riz (sac)',
          quantity: '2',
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 6000n,
        },
      },
    },
  });
}

const seedDelivery = (id: string, orderId: string, driver: string) =>
  prisma.delivery.create({
    data: {
      id,
      orderId,
      assignedToId: driver,
      departedAt: new Date('2026-09-30T07:00:00.000Z'),
    },
  });

const noticesOf = (personId: string, event: string) =>
  prisma.notification.findMany({ where: { recipientId: personId, sourceEvent: event } });

describe('first push after a rights change (SYNC-019)', () => {
  beforeEach(async () => {
    await seedPerson(MANAGER, '+237600001901', 'Mia Manager');
    await seedPerson(DRIVER, '+237600001903', 'Dora Driver');
    await seedPerson(OWNER_A, '+237600001905', 'Olga Owner');
    await seedPerson(OWNER_B, '+237600001906', 'Otto Owner');
    await seedPerson(CUSTOMER, '+237600001907', 'Cora Customer', false);
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('05', OWNER_A, ORG_A, 'OWNER');
    await seedMember('06', OWNER_B, ORG_B, 'OWNER');
    await prisma.product.create({
      data: { id: PRODUCT, organizationId: ORG_A, name: 'Riz', unit: 'sac', price: 3000n },
    });
    await prisma.product.create({
      data: { id: PRODUCT_B, organizationId: ORG_B, name: 'Riz', unit: 'sac', price: 3000n },
    });
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
  });

  describe('a manager demoted to seller while offline', () => {
    beforeEach(async () => {
      await seedMember('01', MANAGER, ORG_A, 'SELLER');
      await rightsChangedWhileOffline(MANAGER);
    });

    it('keeps the 5 late sales and tells the owner once (AC-1, CM-29)', async () => {
      const response = await push(MANAGER, sales(5));

      expect(response.status).toBe(200);
      expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
      expect(await prisma.order.count({ where: { enteredById: MANAGER } })).toBe(5);
      const notices = await noticesOf(OWNER_A, 'sync.rights_changed');
      expect(notices).toHaveLength(1);
      expect(notices[0]?.content).toBe("5 opération(s) faites avec d'anciens droits");
      expect(notices[0]?.organizationId).toBe(ORG_A);
      expect(await noticesOf(OWNER_B, 'sync.rights_changed')).toHaveLength(0);
    });

    it('leaves scope_version_seen alone: only a full pull moves it (CM-03)', async () => {
      await push(MANAGER, sales(1));

      const device = await prisma.device.findUniqueOrThrow({ where: { id: devices[MANAGER] } });
      expect(device.scopeVersionSeen).toBe(2);
    });

    it('refuses the credit note and the price change, and tells the owner (AC-2, CM-03)', async () => {
      const response = await push(MANAGER, {
        ...sales(1),
        ledger_entries: table({
          created: [
            {
              id: CREDIT_NOTE,
              customer_relationship_id: REL,
              kind: 'CREDIT_NOTE',
              amount: 1000,
            },
          ],
        }),
        customer_prices: table({
          updated: [
            { id: PRICE, customer_relationship_id: REL, product_variant_id: PRODUCT, price: 10 },
          ],
        }),
      });

      const body = bodyOf<PushBody>(response);
      expect(body.rejected.map((r) => r.table).sort()).toEqual([
        'customer_prices',
        'ledger_entries',
      ]);
      expect(await prisma.ledgerEntry.count({ where: { id: CREDIT_NOTE } })).toBe(0);
      const told = await noticesOf(OWNER_A, 'sync.refused');
      expect(told).toHaveLength(1);
      expect(told[0]?.content).toContain('2 opération(s) non enregistrée(s)');
      expect(told[0]?.content).toContain('Mia Manager');
      expect(await noticesOf(MANAGER, 'sync.refused')).toHaveLength(1);
      expect(await noticesOf(OWNER_A, 'sync.rights_changed')).toHaveLength(1);
      expect(await noticesOf(OWNER_B, 'sync.refused')).toHaveLength(0);
    });
  });

  describe('a manager demoted to driver while offline', () => {
    it('keeps a late sale although a driver may not make one (AC-1, CM-29)', async () => {
      await seedMember('01', MANAGER, ORG_A, 'DRIVER');
      await rightsChangedWhileOffline(MANAGER);

      const response = await push(MANAGER, sales(1));

      expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
      expect(await prisma.order.findMany({ where: { enteredById: MANAGER } })).toMatchObject([
        { status: 'DELIVERED', deliveredById: MANAGER },
      ]);
      expect(await noticesOf(OWNER_A, 'sync.rights_changed')).toHaveLength(1);
    });
  });

  describe('a collaborator revoked while offline', () => {
    beforeEach(async () => {
      // The driver was ACTIVE when the deliveries began: the database takes no new one afterwards.
      await seedMember('03', DRIVER, ORG_A, 'DRIVER');
    });

    /** The owner revokes the driver, who is offline and learns nothing. */
    const revoke = async () => {
      await prisma.collaboration.updateMany({
        where: { personId: DRIVER, organizationId: ORG_A },
        data: { status: 'REVOKED' },
      });
      await rightsChangedWhileOffline(DRIVER);
    };

    it('keeps the 2 deliveries and their payments and reports them (AC-3, CM-29)', async () => {
      await seedOrder(ORDER, LINE, 'IN_DELIVERY');
      await seedOrder(ORDER_2, LINE_2, 'IN_DELIVERY');
      await seedDelivery(DELIVERY, ORDER, DRIVER);
      await seedDelivery(DELIVERY_2, ORDER_2, DRIVER);
      await revoke();

      const response = await push(DRIVER, {
        orders: table({
          updated: [
            { id: ORDER, status: 'DELIVERED' },
            { id: ORDER_2, status: 'DELIVERED' },
          ],
        }),
        ledger_entries: table({
          created: [
            paymentRow(PAYMENT, 6000, { order_id: ORDER }),
            paymentRow(PAYMENT_2, 6000, { order_id: ORDER_2 }),
          ],
        }),
      });

      expect(response.status).toBe(200);
      expect(bodyOf<PushBody>(response)).toMatchObject({ rejected: [], aside: 0 });
      const orders = await prisma.order.findMany({ where: { id: { in: [ORDER, ORDER_2] } } });
      expect(orders.map((o) => [o.status, o.deliveredById])).toEqual([
        ['DELIVERED', DRIVER],
        ['DELIVERED', DRIVER],
      ]);
      expect(await prisma.ledgerEntry.count({ where: { kind: 'PAYMENT' } })).toBe(2);
      const notices = await noticesOf(OWNER_A, 'sync.rights_changed');
      expect(notices).toHaveLength(1);
      expect(notices[0]?.content).toBe("4 opération(s) faites avec d'anciens droits");
    });

    it('keeps a standalone payment, but a new departure stays refused (AC-3, AB-1)', async () => {
      await seedOrder(ORDER, LINE, 'CONFIRMED');
      await revoke();

      const response = await push(DRIVER, {
        deliveries: table({
          created: [
            {
              id: DELIVERY,
              order_id: ORDER,
              departed_at: Date.parse('2026-09-30T08:00:00.000Z'),
            },
          ],
        }),
        ledger_entries: table({ created: [paymentRow(PAYMENT, 2500)] }),
      });

      expect(response.status).toBe(200);
      const body = bodyOf<PushBody>(response);
      expect(body.accepted).toBe(1);
      expect(body.rejected.map((r) => r.table)).toEqual(['deliveries']);
      expect(await prisma.delivery.count({ where: { id: DELIVERY } })).toBe(0);
      expect(await prisma.ledgerEntry.count({ where: { id: PAYMENT } })).toBe(1);
      const notices = await noticesOf(OWNER_A, 'sync.rights_changed');
      expect(notices[0]?.content).toBe("1 opération(s) faites avec d'anciens droits");
    });

    it('refuses a new customer, a cancellation and a note (AC-5)', async () => {
      await revoke();
      await seedOrder(ORDER, LINE, 'CONFIRMED');

      const response = await push(DRIVER, {
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
      const note = await push(DRIVER, {
        orders: table({ updated: [{ id: ORDER, supplier_note: 'Passer demain' }] }),
      });

      const body = bodyOf<PushBody>(response);
      expect(body.rejected.map((r) => r.table).sort()).toEqual([
        'customer_relationships',
        'orders',
      ]);
      expect(bodyOf<PushBody>(note).rejected).toHaveLength(1);
      expect(await prisma.customerRelationship.count({ where: { id: NEW_REL } })).toBe(0);
      const stored = await prisma.order.findUniqueOrThrow({ where: { id: ORDER } });
      expect(stored).toMatchObject({ status: 'CONFIRMED', supplierNote: null });
      expect(await noticesOf(OWNER_A, 'sync.rights_changed')).toHaveLength(0);
      expect((await noticesOf(OWNER_A, 'sync.refused')).length).toBeGreaterThan(0);
    });

    it('opens nothing but sales, deliveries and payments (AB-1, CWE-284)', async () => {
      await revoke();
      await seedOrder(ORDER, LINE, 'IN_DELIVERY');
      const another = sale(7);

      const response = await push(DRIVER, {
        orders: table({
          // A sale not delivered yet, and a delivery edit that carries a note along.
          created: [{ ...another.order, status: 'CONFIRMED' }],
          updated: [{ id: ORDER, status: 'DELIVERED', supplier_note: 'Offert' }],
        }),
        ledger_entries: table({
          created: [
            { id: CREDIT_NOTE, customer_relationship_id: REL, kind: 'REFUND', amount: 500 },
          ],
        }),
        expenses: table({ created: [{ id: PRICE }] }),
      });

      const body = bodyOf<PushBody>(response);
      expect(body.accepted).toBe(0);
      expect(body.rejected).toHaveLength(4);
      expect(await prisma.order.count({ where: { id: another.order.id } })).toBe(0);
      expect(await prisma.ledgerEntry.count()).toBe(0);
      const stored = await prisma.order.findUniqueOrThrow({ where: { id: ORDER } });
      expect(stored).toMatchObject({ status: 'IN_DELIVERY', supplierNote: null });
      expect(await noticesOf(OWNER_A, 'sync.rights_changed')).toHaveLength(0);
    });

    it('refuses a sale in an organization they never belonged to (AB-1, CWE-639)', async () => {
      await revoke();
      const response = await push(DRIVER, {
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
      });

      const body = bodyOf<PushBody>(response);
      expect(body.rejected).toHaveLength(1);
      expect(body.rejected[0]?.code).toBe('OUT_OF_SCOPE');
      expect(await prisma.order.count({ where: { id: ORDER_B } })).toBe(0);
      expect(await noticesOf(OWNER_B, 'sync.rights_changed')).toHaveLength(0);
    });
  });

  describe('a phone that knows the current rights', () => {
    it('applies the normal rules and sends no rights notice (AC-4)', async () => {
      await seedMember('01', MANAGER, ORG_A, 'SELLER');
      await seedMember('03', DRIVER, ORG_A, 'DRIVER', 'REVOKED');
      await rightsChangedWhileOffline(MANAGER, 3);
      await rightsChangedWhileOffline(DRIVER, 3);

      const accepted = await push(MANAGER, sales(2));
      const refused = await push(DRIVER, {
        orders: table({
          created: [{ ...sale(9).order, id: ORDER_2 }],
        }),
      });

      expect(bodyOf<PushBody>(accepted)).toMatchObject({ rejected: [], accepted: 4 });
      expect(bodyOf<PushBody>(refused).rejected).toHaveLength(1);
      expect(await prisma.order.count({ where: { id: ORDER_2 } })).toBe(0);
      expect(await noticesOf(OWNER_A, 'sync.rights_changed')).toHaveLength(0);
    });
  });
});
