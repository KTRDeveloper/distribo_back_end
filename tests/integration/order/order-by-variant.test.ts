import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c027-0000-7000-8000-000000000001';
const SELLER = '0199c027-0000-7000-8000-000000000003';
const CUSTOMER = '0199c027-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c027-0000-7000-8000-000000000006';

const SUPPLIER = '0199c027-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c027-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c027-0000-7000-8000-0000000000b1';
const VARIANT = '0199c027-0000-7000-8000-0000000000b2';
const PRODUCT_PAUSED = '0199c027-0000-7000-8000-0000000000b3';
const VARIANT_PAUSED = '0199c027-0000-7000-8000-0000000000b4';
const VARIANT_OFF = '0199c027-0000-7000-8000-0000000000b5';
const VARIANT_DELETED = '0199c027-0000-7000-8000-0000000000b6';
const FOREIGN_PRODUCT = '0199c027-0000-7000-8000-0000000000b7';
const FOREIGN_VARIANT = '0199c027-0000-7000-8000-0000000000b8';
const UNKNOWN = '0199c027-0000-7000-8000-0000000000ff';
const REL = '0199c027-0000-7000-8000-0000000000e1';
const ORDER_ID = '0199c027-0000-7000-8000-0000000000c1';
const LINE_ID = '0199c027-0000-7000-8000-0000000000d1';
const PRICE_ID = '0199c027-0000-7000-8000-0000000000f1';

const REG = new Date('2026-01-01T00:00:00.000Z');

type LineBody = {
  id: string;
  label_applied: string;
  reference_price: number;
  unit_price_applied: number;
  amount: number;
};
type OrderBody = { id: string; lines: LineBody[] };

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

