import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0c4-0000-7000-8000-000000000001';
const MANAGER = '0199c0c4-0000-7000-8000-000000000002';
const SELLER = '0199c0c4-0000-7000-8000-000000000003';
const DRIVER = '0199c0c4-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0c4-0000-7000-8000-000000000005';

const ORG_A = '0199c0c4-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0c4-0000-7000-8000-0000000000b1';
const ORG_CLOSED = '0199c0c4-0000-7000-8000-0000000000e1';
const ORG_SUSPENDED = '0199c0c4-0000-7000-8000-0000000000f1';

const REG = new Date('2026-01-01T00:00:00.000Z');

const PRODUCT_ID = '0199c0c4-0000-7000-8000-0000000000c1';
// Deliberately not in ascending order: the answer must follow the request order.
const VARIANT_BIG = '0199c0c4-0000-7000-8000-0000000000d9';
const VARIANT_SMALL = '0199c0c4-0000-7000-8000-0000000000d1';

type VariantBody = {
  id: string;
  name: string | null;
  unit: string;
  label: string;
  price: number;
  status: string;
};
type ProductBody = { id: string; name: string; variants: VariantBody[] };

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
  status: 'ACTIVE' | 'CLOSED' | 'SUSPENDED' = 'ACTIVE',
  maxProducts: number | null = null
) {
  await prisma.organization.create({
    data: { id, name: 'Org ' + id.slice(-2), status, maxProducts },
  });
  await seedMember(id, ownerId, 'OWNER', 9);
}

