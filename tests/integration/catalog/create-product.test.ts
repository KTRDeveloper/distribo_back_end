import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0b4-0000-7000-8000-000000000001';
const MANAGER = '0199c0b4-0000-7000-8000-000000000002';
const SELLER = '0199c0b4-0000-7000-8000-000000000003';
const DRIVER = '0199c0b4-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0b4-0000-7000-8000-000000000005';

const ORG_A = '0199c0b4-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0b4-0000-7000-8000-0000000000b1';
const ORG_CLOSED = '0199c0b4-0000-7000-8000-0000000000e1';
const ORG_SUSPENDED = '0199c0b4-0000-7000-8000-0000000000f1';

const REG = new Date('2026-01-01T00:00:00.000Z');

const GESTURE_1 = '0199c0b4-0000-7000-8000-0000000000c1';
const GESTURE_2 = '0199c0b4-0000-7000-8000-0000000000c2';
const VARIANT_1 = '0199c0b4-0000-7000-8000-0000000000d1';
const VARIANT_2 = '0199c0b4-0000-7000-8000-0000000000d2';

type VariantBody = {
  id: string;
  name: string | null;
  unit: string;
  label: string;
  price: number;
  price_updated_at: string;
  min_order_quantity: string | null;
  image_urls: string[];
  status: string;
};

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

async function seedOrg(
  id: string,
  ownerId: string,
  status: 'ACTIVE' | 'CLOSED' | 'SUSPENDED' = 'ACTIVE'
) {
  await prisma.organization.create({ data: { id, name: 'Org ' + id.slice(-2), status } });
  await seedMember(id, ownerId, 'OWNER', 9);
}

