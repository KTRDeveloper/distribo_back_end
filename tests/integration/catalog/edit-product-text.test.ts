import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0c5-0000-7000-8000-000000000001';
const MANAGER = '0199c0c5-0000-7000-8000-000000000002';
const SELLER = '0199c0c5-0000-7000-8000-000000000003';
const DRIVER = '0199c0c5-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0c5-0000-7000-8000-000000000005';

const ORG_A = '0199c0c5-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0c5-0000-7000-8000-0000000000b1';

const PRODUCT_A = '0199c0c5-0000-7000-8000-0000000000c1';
const PRODUCT_B = '0199c0c5-0000-7000-8000-0000000000c2';
const VARIANT_1 = '0199c0c5-0000-7000-8000-0000000000d1';
const VARIANT_2 = '0199c0c5-0000-7000-8000-0000000000d2';
const UNKNOWN = '0199c0c5-0000-7000-8000-0000000000c9';

const REG = new Date('2026-01-01T00:00:00.000Z');

type VariantBody = { id: string; label: string; price: number; unit: string; status: string };
type ProductBody = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  image_urls: string[];
  paused: boolean;
  variants: VariantBody[];
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

function patch(orgId: string, productId: string, body: unknown, personId = MANAGER) {
  return createAuthenticatedRequest(app, personId)
    .patch(`/api/v1/organizations/${orgId}/products/${productId}`)
    .send(body as object);
}

const rowOf = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });
const variantsOf = (productId: string) =>
  prisma.productVariant.findMany({ where: { productId }, orderBy: { id: 'asc' } });

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009201');
  await seedPerson(MANAGER, '+237600009202');
  await seedPerson(SELLER, '+237600009203');
  await seedPerson(DRIVER, '+237600009204');
  await seedPerson(OTHER_OWNER, '+237600009205');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await seedMember(ORG_A, OWNER, 'OWNER', 9);
  await seedMember(ORG_A, MANAGER, 'MANAGER', 1);
  await seedMember(ORG_A, SELLER, 'SELLER', 2);
  await seedMember(ORG_A, DRIVER, 'DRIVER', 3);
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B' } });
  await seedMember(ORG_B, OTHER_OWNER, 'OWNER', 9);
  // Products written the new way: empty unit, the variants carry unit and price.
  await prisma.product.create({
    data: {
      id: PRODUCT_A,
      organizationId: ORG_A,
      name: 'Riz',
      unit: '',
      description: 'Sac',
      category: 'Céréales',
    },
  });
  await prisma.productVariant.createMany({
    data: [
      {
        id: VARIANT_1,
        productId: PRODUCT_A,
        organizationId: ORG_A,
        unit: 'sac 25 kg',
        price: 15000n,
      },
      {
        id: VARIANT_2,
        productId: PRODUCT_A,
        organizationId: ORG_A,
        name: 'Long',
        unit: 'sac 50 kg',
        price: 28000n,
        status: 'INACTIVE',
      },
    ],
  });
  await prisma.product.create({
    data: { id: PRODUCT_B, organizationId: ORG_B, name: 'Huile', unit: '', category: 'Huiles' },
  });
});

