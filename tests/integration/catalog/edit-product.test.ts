import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0b5-0000-7000-8000-000000000001';
const MANAGER = '0199c0b5-0000-7000-8000-000000000002';
const SELLER = '0199c0b5-0000-7000-8000-000000000003';
const DRIVER = '0199c0b5-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0b5-0000-7000-8000-000000000005';
const CUSTOMERS = [
  '0199c0b5-0000-7000-8000-000000000011',
  '0199c0b5-0000-7000-8000-000000000012',
  '0199c0b5-0000-7000-8000-000000000013',
  '0199c0b5-0000-7000-8000-000000000014',
];

const ORG_A = '0199c0b5-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0b5-0000-7000-8000-0000000000b1';

const PRODUCT_A = '0199c0b5-0000-7000-8000-0000000000c1';
const PRODUCT_B = '0199c0b5-0000-7000-8000-0000000000c2';
const UNKNOWN = '0199c0b5-0000-7000-8000-0000000000c9';

const REG = new Date('2026-01-01T00:00:00.000Z');

type ProductBody = {
  id: string;
  name: string;
  unit: string;
  price: number;
  price_updated_at: string;
  min_order_quantity: string | null;
  description: string | null;
  category: string | null;
  status: string;
  created_at: string;
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

/** Inserts a negotiated price of a customer on PRODUCT_A, set before now. */
async function seedNegotiatedPrice(index: number, deleted = false) {
  const relationshipId = `0199c0b5-0000-7000-8000-0000000001${index}0`;
  await prisma.customerRelationship.create({
    data: {
      id: relationshipId,
      supplierOrganizationId: ORG_A,
      customerPersonId: CUSTOMERS[index],
      createdById: OWNER,
    },
  });
  await prisma.customerPrice.create({
    data: {
      id: `0199c0b5-0000-7000-8000-0000000002${index}0`,
      customerRelationshipId: relationshipId,
      productId: PRODUCT_A,
      price: 14000n,
      setById: OWNER,
      deletedAt: deleted ? new Date() : null,
    },
  });
}

function patch(orgId: string, productId: string, body: unknown, personId = MANAGER) {
  return createAuthenticatedRequest(app, personId)
    .patch(`/api/v1/organizations/${orgId}/products/${productId}`)
    .send(body as object);
}

const rowOf = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009101');
  await seedPerson(MANAGER, '+237600009102');
  await seedPerson(SELLER, '+237600009103');
  await seedPerson(DRIVER, '+237600009104');
  await seedPerson(OTHER_OWNER, '+237600009105');
  for (const [i, id] of CUSTOMERS.entries()) await seedPerson(id, `+23760000912${i}`);
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await seedMember(ORG_A, OWNER, 'OWNER', 9);
  await seedMember(ORG_A, MANAGER, 'MANAGER', 1);
  await seedMember(ORG_A, SELLER, 'SELLER', 2);
  await seedMember(ORG_A, DRIVER, 'DRIVER', 3);
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B' } });
  await seedMember(ORG_B, OTHER_OWNER, 'OWNER', 9);
  await prisma.product.create({
    data: {
      id: PRODUCT_A,
      organizationId: ORG_A,
      name: 'Riz',
      unit: 'sac 25 kg',
      price: 15000n,
      minOrderQuantity: '2',
      description: 'Sac',
      category: 'Céréales',
    },
  });
  await prisma.product.create({
    data: { id: PRODUCT_B, organizationId: ORG_B, name: 'Huile', unit: 'bidon', price: 9000n },
  });
});

