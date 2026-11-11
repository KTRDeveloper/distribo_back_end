import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { assertExpectedTotal } from '../../../src/modules/order/order.service.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const SUP_OWNER = '0199c038-0000-7000-8000-000000000001';
const CUSTOMER = '0199c038-0000-7000-8000-000000000011';
const BIZ_OWNER = '0199c038-0000-7000-8000-000000000012';
const SUPPLIER = '0199c038-0000-7000-8000-0000000000a1';
const BUSINESS = '0199c038-0000-7000-8000-0000000000a2';
const PRODUCT_A = '0199c038-0000-7000-8000-0000000000b1';
const PRODUCT_B = '0199c038-0000-7000-8000-0000000000b2';
const ORDER_1 = '0199c038-0000-7000-8000-0000000000c1';
const ORDER_2 = '0199c038-0000-7000-8000-0000000000c2';
const LINE_1 = '0199c038-0000-7000-8000-0000000000d1';
const LINE_2 = '0199c038-0000-7000-8000-0000000000d2';
const LINE_3 = '0199c038-0000-7000-8000-0000000000d3';
const LINE_4 = '0199c038-0000-7000-8000-0000000000d4';
const REG = new Date('2026-01-01T00:00:00.000Z');

/** Server total of the default lines: 4 x 3000 + 1 x 500. */
const TOTAL = 12500;

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

const body = (over: Record<string, unknown> = {}) => ({
  id: ORDER_1,
  supplier_organization_id: SUPPLIER,
  lines: [
    { id: LINE_1, product_variant_id: PRODUCT_A, quantity: '4' },
    { id: LINE_2, product_variant_id: PRODUCT_B, quantity: 1 },
  ],
  ...over,
});

const place = (payload: unknown) =>
  createAuthenticatedRequest(app, CUSTOMER)
    .post('/api/v1/orders')
    .send(payload as object);

const purchase = (payload: unknown) =>
  createAuthenticatedRequest(app, BIZ_OWNER)
    .post(`/api/v1/organizations/${BUSINESS}/purchases`)
    .send(payload as object);

async function stored() {
  return {
    orders: await prisma.order.count(),
    lines: await prisma.orderLine.count(),
    relationships: await prisma.customerRelationship.count(),
    notifications: await prisma.notification.count(),
  };
}

const NOTHING = { orders: 0, lines: 0, relationships: 0, notifications: 0 };

beforeEach(async () => {
  await seedPerson(SUP_OWNER, '+237600038001');
  await seedPerson(CUSTOMER, '+237600038011');
  await seedPerson(BIZ_OWNER, '+237600038012');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: BUSINESS, name: 'Business', status: 'ACTIVE' } });
  await prisma.collaboration.create({
    data: {
      id: '0199c038-0000-7000-8000-000000000101',
      personId: SUP_OWNER,
      organizationId: SUPPLIER,
      role: 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await prisma.collaboration.create({
    data: {
      id: '0199c038-0000-7000-8000-000000000102',
      personId: BIZ_OWNER,
      organizationId: BUSINESS,
      role: 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await seedProduct(prisma, {
    id: PRODUCT_A,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: PRODUCT_B,
    organizationId: SUPPLIER,
    name: 'Salt',
    unit: 'kg',
    price: 500n,
  });
});

describe('ORD-038 an order is refused when its total changed', () => {
  describe('place (AC-1, CM-16)', () => {
    it('accepts the total the customer saw', async () => {
      const res = await place(body({ expected_total: TOTAL }));
      expect(res.status).toBe(201);
      expect(bodyOf<{ total_amount: number }>(res).total_amount).toBe(TOTAL);
    });

    it('accepts an absent expected_total', async () => {
      expect((await place(body())).status).toBe(201);
    });

    it('refuses a different total with the server total and stores nothing', async () => {
      const res = await place(body({ expected_total: 12000 }));
      expect(res.status).toBe(409);
      const error = bodyOf<ErrorBody>(res).error;
      expect(error.code).toBe('TOTAL_CHANGED');
      expect(error.message).toBe('The total changed.');
      expect(error.details).toEqual({ total: TOTAL });
      expect(await stored()).toEqual(NOTHING);
    });

    it('replays the 409 for the same id', async () => {
      await place(body({ expected_total: 12000 }));
      const again = await place(body({ expected_total: TOTAL }));
      expect(again.status).toBe(409);
      expect(again.headers['idempotent-replay']).toBe('true');
    });
  });

  describe('purchase (AC-2)', () => {
    it('refuses a different total and stores nothing', async () => {
      const res = await purchase(body({ expected_total: 1 }));
      expect(res.status).toBe(409);
      expect(bodyOf<ErrorBody>(res).error.code).toBe('TOTAL_CHANGED');
      expect(bodyOf<ErrorBody>(res).error.details).toEqual({ total: TOTAL });
      expect(await stored()).toEqual(NOTHING);
    });

    it('accepts the server total', async () => {
      expect((await purchase(body({ expected_total: TOTAL }))).status).toBe(201);
    });
  });

  describe('new id (AC-3)', () => {
    it('accepts the same lines with a new id and the server total', async () => {
      const first = await place(body({ expected_total: 12000 }));
      const details = bodyOf<{ error: { details: { total: number } } }>(first).error.details;
      const second = await place(
        body({
          id: ORDER_2,
          lines: [
            { id: LINE_3, product_variant_id: PRODUCT_A, quantity: '4' },
            { id: LINE_4, product_variant_id: PRODUCT_B, quantity: 1 },
          ],
          expected_total: details.total,
        })
      );
      expect(second.status).toBe(201);
    });
  });

  describe('lower total (AB-1, WSTG-BUSL-01)', () => {
    it('refuses expected_total 1 and keeps server prices', async () => {
      const res = await place(body({ expected_total: 1 }));
      expect(res.status).toBe(409);
      expect(bodyOf<ErrorBody>(res).error.details).toEqual({ total: TOTAL });
      expect(await prisma.orderLine.count()).toBe(0);
    });
  });

  describe('malformed (AB-2, WSTG-INPV-20)', () => {
    it.each([[-5], ['12500'], [12500.5]])('refuses expected_total %j with 400', async (value) => {
      for (const send of [place, purchase]) {
        const res = await send(body({ expected_total: value }));
        expect(res.status).toBe(400);
        expect(bodyOf<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
      }
      expect(await stored()).toEqual(NOTHING);
    });

    it('refuses a value above the safe integer range', async () => {
      const res = await place(body({ expected_total: 9007199254740992 }));
      expect(res.status).toBe(400);
    });
  });

  describe('assertExpectedTotal', () => {
    it('passes when absent or equal and throws TOTAL_CHANGED otherwise', () => {
      expect(() => assertExpectedTotal(12500n, undefined)).not.toThrow();
      expect(() => assertExpectedTotal(12500n, 12500)).not.toThrow();
      expect(() => assertExpectedTotal(12500n, 0)).toThrowError('The total changed.');
    });
  });
});