describe('PATCH /api/v1/organizations/:organizationId/products/:productId (texts)', () => {
  it('AC-1 change: 200 with the new values, the variants unchanged, closed view', async () => {
    const variantsBefore = await variantsOf(PRODUCT_A);
    const response = await patch(ORG_A, PRODUCT_A, { name: 'Riz long', category: 'Épicerie' });

    expect(response.status).toBe(200);
    const body = bodyOf<ProductBody>(response);
    expect(body).toMatchObject({
      id: PRODUCT_A,
      name: 'Riz long',
      category: 'Épicerie',
      description: 'Sac',
      paused: false,
    });
    expect(Object.keys(body).sort()).toEqual(
      ['category', 'description', 'id', 'image_urls', 'name', 'paused', 'variants'].sort()
    );
    expect(body.variants.map((variant) => variant.id)).toEqual([VARIANT_1, VARIANT_2]);
    expect(body.variants[0]).toMatchObject({ price: 15000, unit: 'sac 25 kg', status: 'ACTIVE' });
    expect(body.variants[0].label).toContain('Riz long');
    expect(body.variants[1]).toMatchObject({ price: 28000, status: 'INACTIVE' });
    expect(response.body).not.toHaveProperty('negotiated_prices_to_review');
    expect(await variantsOf(PRODUCT_A)).toEqual(variantsBefore);
    expect(await rowOf(PRODUCT_A)).toMatchObject({ name: 'Riz long', category: 'Épicerie' });
  });

  it('AC-2 clear: description null and category null give 200 and null', async () => {
    const response = await patch(ORG_A, PRODUCT_A, { description: null });
    expect(response.status).toBe(200);
    expect(bodyOf<ProductBody>(response).description).toBeNull();
    expect((await rowOf(PRODUCT_A)).description).toBeNull();

    const cleared = await patch(ORG_A, PRODUCT_A, { category: null }, OWNER);
    expect(cleared.status).toBe(200);
    expect(bodyOf<ProductBody>(cleared).category).toBeNull();
    expect((await rowOf(PRODUCT_A)).category).toBeNull();
  });

  it('a paused product can be edited and stays paused', async () => {
    await prisma.product.update({ where: { id: PRODUCT_A }, data: { pausedAt: new Date() } });
    const response = await patch(ORG_A, PRODUCT_A, { name: 'En pause' });

    expect(response.status).toBe(200);
    expect(bodyOf<ProductBody>(response)).toMatchObject({ name: 'En pause', paused: true });
  });

  describe('AC-3 refusals', () => {
    const rows: [string, Record<string, unknown>][] = [
      ['no field', {}],
      ['name empty', { name: '' }],
      ['name blank', { name: '   ' }],
      ['name null', { name: null }],
      ['name 101 chars', { name: 'a'.repeat(101) }],
      ['description 2001 chars', { description: 'a'.repeat(2001) }],
      ['category 101 chars', { category: 'a'.repeat(101) }],
      ['unit sent', { unit: 'sac' }],
      ['price sent', { price: 100 }],
      ['min_order_quantity sent', { min_order_quantity: 2 }],
      ['status sent', { status: 'INACTIVE' }],
      ['organization_id sent', { organization_id: ORG_B }],
      ['image_keys sent', { image_keys: ['k'] }],
      ['paused_at sent', { paused_at: '2020-01-01T00:00:00.000Z' }],
      ['a valid name with a price', { name: 'Riz long', price: 100 }],
    ];

    it.each(rows)('%s -> 400 VALIDATION_ERROR and the product is unchanged', async (_l, body) => {
      const before = await rowOf(PRODUCT_A);
      const variantsBefore = await variantsOf(PRODUCT_A);
      const response = await patch(ORG_A, PRODUCT_A, body);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await rowOf(PRODUCT_A)).toEqual(before);
      expect(await variantsOf(PRODUCT_A)).toEqual(variantsBefore);
    });

    it('a product of another organization -> 404 NOT_FOUND', async () => {
      const response = await patch(ORG_A, PRODUCT_B, { name: 'Volé' });

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    });

    it('an unknown product -> 404', async () => {
      expect((await patch(ORG_A, UNKNOWN, { name: 'X' })).status).toBe(404);
    });

    it('a deleted product -> 404 and unchanged', async () => {
      await prisma.product.update({ where: { id: PRODUCT_A }, data: { deletedAt: new Date() } });
      const before = await rowOf(PRODUCT_A);

      expect((await patch(ORG_A, PRODUCT_A, { name: 'X' })).status).toBe(404);
      expect(await rowOf(PRODUCT_A)).toEqual(before);
    });

    it.each([
      ['SELLER', SELLER],
      ['DRIVER', DRIVER],
    ])('a %s caller -> 403 FORBIDDEN', async (_role, personId) => {
      const response = await patch(ORG_A, PRODUCT_A, { name: 'X' }, personId);

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    });
  });

  it('AB-1 a seller renames an article: 403 and the name is unchanged', async () => {
    const response = await patch(ORG_A, PRODUCT_A, { name: 'Renommé' }, SELLER);

    expect(response.status).toBe(403);
    expect((await rowOf(PRODUCT_A)).name).toBe('Riz');
  });

  it("AB-2 a member of A patches B's product under A's path: 404 and B unchanged", async () => {
    const before = await rowOf(PRODUCT_B);
    const response = await patch(ORG_A, PRODUCT_B, { name: 'Volé', category: null });

    expect(response.status).toBe(404);
    expect(await rowOf(PRODUCT_B)).toEqual(before);
  });
});
