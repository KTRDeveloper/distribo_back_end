import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f1-0000-7000-8000-000000000001';
const SELLER = '0199c0f1-0000-7000-8000-000000000003';
const CUSTOMER = '0199c0f1-0000-7000-8000-000000000005';
const MANAGER = '0199c0f1-0000-7000-8000-000000000006';
const BIZ_OWNER = '0199c0f1-0000-7000-8000-000000000007';

const SUPPLIER = '0199c0f1-0000-7000-8000-0000000000a1';
const BUSINESS = '0199c0f1-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c0f1-0000-7000-8000-0000000000b1';
const VARIANT = '0199c0f1-0000-7000-8000-0000000000b2';
const REL = '0199c0f1-0000-7000-8000-0000000000e1';
const COUNTER = '0199c0f1-0000-7000-8000-0000000000e2';

const gesture = (n: number) => `0199c0f1-0000-7000-8000-0000000005${n}0`;
const lineId = (n: number) => `0199c0f1-0000-7000-8000-0000000002${n}0`;

const REG = new Date('2026-01-01T00:00:00.000Z');

type LineBody = Record<string, unknown> & { id: string; product_variant_id?: string };
type OrderBody = { id: string; lines: LineBody[] };
type SaleBody = { order: OrderBody };
type Page = { items: OrderBody[] };

const line = (n: number, extra: Record<string, unknown> = {}) => ({
  id: lineId(n),
  product_variant_id: VARIANT,
  quantity: '1',
  ...extra,
});

const enterBody = (n: number, lines: unknown[] = [line(n)]) => ({
  id: gesture(n),
  customer_relationship_id: REL,
  lines,
});

const enter = (body: unknown) =>
  createAuthenticatedRequest(app, SELLER)
    .post(`/api/v1/organizations/${SUPPLIER}/orders`)
    .send(body as object);

const place = (body: unknown) =>
  createAuthenticatedRequest(app, CUSTOMER)
    .post('/api/v1/orders')
    .send(body as object);

const purchase = (body: unknown) =>
  createAuthenticatedRequest(app, MANAGER)
    .post(`/api/v1/organizations/${BUSINESS}/purchases`)
    .send(body as object);

const edit = (orderId: string, body: unknown) =>
  createAuthenticatedRequest(app, SELLER)
    .patch(`/api/v1/organizations/${SUPPLIER}/orders/${orderId}`)
    .send(body as object);

const sell = (body: unknown) =>
  createAuthenticatedRequest(app, SELLER)
    .post(`/api/v1/organizations/${SUPPLIER}/counters/${COUNTER}/sales`)
    .send(body as object);

const placeBody = (n: number, lines: unknown[] = [line(n)]) => ({
  id: gesture(n),
  supplier_organization_id: SUPPLIER,
  lines,
});

const saleBody = (n: number, lines: unknown[] = [line(n)]) => ({
  id: gesture(n),
  sale_entry_id: `0199c0f1-0000-7000-8000-0000000006${n}0`,
  payment_entry_id: `0199c0f1-0000-7000-8000-0000000007${n}0`,
  lines,
  collected_amount: 3000,
  mode: 'CASH',
});

function expectVariantField(lines: LineBody[]) {
  expect(lines.length).toBeGreaterThan(0);
  for (const each of lines) {
    expect(each.product_variant_id).toBe(VARIANT);
    expect(each).not.toHaveProperty('product_id');
  }
}

async function nothingStored() {
  expect(await prisma.order.count()).toBe(0);
  expect(await prisma.orderLine.count()).toBe(0);
}

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

