import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0e5-0000-7000-8000-000000000001';
const MANAGER = '0199c0e5-0000-7000-8000-000000000002';
const SELLER = '0199c0e5-0000-7000-8000-000000000003';
const DRIVER = '0199c0e5-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0e5-0000-7000-8000-000000000005';
const CUSTOMERS = [1, 2, 3, 4].map((n) => `0199c0e5-0000-7000-8000-00000000001${n}`);

const ORG_A = '0199c0e5-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0e5-0000-7000-8000-0000000000b1';
const ORG_CLOSED = '0199c0e5-0000-7000-8000-0000000000e1';

const REG = new Date('2026-01-01T00:00:00.000Z');

const PRODUCT_A = '0199c0e5-0000-7000-8000-0000000000c1';
const PRODUCT_B = '0199c0e5-0000-7000-8000-0000000000c2';
const PRODUCT_CLOSED = '0199c0e5-0000-7000-8000-0000000000c3';
const VARIANT = '0199c0e5-0000-7000-8000-0000000000d1';
const TWIN = '0199c0e5-0000-7000-8000-0000000000d2';
const VARIANT_B = '0199c0e5-0000-7000-8000-0000000000d3';
const VARIANT_CLOSED = '0199c0e5-0000-7000-8000-0000000000d4';
const UNKNOWN = '0199c0e5-0000-7000-8000-0000000000d9';

const OLD_PRICE_DATE = new Date('2026-03-01T00:00:00.000Z');