async function seedProduct(id: string, orgId: string, name: string, paused = false) {
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price, paused_at)
    VALUES (${id}::uuid, ${orgId}::uuid, ${name}, '', 3000,
      ${paused ? new Date('2026-01-02T00:00:00.000Z') : null}::timestamptz)
  `;
}

async function seedVariant(
  id: string,
  productId: string,
  orgId: string,
  options: { name?: string | null; min?: string | null; status?: string; deleted?: boolean } = {}
) {
  await prisma.$executeRaw`
    INSERT INTO product_variants
      (id, product_id, organization_id, name, unit, price, min_order_quantity, status, deleted_at)
    VALUES (${id}::uuid, ${productId}::uuid, ${orgId}::uuid, ${options.name ?? null}, 'pièce', 3000,
      ${options.min ?? null}::numeric, ${options.status ?? 'ACTIVE'}::text::public."ProductStatus",
      ${options.deleted ? new Date('2026-01-02T00:00:00.000Z') : null}::timestamptz)
  `;
}

function enter(variantId: string, quantity: number | string, price?: number) {
  return createAuthenticatedRequest(app, SELLER)
    .post(`/api/v1/organizations/${SUPPLIER}/orders`)
    .send({
      id: ORDER_ID,
      customer_relationship_id: REL,
      lines: [
        {
          id: LINE_ID,
          product_variant_id: variantId,
          quantity,
          ...(price === undefined ? {} : { unit_price_applied: price }),
        },
      ],
    });
}

function place(variantId: string, quantity: number | string) {
  return createAuthenticatedRequest(app, CUSTOMER)
    .post('/api/v1/orders')
    .send({
      id: ORDER_ID,
      supplier_organization_id: SUPPLIER,
      lines: [{ id: LINE_ID, product_variant_id: variantId, quantity }],
    });
}

async function nothingStored() {
  expect(await prisma.order.count()).toBe(0);
  expect(await prisma.orderLine.count()).toBe(0);
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600027001');
  await seedPerson(SELLER, '+237600027003');
  await seedPerson(CUSTOMER, '+237600027005');
  await seedPerson(OTHER_OWNER, '+237600027006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  for (const [n, personId, orgId, role] of [
    [1, OWNER, SUPPLIER, 'OWNER'],
    [3, SELLER, SUPPLIER, 'SELLER'],
    [5, OTHER_OWNER, OTHER_ORG, 'OWNER'],
  ] as const) {
    await prisma.collaboration.create({
      data: {
        id: `0199c027-0000-7000-8000-0000000001${n}0`,
        personId,
        organizationId: orgId,
        role,
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  }
  await seedProduct(PRODUCT, SUPPLIER, 'T-shirt');
  await seedVariant(VARIANT, PRODUCT, SUPPLIER, { name: 'Rouge / L', min: '5' });
  await seedVariant(VARIANT_OFF, PRODUCT, SUPPLIER, { name: 'Bleu', status: 'INACTIVE' });
  await seedVariant(VARIANT_DELETED, PRODUCT, SUPPLIER, { name: 'Vert', deleted: true });
  await seedProduct(PRODUCT_PAUSED, SUPPLIER, 'Casquette', true);
  await seedVariant(VARIANT_PAUSED, PRODUCT_PAUSED, SUPPLIER, { name: 'Noire' });
  await seedProduct(FOREIGN_PRODUCT, OTHER_ORG, 'Chaussure');
  await seedVariant(FOREIGN_VARIANT, FOREIGN_PRODUCT, OTHER_ORG, { name: '42' });
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
});

describe('ORD-027 order lines are priced from the variant', () => {
  it('labels, links and prices the line from the variant (AC-1, C-20, CM-11)', async () => {
    await prisma.customerPrice.create({
      data: {
        id: PRICE_ID,
        customerRelationshipId: REL,
        productId: PRODUCT,
        productVariantId: VARIANT,
        price: 2800n,
        setById: OWNER,
      },
    });

    const response = await enter(VARIANT, 5, 2500);

    expect(response.status).toBe(201);
    expect(bodyOf<OrderBody>(response).lines[0]).toMatchObject({
      label_applied: 'T-shirt — Rouge / L (pièce)',
      reference_price: 2800,
      unit_price_applied: 2500,
      amount: 12500,
    });
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: LINE_ID } });
    expect(line).toMatchObject({
      productId: PRODUCT,
      productVariantId: VARIANT,
      labelApplied: 'T-shirt — Rouge / L (pièce)',
      referencePrice: 2800n,
      unitPriceApplied: 2500n,
    });
    expect(line.priceSetById).toBe(SELLER);
  });

  it('prices a customer order at the variant price when nothing is negotiated', async () => {
    const response = await place(VARIANT, '5');

    expect(response.status).toBe(201);
    expect(bodyOf<OrderBody>(response).lines[0]).toMatchObject({
      label_applied: 'T-shirt — Rouge / L (pièce)',
      reference_price: 3000,
      unit_price_applied: 3000,
      amount: 15000,
    });
  });

  describe('minimum quantity of the variant (AC-2, C-15)', () => {
    it('refuses a customer below the minimum with 400', async () => {
      const response = await place(VARIANT, 4);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      await nothingStored();
    });

    it('accepts the minimum itself for a customer', async () => {
      expect((await place(VARIANT, 5)).status).toBe(201);
    });

    it('accepts a seller below the minimum', async () => {
      expect((await enter(VARIANT, 4)).status).toBe(201);
    });
  });

  describe('variants that cannot be ordered (AC-3, C-15)', () => {
    const cases: Array<[string, string]> = [
      ['an INACTIVE variant', VARIANT_OFF],
      ['a deleted variant', VARIANT_DELETED],
      ['a variant of a paused product', VARIANT_PAUSED],
      ['an id that does not exist', UNKNOWN],
    ];

    it.each(cases)('answers 404 for %s, with the same message, and stores nothing', async (_n, id) => {
      const byCustomer = await place(id, 10);
      const bySeller = await enter(id, 10);

      expect(byCustomer.status).toBe(404);
      expect(bySeller.status).toBe(404);
      expect(bodyOf<ErrorBody>(byCustomer).error).toMatchObject({ code: 'NOT_FOUND' });
      expect(bodyOf<ErrorBody>(bySeller).error.message).toBe(
        bodyOf<ErrorBody>(byCustomer).error.message
      );
      await nothingStored();
    });
  });

  describe('another supplier (AB-1, CWE-639)', () => {
    it('answers 404 to a customer naming a variant of another business', async () => {
      const response = await place(FOREIGN_VARIANT, 10);

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      await nothingStored();
    });

    it('answers 404 to a seller naming a variant of another business', async () => {
      const response = await enter(FOREIGN_VARIANT, 10);

      expect(response.status).toBe(404);
      await nothingStored();
    });
  });
});