describe('PATCH /api/v1/organizations/:organizationId/products/:productId', () => {
  it('AC-1 change fields: 200, new values, price_updated_at unchanged, closed view', async () => {
    const before = await rowOf(PRODUCT_A);
    const response = await patch(ORG_A, PRODUCT_A, { name: 'Riz long', category: 'Épicerie' });

    expect(response.status).toBe(200);
    const body = bodyOf<ProductBody>(response);
    expect(body).toMatchObject({
      id: PRODUCT_A,
      name: 'Riz long',
      category: 'Épicerie',
      unit: 'sac 25 kg',
      price: 15000,
      min_order_quantity: '2',
      description: 'Sac',
      status: 'ACTIVE',
      price_updated_at: before.priceUpdatedAt.toISOString(),
      negotiated_prices_to_review: 0,
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        'category',
        'created_at',
        'description',
        'id',
        'min_order_quantity',
        'name',
        'negotiated_prices_to_review',
        'price',
        'price_updated_at',
        'status',
        'unit',
      ].sort()
    );
    const row = await rowOf(PRODUCT_A);
    expect(row).toMatchObject({ name: 'Riz long', category: 'Épicerie' });
  });

  it('AC-1 min_order_quantity null clears it; unit and description change', async () => {
    const response = await patch(ORG_A, PRODUCT_A, {
      min_order_quantity: null,
      unit: 'sac 50 kg',
      description: 'Gros sac',
    });

    expect(response.status).toBe(200);
    expect(bodyOf<ProductBody>(response)).toMatchObject({
      min_order_quantity: null,
      unit: 'sac 50 kg',
      description: 'Gros sac',
    });
    expect((await rowOf(PRODUCT_A)).minOrderQuantity).toBeNull();
  });

  it('AC-2 price change: price_updated_at moves, 3 negotiated prices to review', async () => {
    await seedNegotiatedPrice(0);
    await seedNegotiatedPrice(1);
    await seedNegotiatedPrice(2);
    await seedNegotiatedPrice(3, true);
    const before = await rowOf(PRODUCT_A);

    const response = await patch(ORG_A, PRODUCT_A, { price: 16000 });

    expect(response.status).toBe(200);
    const body = bodyOf<ProductBody>(response);
    expect(body.price).toBe(16000);
    expect(body.negotiated_prices_to_review).toBe(3);
    expect(Date.parse(body.price_updated_at)).toBeGreaterThan(before.priceUpdatedAt.getTime());
    const row = await rowOf(PRODUCT_A);
    expect(row.price).toBe(16000n);
    expect(row.priceUpdatedAt.toISOString()).toBe(body.price_updated_at);
  });

  it('a price sent unchanged keeps price_updated_at and reports 0 to review', async () => {
    await seedNegotiatedPrice(0);
    const before = await rowOf(PRODUCT_A);

    const response = await patch(ORG_A, PRODUCT_A, { price: 15000 });

    expect(response.status).toBe(200);
    expect(bodyOf<ProductBody>(response)).toMatchObject({
      price_updated_at: before.priceUpdatedAt.toISOString(),
      negotiated_prices_to_review: 0,
    });
  });

  it('AC-3 retire and restore: statuses follow', async () => {
    const retired = await patch(ORG_A, PRODUCT_A, { status: 'INACTIVE' });
    expect(retired.status).toBe(200);
    expect(bodyOf<ProductBody>(retired).status).toBe('INACTIVE');
    expect((await rowOf(PRODUCT_A)).status).toBe('INACTIVE');

    const restored = await patch(ORG_A, PRODUCT_A, { status: 'ACTIVE' });
    expect(restored.status).toBe(200);
    expect(bodyOf<ProductBody>(restored).status).toBe('ACTIVE');
    expect((await rowOf(PRODUCT_A)).status).toBe('ACTIVE');
  });

  it('OWNER may edit too', async () => {
    expect((await patch(ORG_A, PRODUCT_A, { name: 'Par le patron' }, OWNER)).status).toBe(200);
  });

  describe('AC-4 refusals', () => {
    const rows: [string, Record<string, unknown>][] = [
      ['price 0', { price: 0 }],
      ['price negative', { price: -1 }],
      ['price 1.5', { price: 1.5 }],
      ['no field', {}],
      ['status "DELETED"', { status: 'DELETED' }],
      ['organization_id sent', { organization_id: ORG_B }],
      ['price_updated_at sent', { price_updated_at: '2020-01-01T00:00:00.000Z' }],
      ['unknown field', { color: 'red' }],
      ['name empty', { name: '' }],
      ['name 101 chars', { name: 'a'.repeat(101) }],
      ['description 2001 chars', { description: 'a'.repeat(2001) }],
      ['min_order_quantity 0', { min_order_quantity: 0 }],
      ['name null', { name: null }],
    ];

    it.each(rows)('%s -> 400 and the product is unchanged', async (_label, body) => {
      const before = await rowOf(PRODUCT_A);
      const response = await patch(ORG_A, PRODUCT_A, body);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await rowOf(PRODUCT_A)).toEqual(before);
    });

    it('a product of another organization -> 404', async () => {
      const response = await patch(ORG_A, PRODUCT_B, { name: 'Volé' });

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    });

    it('an unknown product -> 404', async () => {
      expect((await patch(ORG_A, UNKNOWN, { name: 'X' })).status).toBe(404);
    });

    it('a soft-deleted product -> 404', async () => {
      await prisma.product.update({ where: { id: PRODUCT_A }, data: { deletedAt: new Date() } });
      expect((await patch(ORG_A, PRODUCT_A, { name: 'X' })).status).toBe(404);
    });

    it.each([
      ['SELLER', SELLER],
      ['DRIVER', DRIVER],
    ])('a %s caller -> 403', async (_role, personId) => {
      const response = await patch(ORG_A, PRODUCT_A, { name: 'X' }, personId);

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    });
  });

  it('AB-1 seller changes a price: 403 and the price is unchanged', async () => {
    const response = await patch(ORG_A, PRODUCT_A, { price: 1 }, SELLER);

    expect(response.status).toBe(403);
    expect((await rowOf(PRODUCT_A)).price).toBe(15000n);
  });

  it('AB-2 member of A patches a product of B under A path: 404 and B unchanged', async () => {
    const before = await rowOf(PRODUCT_B);
    const response = await patch(ORG_A, PRODUCT_B, { price: 1, status: 'INACTIVE' });

    expect(response.status).toBe(404);
    expect(await rowOf(PRODUCT_B)).toEqual(before);
  });

  it('a non-member of the organization gets 404', async () => {
    expect((await patch(ORG_B, PRODUCT_B, { name: 'X' }, MANAGER)).status).toBe(404);
  });

  it('refuses a request without a token with 401', async () => {
    const { default: request } = await import('supertest');
    const response = await request(app)
      .patch(`/api/v1/organizations/${ORG_A}/products/${PRODUCT_A}`)
      .send({ name: 'X' });

    expect(response.status).toBe(401);
  });
});