type VariantBody = {
  id: string;
  name: string | null;
  unit: string;
  label: string;
  price: number;
  price_updated_at: string;
  min_order_quantity: string | null;
  status: string;
  negotiated_prices_to_review: number;
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
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  suffix: number
) {
  await prisma.collaboration.create({
    data: {
      id: orgId.slice(0, -3) + orgId.slice(-2, -1) + suffix + '5',
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedOrg(
  id: string,
  ownerId: string,
  status: 'ACTIVE' | 'CLOSED' = 'ACTIVE',
  maxProducts: number | null = null
) {
  await prisma.organization.create({
    data: { id, name: 'Org ' + id.slice(-2), status, maxProducts },
  });
  await seedMember(id, ownerId, 'OWNER', 9);
}

async function seedProduct(
  id: string,
  organizationId: string,
  options: { variantId?: string; status?: 'ACTIVE' | 'INACTIVE'; paused?: boolean } = {}
) {
  await prisma.product.create({
    data: {
      id,
      organizationId,
      name: 'T-shirt',
      pausedAt: options.paused ? new Date('2026-02-01T00:00:00.000Z') : null,
    },
  });
  await prisma.productVariant.create({
    data: {
      id: options.variantId ?? VARIANT,
      productId: id,
      organizationId,
      name: 'Bleu / M',
      unit: 'pièce',
      price: 15000n,
      status: options.status ?? 'ACTIVE',
    },
  });
}

function patch(orgId: string, productId: string, variantId: string, body: unknown, who = MANAGER) {
  return createAuthenticatedRequest(app, who)
    .patch(`/api/v1/organizations/${orgId}/products/${productId}/variants/${variantId}`)
    .send(body as object);
}

const readVariant = (id: string) => prisma.productVariant.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009301');
  await seedPerson(MANAGER, '+237600009302');
  await seedPerson(SELLER, '+237600009303');
  await seedPerson(DRIVER, '+237600009304');
  await seedPerson(OTHER_OWNER, '+237600009305');
  for (const [index, id] of CUSTOMERS.entries()) {
    await seedPerson(id, `+23760000931${index}`);
  }
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER', 1);
  await seedMember(ORG_A, SELLER, 'SELLER', 2);
  await seedMember(ORG_A, DRIVER, 'DRIVER', 3);
  await seedOrg(ORG_B, OTHER_OWNER);
  await seedOrg(ORG_CLOSED, OWNER, 'CLOSED');
  await seedMember(ORG_CLOSED, MANAGER, 'MANAGER', 1);
});

/** Seeds one live negotiated price of `variantId` per customer, set at `setAt`. */
async function seedNegotiatedPrices(count: number, variantId = VARIANT, setAt = OLD_PRICE_DATE) {
  for (let i = 0; i < count; i += 1) {
    const relationshipId = `0199c0e5-0000-7000-8000-00000000002${i}`;
    await prisma.customerRelationship.create({
      data: {
        id: relationshipId,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMERS[i],
        createdById: OWNER,
      },
    });
    await prisma.customerPrice.create({
      data: {
        id: `0199c0e5-0000-7000-8000-00000000003${i}`,
        customerRelationshipId: relationshipId,
        productVariantId: variantId,
        price: 14000n,
        setById: OWNER,
        setAt,
      },
    });
  }
}

describe('PATCH /api/v1/organizations/:organizationId/products/:productId/variants/:variantId', () => {
  it('AC-1 change fields: 200, price date unchanged, 0 prices to review', async () => {
    await seedProduct(PRODUCT_A, ORG_A);
    const created = await readVariant(VARIANT);

    const response = await patch(ORG_A, PRODUCT_A, VARIANT, {
      name: 'Bleu / L',
      min_order_quantity: '2.5',
    });

    expect(response.status).toBe(200);
    const body = bodyOf<VariantBody>(response);
    expect(body).toMatchObject({
      id: VARIANT,
      name: 'Bleu / L',
      unit: 'pièce',
      label: 'T-shirt — Bleu / L (pièce)',
      price: 15000,
      min_order_quantity: '2.5',
      status: 'ACTIVE',
      negotiated_prices_to_review: 0,
    });
    expect(body.price_updated_at).toBe(created.priceUpdatedAt.toISOString());
    expect((await readVariant(VARIANT)).priceUpdatedAt).toEqual(created.priceUpdatedAt);
  });

  it('null clears the name and the minimum quantity', async () => {
    await seedProduct(PRODUCT_A, ORG_A);
    await prisma.productVariant.update({
      where: { id: VARIANT },
      data: { minOrderQuantity: '3' },
    });

    const response = await patch(ORG_A, PRODUCT_A, VARIANT, {
      name: null,
      min_order_quantity: null,
    });

    expect(response.status).toBe(200);
    expect(bodyOf<VariantBody>(response)).toMatchObject({ name: null, min_order_quantity: null });
    const row = await readVariant(VARIANT);
    expect(row.name).toBeNull();
    expect(row.minOrderQuantity).toBeNull();
  });

  it('the owner may change the unit', async () => {
    await seedProduct(PRODUCT_A, ORG_A);

    const response = await patch(ORG_A, PRODUCT_A, VARIANT, { unit: 'lot' }, OWNER);

    expect(response.status).toBe(200);
    expect((await readVariant(VARIANT)).unit).toBe('lot');
  });

  it('AC-2 price change: date moves and 3 older negotiated prices are to review', async () => {
    await seedProduct(PRODUCT_A, ORG_A);
    await seedNegotiatedPrices(3);
    const created = await readVariant(VARIANT);
    const before = Date.now();

    const response = await patch(ORG_A, PRODUCT_A, VARIANT, { price: 16000 });

    expect(response.status).toBe(200);
    const body = bodyOf<VariantBody>(response);
    expect(body.price).toBe(16000);
    expect(new Date(body.price_updated_at).getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(body.negotiated_prices_to_review).toBe(3);
    const row = await readVariant(VARIANT);
    expect(row.price).toBe(16000n);
    expect(row.priceUpdatedAt.getTime()).toBeGreaterThan(created.priceUpdatedAt.getTime());
  });

  it('a price change counts only live prices of this variant', async () => {
    await seedProduct(PRODUCT_A, ORG_A);
    await prisma.productVariant.create({
      data: {
        id: TWIN,
        productId: PRODUCT_A,
        organizationId: ORG_A,
        name: 'Autre',
        unit: 'pièce',
        price: 100n,
      },
    });
    await seedNegotiatedPrices(3);
    await prisma.customerPrice.update({
      where: { id: '0199c0e5-0000-7000-8000-000000000030' },
      data: { deletedAt: new Date() },
    });
    await prisma.customerPrice.update({
      where: { id: '0199c0e5-0000-7000-8000-000000000031' },
      data: { productVariantId: TWIN },
    });

    const response = await patch(ORG_A, PRODUCT_A, VARIANT, { price: 16000 });

    expect(bodyOf<VariantBody>(response).negotiated_prices_to_review).toBe(1);
  });

  it('the same price changes nothing and reports 0 to review', async () => {
    await seedProduct(PRODUCT_A, ORG_A);
    await seedNegotiatedPrices(2);
    const created = await readVariant(VARIANT);

    const response = await patch(ORG_A, PRODUCT_A, VARIANT, { price: 15000 });

    expect(response.status).toBe(200);
    expect(bodyOf<VariantBody>(response).negotiated_prices_to_review).toBe(0);
    expect((await readVariant(VARIANT)).priceUpdatedAt).toEqual(created.priceUpdatedAt);
  });

  it('AC-3 withdraw and restore: INACTIVE then ACTIVE, both 200', async () => {
    await seedProduct(PRODUCT_A, ORG_A);

    const off = await patch(ORG_A, PRODUCT_A, VARIANT, { status: 'INACTIVE' });
    expect(off.status).toBe(200);
    expect(bodyOf<VariantBody>(off).status).toBe('INACTIVE');
    expect((await readVariant(VARIANT)).status).toBe('INACTIVE');

    const on = await patch(ORG_A, PRODUCT_A, VARIANT, { status: 'ACTIVE' });
    expect(on.status).toBe(200);
    expect(bodyOf<VariantBody>(on).status).toBe('ACTIVE');
  });

  describe('AC-4 refusals', () => {
    beforeEach(async () => {
      await seedProduct(PRODUCT_A, ORG_A);
      await prisma.productVariant.create({
        data: {
          id: TWIN,
          productId: PRODUCT_A,
          organizationId: ORG_A,
          name: 'Rouge / L',
          unit: 'pièce',
          price: 5000n,
        },
      });
    });

    it.each([
      ['price 0', { price: 0 }],
      ['price 1.5', { price: 1.5 }],
      ['no field', {}],
      ['status DELETED', { status: 'DELETED' }],
      ['an empty name', { name: '' }],
      ['an empty unit', { unit: '' }],
      ['min_order_quantity 0', { min_order_quantity: 0 }],
      ['a product_id', { product_id: PRODUCT_B, price: 7000 }],
      ['an organization_id', { organization_id: ORG_B, price: 7000 }],
      ['image_keys', { image_keys: [], price: 7000 }],
      ['a price_updated_at', { price_updated_at: '2030-01-01T00:00:00.000Z', price: 7000 }],
    ])('%s -> 400 VALIDATION_ERROR, variant unchanged', async (_label, body) => {
      const response = await patch(ORG_A, PRODUCT_A, VARIANT, body);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      const row = await readVariant(VARIANT);
      expect(row).toMatchObject({ price: 15000n, name: 'Bleu / M', status: 'ACTIVE' });
    });

    it('a variant id that is not a UUID -> 400 VALIDATION_ERROR', async () => {
      const response = await patch(ORG_A, PRODUCT_A, 'not-a-uuid', { price: 7000 });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    });

    it('the name and unit of another live variant, in other case -> 409 VARIANT_EXISTS', async () => {
      const response = await patch(ORG_A, PRODUCT_A, VARIANT, {
        name: ' rouge  / l ',
        unit: 'PIÈCE',
        price: 7000,
      });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VARIANT_EXISTS');
      expect(await readVariant(VARIANT)).toMatchObject({ name: 'Bleu / M', price: 15000n });
    });

    it('only the unit changing onto a twin -> 409 VARIANT_EXISTS', async () => {
      await prisma.productVariant.update({
        where: { id: TWIN },
        data: { name: 'Bleu / M', unit: 'lot' },
      });

      const response = await patch(ORG_A, PRODUCT_A, VARIANT, { unit: ' LOT ' });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VARIANT_EXISTS');
      expect((await readVariant(VARIANT)).unit).toBe('pièce');
    });

    it('a deleted variant frees its text', async () => {
      await prisma.productVariant.update({
        where: { id: TWIN },
        data: { deletedAt: new Date('2026-02-01T00:00:00.000Z') },
      });

      const response = await patch(ORG_A, PRODUCT_A, VARIANT, { name: 'Rouge / L' });

      expect(response.status).toBe(200);
    });

    it('a deleted variant -> 404 NOT_FOUND', async () => {
      await prisma.productVariant.update({
        where: { id: TWIN },
        data: { deletedAt: new Date('2026-02-01T00:00:00.000Z') },
      });

      const response = await patch(ORG_A, PRODUCT_A, TWIN, { price: 7000 });

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect((await readVariant(TWIN)).price).toBe(5000n);
    });

    it('an unknown variant -> 404 NOT_FOUND', async () => {
      const response = await patch(ORG_A, PRODUCT_A, UNKNOWN, { price: 7000 });

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    });

    it('a variant under another product of the same business -> 404 NOT_FOUND', async () => {
      await seedProduct(PRODUCT_B, ORG_A, { variantId: VARIANT_B });

      const response = await patch(ORG_A, PRODUCT_B, VARIANT, { price: 7000 });

      expect(response.status).toBe(404);
      expect((await readVariant(VARIANT)).price).toBe(15000n);
    });

    it('a CLOSED organization -> 409 ORGANIZATION_NOT_ACTIVE, unchanged', async () => {
      await seedProduct(PRODUCT_CLOSED, ORG_CLOSED, { variantId: VARIANT_CLOSED });

      const response = await patch(ORG_CLOSED, PRODUCT_CLOSED, VARIANT_CLOSED, { price: 7000 });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
      expect((await readVariant(VARIANT_CLOSED)).price).toBe(15000n);
    });
  });

  describe('AC-5 back on sale at the limit', () => {
    const seedOnSale = async (orgId: string, count: number) => {
      for (let i = 0; i < count; i += 1) {
        const id = `0199c0e5-0000-7000-8000-${String(5000 + i).padStart(12, '0')}`;
        await prisma.product.create({
          data: { id, organizationId: orgId, name: `Fixture ${i}` },
        });
        await prisma.productVariant.create({
          data: {
            id: `0199c0e5-0000-7000-8000-${String(6000 + i).padStart(12, '0')}`,
            productId: id,
            organizationId: orgId,
            unit: 'kg',
            price: 100n,
          },
        });
      }
    };

    beforeEach(async () => {
      await prisma.organization.update({ where: { id: ORG_A }, data: { maxProducts: 30 } });
      await seedOnSale(ORG_A, 30);
    });

    it('the only variant INACTIVE, 30 on sale: 409 PRODUCT_LIMIT_REACHED, still INACTIVE', async () => {
      await seedProduct(PRODUCT_A, ORG_A, { status: 'INACTIVE' });

      const response = await patch(ORG_A, PRODUCT_A, VARIANT, { status: 'ACTIVE' });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('PRODUCT_LIMIT_REACHED');
      expect((await readVariant(VARIANT)).status).toBe('INACTIVE');
    });

    it('another variant already ACTIVE: the product is on sale, so 200', async () => {
      await seedProduct(PRODUCT_A, ORG_A, { status: 'INACTIVE' });
      await prisma.productVariant.create({
        data: {
          id: TWIN,
          productId: PRODUCT_A,
          organizationId: ORG_A,
          name: 'Autre',
          unit: 'pièce',
          price: 100n,
        },
      });
      const response = await patch(ORG_A, PRODUCT_A, VARIANT, { status: 'ACTIVE' });

      expect(response.status).toBe(200);
    });

    it('a paused product goes back to ACTIVE whatever the count', async () => {
      await seedProduct(PRODUCT_A, ORG_A, { status: 'INACTIVE', paused: true });

      const response = await patch(ORG_A, PRODUCT_A, VARIANT, { status: 'ACTIVE' });

      expect(response.status).toBe(200);
    });

    it('under the limit the variant goes back on sale', async () => {
      await prisma.organization.update({ where: { id: ORG_A }, data: { maxProducts: 31 } });
      await seedProduct(PRODUCT_A, ORG_A, { status: 'INACTIVE' });

      const response = await patch(ORG_A, PRODUCT_A, VARIANT, { status: 'ACTIVE' });

      expect(response.status).toBe(200);
    });
  });

  it('a race onto the same text falls on the unique index: one 200, one 409', async () => {
    await seedProduct(PRODUCT_A, ORG_A);
    await prisma.productVariant.create({
      data: {
        id: TWIN,
        productId: PRODUCT_A,
        organizationId: ORG_A,
        name: 'Autre',
        unit: 'pièce',
        price: 100n,
      },
    });

    const [first, second] = await Promise.all([
      patch(ORG_A, PRODUCT_A, VARIANT, { name: 'Vert' }),
      patch(ORG_A, PRODUCT_A, TWIN, { name: 'vert' }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(bodyOf<ErrorBody>(loser).error.code).toBe('VARIANT_EXISTS');
  });

  it.each([
    ['SELLER', SELLER],
    ['DRIVER', DRIVER],
  ])('AB-1 %s patching the price: 403, price unchanged', async (_role, personId) => {
    await seedProduct(PRODUCT_A, ORG_A);

    const response = await patch(ORG_A, PRODUCT_A, VARIANT, { price: 1 }, personId);

    expect(response.status).toBe(403);
    expect((await readVariant(VARIANT)).price).toBe(15000n);
  });

  it('AB-2 a member of A patching a variant of B: 404, B unchanged', async () => {
    await seedProduct(PRODUCT_B, ORG_B, { variantId: VARIANT_B });

    const underOwnPath = await patch(ORG_A, PRODUCT_B, VARIANT_B, { price: 1 });
    const underOtherPath = await patch(ORG_B, PRODUCT_B, VARIANT_B, { price: 1 });

    expect(underOwnPath.status).toBe(404);
    expect(bodyOf<ErrorBody>(underOwnPath).error.code).toBe('NOT_FOUND');
    expect(underOtherPath.status).toBe(404);
    expect(await readVariant(VARIANT_B)).toMatchObject({ price: 15000n, name: 'Bleu / M' });
  });
});