beforeEach(async () => {
  await seedPerson(OWNER, '+237600028001');
  await seedPerson(SELLER, '+237600028003');
  await seedPerson(CUSTOMER, '+237600028005');
  await seedPerson(MANAGER, '+237600028006');
  await seedPerson(BIZ_OWNER, '+237600028007');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: BUSINESS, name: 'Business', status: 'ACTIVE' } });
  for (const [n, personId, orgId, role] of [
    [1, OWNER, SUPPLIER, 'OWNER'],
    [3, SELLER, SUPPLIER, 'SELLER'],
    [7, BIZ_OWNER, BUSINESS, 'OWNER'],
    [6, MANAGER, BUSINESS, 'MANAGER'],
  ] as const) {
    await prisma.collaboration.create({
      data: {
        id: `0199c0f1-0000-7000-8000-0000000001${n}0`,
        personId,
        organizationId: orgId,
        role,
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  }
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name)
    VALUES (${PRODUCT}::uuid, ${SUPPLIER}::uuid, 'T-shirt')
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price)
    VALUES (${VARIANT}::uuid, ${PRODUCT}::uuid, ${SUPPLIER}::uuid, 'Rouge', 'pièce', 3000)
  `;
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
      deliveryAddress: 'Rue 1',
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: COUNTER,
      supplierOrganizationId: SUPPLIER,
      customerLabel: 'Counter',
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 0n,
    },
  });
});

describe('ORD-028 order lines name their variant', () => {
  describe('requests (AC-1, C-20)', () => {
    it('a customer places an order', async () => {
      const response = await place(placeBody(1));

      expect(response.status).toBe(201);
      expectVariantField(bodyOf<OrderBody>(response).lines);
    });

    it('a manager orders from a supplier', async () => {
      const response = await purchase(placeBody(2));

      expect(response.status).toBe(201);
      expectVariantField(bodyOf<OrderBody>(response).lines);
    });

    it('a seller enters an order', async () => {
      const response = await enter(enterBody(3));

      expect(response.status).toBe(201);
      const lines = bodyOf<OrderBody>(response).lines;
      expectVariantField(lines);
      expect(lines[0]).toMatchObject({ reference_price: 3000, unit_price_applied: 3000 });
    });

    it('a seller edits an order', async () => {
      await enter(enterBody(4));

      const response = await edit(gesture(4), {
        id: gesture(5),
        lines: [line(5, { quantity: '2' })],
      });

      expect(response.status).toBe(200);
      const lines = bodyOf<OrderBody>(response).lines;
      expectVariantField(lines);
      expect(lines[0]).toMatchObject({ amount: 6000 });
    });

    it('a seller sells at the counter', async () => {
      const response = await sell(saleBody(6));

      expect(response.status).toBe(201);
      expectVariantField(bodyOf<SaleBody>(response).order.lines);
    });
  });

  describe('reads (AC-2)', () => {
    it('both parties list and open an order with product_variant_id', async () => {
      await enter(enterBody(1));
      const orderId = gesture(1);

      const supplierList = await createAuthenticatedRequest(app, SELLER).get(
        `/api/v1/organizations/${SUPPLIER}/orders`
      );
      const supplierOne = await createAuthenticatedRequest(app, SELLER).get(
        `/api/v1/organizations/${SUPPLIER}/orders/${orderId}`
      );
      const customerList = await createAuthenticatedRequest(app, CUSTOMER).get('/api/v1/orders');
      const customerOne = await createAuthenticatedRequest(app, CUSTOMER).get(
        `/api/v1/orders/${orderId}`
      );

      for (const response of [supplierList, supplierOne, customerList, customerOne]) {
        expect(response.status).toBe(200);
      }
      expectVariantField(bodyOf<Page>(supplierList).items[0].lines);
      expectVariantField(bodyOf<OrderBody>(supplierOne).lines);
      expectVariantField(bodyOf<Page>(customerList).items[0].lines);
      expectVariantField(bodyOf<OrderBody>(customerOne).lines);
    });
  });

  describe('the old name is gone (AC-3)', () => {
    const oldLine = (n: number) => ({ id: lineId(n), product_id: VARIANT, quantity: '1' });

    it.each([
      ['place', () => place(placeBody(1, [oldLine(1)]))],
      ['purchase', () => purchase(placeBody(2, [oldLine(2)]))],
      ['enter', () => enter(enterBody(3, [oldLine(3)]))],
      ['counter sale', () => sell(saleBody(4, [oldLine(4)]))],
    ])('refuses product_id on %s with 400 and stores nothing', async (_name, send) => {
      const response = await send();

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      await nothingStored();
    });

    it('refuses product_id on edit with 400 and keeps the order', async () => {
      await enter(enterBody(5));

      const response = await edit(gesture(5), { id: gesture(6), lines: [oldLine(6)] });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      const stored = await prisma.orderLine.findMany();
      expect(stored.map((each) => each.id)).toEqual([lineId(5)]);
    });

    it('refuses a line carrying both names', async () => {
      const response = await place(placeBody(7, [line(7, { product_id: PRODUCT })]));

      expect(response.status).toBe(400);
      await nothingStored();
    });

    it('documents product_variant_id for the lines and no product_id', async () => {
      const response = await request(app).get('/api/v1/docs/openapi.json');

      expect(response.status).toBe(200);
      const text = JSON.stringify(
        Object.fromEntries(
          Object.entries((response.body as { paths: Record<string, unknown> }).paths).filter(
            ([path]) =>
              path.endsWith('/orders') ||
              path.endsWith('/purchases') ||
              path.includes('/orders/') ||
              path.includes('/purchases/') ||
              path.endsWith('/sales')
          )
        )
      );
      expect(text).toContain('product_variant_id');
      expect(text).not.toContain('product_id');
    });
  });

  describe('fields the server fixes (AB-1, CWE-915)', () => {
    it.each([
      ['product_id', PRODUCT],
      ['label_applied', 'Free'],
      ['reference_price', 1],
      ['amount', 1],
    ])('refuses a line carrying %s on every gesture and stores nothing', async (field, value) => {
      const extra = { [field]: value };
      const responses = [
        await place(placeBody(1, [line(1, extra)])),
        await purchase(placeBody(2, [line(2, extra)])),
        await enter(enterBody(3, [line(3, extra)])),
        await sell(saleBody(4, [line(4, extra)])),
      ];

      for (const response of responses) {
        expect(response.status).toBe(400);
        expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      }
      await nothingStored();
    });
  });
});