function post(orgId: string, body: unknown, personId = MANAGER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/products`)
    .send(body as object);
}

const variants = () => [
  { id: VARIANT_BIG, unit: 'sac 25 kg', price: 15000 },
  { id: VARIANT_SMALL, unit: 'sac 10 kg', price: 7000 },
];

const goodBody = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT_ID,
  name: 'Riz parfumé',
  variants: variants(),
  ...over,
});

const nothingStored = async () => {
  expect(await prisma.product.count()).toBe(0);
  expect(await prisma.productVariant.count()).toBe(0);
};

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009101');
  await seedPerson(MANAGER, '+237600009102');
  await seedPerson(SELLER, '+237600009103');
  await seedPerson(DRIVER, '+237600009104');
  await seedPerson(OTHER_OWNER, '+237600009105');
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

describe('POST /api/v1/organizations/:organizationId/products with variants', () => {
  it('AC-1 created: 201, both variants in request order, ACTIVE, labelled', async () => {
    const response = await post(ORG_A, goodBody());

    expect(response.status).toBe(201);
    const body = bodyOf<ProductBody>(response);
    expect(body.variants.map((v) => v.id)).toEqual([VARIANT_BIG, VARIANT_SMALL]);
    expect(body.variants[0]).toMatchObject({
      unit: 'sac 25 kg',
      price: 15000,
      status: 'ACTIVE',
      label: 'Riz parfumé — sac 25 kg',
    });
    expect(body.variants[1]).toMatchObject({ unit: 'sac 10 kg', price: 7000, status: 'ACTIVE' });

    const rows = await prisma.productVariant.findMany({ where: { productId: PRODUCT_ID } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.organizationId === ORG_A && row.status === 'ACTIVE')).toBe(true);
    expect(rows.every((row) => row.priceUpdatedAt instanceof Date)).toBe(true);
  });

  it('C-13 accepts 50 variants and the price 1', async () => {
    const fifty = Array.from({ length: 50 }, (_unused, i) => ({
      id: `0199c0c4-0000-7000-8000-${String(1000 + i).padStart(12, '0')}`,
      unit: `unit ${i}`,
      price: 1,
    }));
    const response = await post(ORG_A, goodBody({ variants: fifty }));

    expect(response.status).toBe(201);
    expect(bodyOf<ProductBody>(response).variants).toHaveLength(50);
  });

  describe('AC-2 refusals', () => {
    const v = (over: Record<string, unknown>) => ({ ...variants()[0], ...over });
    const rows: [string, Record<string, unknown>][] = [
      ['no variant', { variants: [] }],
      [
        '51 variants',
        {
          variants: Array.from({ length: 51 }, (_unused, i) => ({
            id: `0199c0c4-0000-7000-8000-${String(2000 + i).padStart(12, '0')}`,
            unit: `unit ${i}`,
            price: 10,
          })),
        },
      ],
      ['variants missing', { variants: undefined }],
      ['price 0', { variants: [v({ price: 0 })] }],
      ['price 1.5', { variants: [v({ price: 1.5 })] }],
      ['no unit', { variants: [{ id: VARIANT_BIG, price: 100 }] }],
      ['variant name empty', { variants: [v({ name: '' })] }],
      ['variant name 101 chars', { variants: [v({ name: 'a'.repeat(101) })] }],
      ['min_order_quantity 0', { variants: [v({ min_order_quantity: 0 })] }],
      ['a top-level unit', { unit: 'sac' }],
      ['a top-level price', { price: 100 }],
      ['a variant status', { variants: [v({ status: 'INACTIVE' })] }],
      ['a variant organization_id', { variants: [v({ organization_id: ORG_B })] }],
      ['organization_id', { organization_id: ORG_B }],
      ['image_keys', { image_keys: [] }],
      ['paused_at', { paused_at: '2020-01-01T00:00:00.000Z' }],
      ['the same variant id twice', { variants: [v({}), v({ unit: 'other' })] }],
    ];

    it.each(rows)('%s -> 400 VALIDATION_ERROR, nothing stored', async (_label, over) => {
      const response = await post(ORG_A, goodBody(over));

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      await nothingStored();
    });

    it('two variants "Sac 10 kg" and " sac  10 KG " -> 409 VARIANT_EXISTS, nothing stored', async () => {
      const response = await post(
        ORG_A,
        goodBody({
          variants: [
            { id: VARIANT_BIG, unit: 'Sac 10 kg', price: 7000 },
            { id: VARIANT_SMALL, unit: ' sac  10 KG ', price: 7000 },
          ],
        })
      );

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VARIANT_EXISTS');
      await nothingStored();
    });

    it('the same unit under different names is not a twin', async () => {
      const response = await post(
        ORG_A,
        goodBody({
          variants: [
            { id: VARIANT_BIG, name: 'Parfumé', unit: 'sac', price: 7000 },
            { id: VARIANT_SMALL, name: 'Local', unit: 'sac', price: 6000 },
          ],
        })
      );

      expect(response.status).toBe(201);
    });

    it.each([
      ['CLOSED', ORG_CLOSED],
      ['SUSPENDED', ORG_SUSPENDED],
    ])('a %s organization -> 409 ORGANIZATION_NOT_ACTIVE, nothing stored', async (_s, orgId) => {
      const response = await post(orgId, goodBody());

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
      await nothingStored();
    });
  });

  describe('AC-3 plan limit', () => {
    const seedOnSale = async (orgId: string, count: number) => {
      for (let i = 0; i < count; i += 1) {
        const id = `0199c0c4-0000-7000-8000-${String(5000 + i).padStart(12, '0')}`;
        await prisma.product.create({
          data: { id, organizationId: orgId, name: `Fixture ${i}`, unit: '', price: 100n },
        });
        await prisma.productVariant.create({
          data: {
            id: `0199c0c4-0000-7000-8000-${String(6000 + i).padStart(12, '0')}`,
            productId: id,
            organizationId: orgId,
            unit: 'kg',
            price: 100n,
          },
        });
      }
    };

    it('a FREE business with 30 products on sale: 409 PRODUCT_LIMIT_REACHED, nothing added', async () => {
      await prisma.organization.update({ where: { id: ORG_A }, data: { maxProducts: 30 } });
      await seedOnSale(ORG_A, 30);

      const response = await post(ORG_A, goodBody());

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('PRODUCT_LIMIT_REACHED');
      expect(await prisma.product.count()).toBe(30);
      expect(await prisma.productVariant.count()).toBe(30);
    });

    it('an unlimited plan answers 201', async () => {
      await seedOnSale(ORG_A, 30);

      expect((await post(ORG_A, goodBody())).status).toBe(201);
    });
  });

  it('AC-4 repeat: one product and its variants, both answers equal', async () => {
    const first = await post(ORG_A, goodBody());
    const second = await post(ORG_A, goodBody());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.productVariant.count()).toBe(2);
  });

  it.each([
    ['SELLER', SELLER],
    ['DRIVER', DRIVER],
  ])('AB-1 %s: 403 FORBIDDEN, nothing stored', async (_role, personId) => {
    const response = await post(ORG_A, goodBody(), personId);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    await nothingStored();
  });

  it('AB-2 a member of A posting to the path of B: 404, nothing stored', async () => {
    const response = await post(ORG_B, goodBody(), MANAGER);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    await nothingStored();
  });

  it('rolls back the product when a later variant fails in the database', async () => {
    // A variant id already used by another business makes the second insert fail after the
    // product was written: the whole gesture must leave nothing behind.
    await prisma.product.create({
      data: {
        id: '0199c0c4-0000-7000-8000-0000000000aa',
        organizationId: ORG_B,
        name: 'B',
        unit: '',
      },
    });
    await prisma.productVariant.create({
      data: {
        id: VARIANT_SMALL,
        productId: '0199c0c4-0000-7000-8000-0000000000aa',
        organizationId: ORG_B,
        unit: 'kg',
        price: 100n,
      },
    });

    const response = await post(ORG_A, goodBody());

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.product.findUnique({ where: { id: PRODUCT_ID } })).toBeNull();
    expect(await prisma.productVariant.count({ where: { organizationId: ORG_A } })).toBe(0);
  });
});
