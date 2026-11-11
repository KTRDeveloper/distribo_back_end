import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { resolveReception } from '../../../src/modules/order/order.calculations.js';
import { prisma } from '../../setup.js';

const SUP_OWNER = '0199c037-0000-7000-8000-000000000001';
const SELLER = '0199c037-0000-7000-8000-000000000002';
const CUSTOMER = '0199c037-0000-7000-8000-000000000003';
const BIZ_MANAGER = '0199c037-0000-7000-8000-000000000004';
const BIZ_OWNER = '0199c037-0000-7000-8000-000000000005';

const SUPPLIER = '0199c037-0000-7000-8000-0000000000a1';
const BUSINESS = '0199c037-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c037-0000-7000-8000-0000000000b1';
const ORDER_ID = '0199c037-0000-7000-8000-0000000000c1';
const LINE_1 = '0199c037-0000-7000-8000-0000000000d1';
const LINE_2 = '0199c037-0000-7000-8000-0000000000d2';
const REL = '0199c037-0000-7000-8000-0000000000e1';
const GESTURE = '0199c037-0000-7000-8000-0000000000f1';

const REG = new Date('2026-01-01T00:00:00.000Z');
const USUAL = 'Rue 12, Akwa';

type OrderBody = {
  reception_mode: string | null;
  delivery_address_applied: string | null;
};

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c037-0000-7000-8000-0000000001${n}0`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

const line = { id: LINE_1, product_variant_id: PRODUCT, quantity: '2' };

function place(extra: Record<string, unknown> = {}) {
  return createAuthenticatedRequest(app, CUSTOMER)
    .post('/api/v1/orders')
    .send({ id: ORDER_ID, supplier_organization_id: SUPPLIER, lines: [line], ...extra });
}

function purchase(extra: Record<string, unknown> = {}) {
  return createAuthenticatedRequest(app, BIZ_MANAGER)
    .post(`/api/v1/organizations/${BUSINESS}/purchases`)
    .send({ id: ORDER_ID, supplier_organization_id: SUPPLIER, lines: [line], ...extra });
}

function enter(extra: Record<string, unknown> = {}) {
  return createAuthenticatedRequest(app, SELLER)
    .post(`/api/v1/organizations/${SUPPLIER}/orders`)
    .send({ id: ORDER_ID, customer_relationship_id: REL, lines: [line], ...extra });
}

function edit(extra: Record<string, unknown>) {
  return createAuthenticatedRequest(app, SELLER)
    .patch(`/api/v1/organizations/${SUPPLIER}/orders/${ORDER_ID}`)
    .send({ id: GESTURE, ...extra });
}

async function seedOrder(mode: 'DELIVERY' | 'PICKUP' | null, address: string | null) {
  await prisma.order.create({
    data: {
      id: ORDER_ID,
      customerRelationshipId: REL,
      enteredById: SELLER,
      placedByParty: 'SUPPLIER',
      status: 'CONFIRMED',
      receptionMode: mode,
      deliveryAddressApplied: address,
      totalAmount: 6000n,
      lines: {
        create: {
          id: LINE_2,
          productVariantId: PRODUCT,
          labelApplied: 'Rice (sack)',
          quantity: '2',
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 6000n,
        },
      },
    },
  });
}

async function storedOrder() {
  return prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
}

beforeEach(async () => {
  await seedPerson(SUP_OWNER, '+237600037001');
  await seedPerson(SELLER, '+237600037002');
  await seedPerson(CUSTOMER, '+237600037003');
  await seedPerson(BIZ_MANAGER, '+237600037004');
  await seedPerson(BIZ_OWNER, '+237600037005');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: BUSINESS, name: 'Business', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, SUP_OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 2);
  await seedMember(BUSINESS, BIZ_OWNER, 'OWNER', 4);
  await seedMember(BUSINESS, BIZ_MANAGER, 'MANAGER', 3);
  await seedProduct(prisma, {
    id: PRODUCT,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 3000n,
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: SUP_OWNER,
      status: 'ACTIVE',
      deliveryAddress: USUAL,
      creditLimit: 0n,
    },
  });
});

describe('ORD-037 orders are placed and edited as delivery or pickup', () => {
  describe('place modes (AC-1, C-60)', () => {
    it('PICKUP without address stores no address', async () => {
      const res = await place({ reception_mode: 'PICKUP' });
      expect(res.status).toBe(201);
      expect(bodyOf<OrderBody>(res)).toMatchObject({
        reception_mode: 'PICKUP',
        delivery_address_applied: null,
      });
      const order = await storedOrder();
      expect(order.receptionMode).toBe('PICKUP');
      expect(order.deliveryAddressApplied).toBeNull();
    });

    it('PICKUP with an address is a 400 and nothing is stored', async () => {
      const res = await place({ reception_mode: 'PICKUP', delivery_address: 'Rue 7, Bonapriso' });
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.order.count()).toBe(0);
    });

    it('DELIVERY without address applies the usual address', async () => {
      const res = await place({ reception_mode: 'DELIVERY' });
      expect(res.status).toBe(201);
      expect(bodyOf<OrderBody>(res)).toMatchObject({
        reception_mode: 'DELIVERY',
        delivery_address_applied: USUAL,
      });
    });

    it('no reception_mode keeps it null and applies the usual address', async () => {
      const res = await place();
      expect(res.status).toBe(201);
      expect(bodyOf<OrderBody>(res)).toMatchObject({
        reception_mode: null,
        delivery_address_applied: USUAL,
      });
    });
  });

  describe('other routes (AC-2, C-60)', () => {
    it('a manager purchase with PICKUP stores no address', async () => {
      const res = await purchase({ reception_mode: 'PICKUP' });
      expect(res.status).toBe(201);
      expect(bodyOf<OrderBody>(res)).toMatchObject({
        reception_mode: 'PICKUP',
        delivery_address_applied: null,
      });
      expect((await storedOrder()).deliveryAddressApplied).toBeNull();
    });

    it('a seller entry with PICKUP stores no address and refuses an address', async () => {
      const refused = await enter({ reception_mode: 'PICKUP', delivery_address: 'Rue 7' });
      expect(refused.status).toBe(400);
      expect(await prisma.order.count()).toBe(0);
      const res = await enter({ reception_mode: 'PICKUP' });
      expect(res.status).toBe(201);
      expect(bodyOf<OrderBody>(res)).toMatchObject({
        reception_mode: 'PICKUP',
        delivery_address_applied: null,
      });
      expect((await storedOrder()).receptionMode).toBe('PICKUP');
    });
  });

  describe('edit', () => {
    it('AC-3 editing to PICKUP clears the address', async () => {
      await seedOrder('DELIVERY', USUAL);
      const res = await edit({ reception_mode: 'PICKUP' });
      expect(res.status).toBe(200);
      expect(bodyOf<OrderBody>(res)).toMatchObject({
        reception_mode: 'PICKUP',
        delivery_address_applied: null,
      });
      const order = await storedOrder();
      expect(order.receptionMode).toBe('PICKUP');
      expect(order.deliveryAddressApplied).toBeNull();
    });

    it('AC-4 editing back to DELIVERY applies the usual address', async () => {
      await seedOrder('PICKUP', null);
      const res = await edit({ reception_mode: 'DELIVERY' });
      expect(res.status).toBe(200);
      const order = await storedOrder();
      expect(order.receptionMode).toBe('DELIVERY');
      expect(order.deliveryAddressApplied).toBe(USUAL);
    });

    it('AC-4 an address sent with DELIVERY wins over the usual one', async () => {
      await seedOrder('PICKUP', null);
      const res = await edit({ reception_mode: 'DELIVERY', delivery_address: 'Rue 7' });
      expect(res.status).toBe(200);
      expect((await storedOrder()).deliveryAddressApplied).toBe('Rue 7');
    });

    it('AC-5 an address alone on a PICKUP order is a 400 and nothing changes', async () => {
      await seedOrder('PICKUP', null);
      const res = await edit({ delivery_address: 'Rue 12, Akwa' });
      expect(res.status).toBe(400);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
      const order = await storedOrder();
      expect(order.receptionMode).toBe('PICKUP');
      expect(order.deliveryAddressApplied).toBeNull();
    });

    it('an edit without reception_mode leaves the mode unchanged', async () => {
      await seedOrder('DELIVERY', USUAL);
      const res = await edit({ customer_note: 'Hello' });
      expect(res.status).toBe(200);
      const order = await storedOrder();
      expect(order.receptionMode).toBe('DELIVERY');
      expect(order.deliveryAddressApplied).toBe(USUAL);
    });

    it('reception_mode alone is a valid edit and an unstated order shows null', async () => {
      await seedOrder(null, USUAL);
      const res = await edit({ delivery_address: 'Rue 7' });
      expect(res.status).toBe(200);
      expect(bodyOf<OrderBody>(res)).toMatchObject({
        reception_mode: null,
        delivery_address_applied: 'Rue 7',
      });
    });
  });

  describe('unknown mode (AB-1)', () => {
    it('rejects SHIP on every route without echoing the value', async () => {
      await seedOrder('DELIVERY', USUAL);
      for (const res of [
        await place({ reception_mode: 'SHIP' }),
        await purchase({ reception_mode: 'SHIP' }),
        await enter({ reception_mode: 'SHIP' }),
        await edit({ reception_mode: 'SHIP' }),
      ]) {
        expect(res.status).toBe(400);
        const error = bodyOf<ErrorBody>(res).error;
        expect(error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(error.details)).toContain('reception_mode');
        expect(JSON.stringify(res.body)).not.toContain('SHIP');
      }
    });
  });

  describe('resolveReception', () => {
    it('creation: PICKUP drops the usual address, absent mode keeps it', () => {
      expect(resolveReception({ mode: 'PICKUP' }, null, USUAL)).toEqual({
        receptionMode: 'PICKUP',
        deliveryAddressApplied: null,
      });
      expect(resolveReception({}, null, USUAL)).toEqual({
        receptionMode: null,
        deliveryAddressApplied: USUAL,
      });
    });

    it('edit: nothing sent changes nothing', () => {
      expect(resolveReception({}, { mode: 'DELIVERY', address: 'Rue 7' }, USUAL)).toEqual({
        receptionMode: 'DELIVERY',
        deliveryAddressApplied: 'Rue 7',
      });
    });
  });
});