function post(orgId: string, body: unknown, personId = MANAGER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/products`)
    .send(body as object);
}

const goodVariant = (over: Record<string, unknown> = {}) => ({
  id: VARIANT_1,
  unit: 'sac 25 kg',
  price: 15000,
  ...over,
});

const goodBody = (
  over: Record<string, unknown> = {},
  variantOver: Record<string, unknown> = {}
) => ({
  id: GESTURE_1,
  name: 'Riz parfumé',
  variants: [goodVariant(variantOver)],
  ...over,
});

const productCount = () => prisma.product.count();

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009001');
  await seedPerson(MANAGER, '+237600009002');
  await seedPerson(SELLER, '+237600009003');
  await seedPerson(DRIVER, '+237600009004');
  await seedPerson(OTHER_OWNER, '+237600009005');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER', 1);
  await seedMember(ORG_A, SELLER, 'SELLER', 2);
  await seedMember(ORG_A, DRIVER, 'DRIVER', 3);
  await seedOrg(ORG_B, OTHER_OWNER);
  await seedOrg(ORG_CLOSED, OWNER, 'CLOSED');
  await seedMember(ORG_CLOSED, MANAGER, 'MANAGER', 1);
  await seedOrg(ORG_SUSPENDED, OWNER, 'SUSPENDED');
  await seedMember(ORG_SUSPENDED, MANAGER, 'MANAGER', 1);
});

describe('POST /api/v1/organizations/:organizationId/products', () => {
  it('AC-1 create: 201, ACTIVE variant, price_updated_at set, closed view, rows stored', async () => {
    const response = await post(ORG_A, goodBody());

    expect(response.status).toBe(201);
    const body = bodyOf<ProductBody>(response);
    expect(body).toMatchObject({
      id: GESTURE_1,
      name: 'Riz parfumé',
      description: null,
      category: null,
      image_urls: [],
      paused: false,
    });
    expect(Object.keys(body).sort()).toEqual(
      ['category', 'description', 'id', 'image_urls', 'name', 'paused', 'variants'].sort()
    );
    expect(body.variants).toHaveLength(1);
    const [variant] = body.variants;
    expect(variant).toMatchObject({
      id: VARIANT_1,
      name: null,
      unit: 'sac 25 kg',
      label: 'Riz parfumé — sac 25 kg',
      price: 15000,
      min_order_quantity: null,
      image_urls: [],
      status: 'ACTIVE',
    });
    expect(Number.isNaN(Date.parse(variant.price_updated_at))).toBe(false);
    expect(Object.keys(variant).sort()).toEqual(
      [
        'id',
        'image_urls',
        'label',
        'min_order_quantity',
        'name',
        'price',
        'price_updated_at',
        'status',
        'unit',
      ].sort()
    );

    const row = await prisma.product.findUniqueOrThrow({ where: { id: GESTURE_1 } });
    expect(row).toMatchObject({ organizationId: ORG_A, unit: '', status: 'ACTIVE' });
    const variantRow = await prisma.productVariant.findUniqueOrThrow({ where: { id: VARIANT_1 } });
    expect(variantRow).toMatchObject({
      organizationId: ORG_A,
      productId: GESTURE_1,
      price: 15000n,
      status: 'ACTIVE',
    });
    expect(await prisma.productVariant.count()).toBe(1);
  });

  it('stores the optional fields', async () => {
    const response = await post(
      ORG_A,
      goodBody(
        { description: 'Sac', category: 'Céréales' },
        { min_order_quantity: '2.5', name: 'Parfumé' }
      )
    );

    expect(response.status).toBe(201);
    const body = bodyOf<ProductBody>(response);
    expect(body).toMatchObject({ description: 'Sac', category: 'Céréales' });
    expect(body.variants[0]).toMatchObject({
      min_order_quantity: '2.5',
      name: 'Parfumé',
      label: 'Riz parfumé — Parfumé (sac 25 kg)',
    });
  });

  describe('AC-2 limits', () => {
    const rows: [string, Record<string, unknown>, number, 'product' | 'variant'][] = [
      ['name empty', { name: '' }, 400, 'product'],
      ['name 101 chars', { name: 'a'.repeat(101) }, 400, 'product'],
      ['name 100 chars', { name: 'a'.repeat(100) }, 201, 'product'],
      ['unit empty', { unit: '' }, 400, 'variant'],
      ['unit 101 chars', { unit: 'a'.repeat(101) }, 400, 'variant'],
      ['category 101 chars', { category: 'a'.repeat(101) }, 400, 'product'],
      ['description 2001 chars', { description: 'a'.repeat(2001) }, 400, 'product'],
      ['price 0', { price: 0 }, 400, 'variant'],
      ['price 1', { price: 1 }, 201, 'variant'],
      ['price negative', { price: -5 }, 400, 'variant'],
      ['price 1.5', { price: 1.5 }, 400, 'variant'],
      ['price string', { price: '1500' }, 400, 'variant'],
      ['min_order_quantity 0', { min_order_quantity: 0 }, 400, 'variant'],
      ['min_order_quantity "0"', { min_order_quantity: '0' }, 400, 'variant'],
      ['min_order_quantity 0.0001', { min_order_quantity: 0.0001 }, 400, 'variant'],
      ['min_order_quantity "0.0001"', { min_order_quantity: '0.0001' }, 400, 'variant'],
      ['min_order_quantity negative', { min_order_quantity: -1 }, 400, 'variant'],
      ['min_order_quantity too large', { min_order_quantity: '1000000000' }, 400, 'variant'],
      ['min_order_quantity 2.5', { min_order_quantity: 2.5 }, 201, 'variant'],
      ['min_order_quantity "2.5"', { min_order_quantity: '2.5' }, 201, 'variant'],
    ];

    it.each(rows)('%s -> %i', async (_label, over, status, level) => {
      const response = await post(ORG_A, level === 'product' ? goodBody(over) : goodBody({}, over));
      expect(response.status).toBe(status);
      if (status === 400) {
        expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
        expect(await productCount()).toBe(0);
      }
    });
  });

  it('AC-3 roles: OWNER and MANAGER get 201, SELLER and DRIVER get 403', async () => {
    expect((await post(ORG_A, goodBody(), OWNER)).status).toBe(201);
    expect(
      (await post(ORG_A, goodBody({ id: GESTURE_2 }, { id: VARIANT_2 }), MANAGER)).status
    ).toBe(201);
    expect(await productCount()).toBe(2);
  });

  it.each([
    ['SELLER', SELLER],
    ['DRIVER', DRIVER],
  ])('AB-1 %s: 403 FORBIDDEN and nothing stored', async (_role, personId) => {
    const response = await post(ORG_A, goodBody(), personId);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await productCount()).toBe(0);
  });

  it.each([
    ['CLOSED', ORG_CLOSED],
    ['SUSPENDED', ORG_SUSPENDED],
  ])('AC-4 %s organization: 409 ORGANIZATION_NOT_ACTIVE', async (_status, orgId) => {
    const response = await post(orgId, goodBody());

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
    expect(await productCount()).toBe(0);
  });

  it('AC-5 repeat: one product, both answers equal', async () => {
    const first = await post(ORG_A, goodBody());
    const second = await post(ORG_A, goodBody());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await productCount()).toBe(1);
  });

  it.each([
    ['status', { status: 'ARCHIVED' }],
    ['organization_id', { organization_id: ORG_B }],
    ['price_updated_at', { price_updated_at: '2020-01-01T00:00:00.000Z' }],
    ['unknown field', { color: 'red' }],
  ])('AB-2 body with %s: 400 and nothing stored', async (_label, extra) => {
    const response = await post(ORG_A, goodBody(extra));

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await productCount()).toBe(0);
  });

  it('AB-3 another business: 404 and nothing stored', async () => {
    const response = await post(ORG_B, goodBody(), MANAGER);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await productCount()).toBe(0);
  });

  it('refuses a request without a token with 401', async () => {
    const { default: request } = await import('supertest');
    const response = await request(app)
      .post(`/api/v1/organizations/${ORG_A}/products`)
      .send(goodBody());

    expect(response.status).toBe(401);
  });
});
