import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0d4-0000-7000-8000-000000000001';
const MANAGER = '0199c0d4-0000-7000-8000-000000000002';
const SELLER = '0199c0d4-0000-7000-8000-000000000003';
const DRIVER = '0199c0d4-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0d4-0000-7000-8000-000000000005';

const ORG_A = '0199c0d4-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0d4-0000-7000-8000-0000000000b1';
const ORG_CLOSED = '0199c0d4-0000-7000-8000-0000000000e1';
const ORG_SUSPENDED = '0199c0d4-0000-7000-8000-0000000000f1';

const REG = new Date('2026-01-01T00:00:00.000Z');

const PRODUCT_A = '0199c0d4-0000-7000-8000-0000000000c1';
const PRODUCT_B = '0199c0d4-0000-7000-8000-0000000000c2';
const PRODUCT_CLOSED = '0199c0d4-0000-7000-8000-0000000000c3';
const PRODUCT_SUSPENDED = '0199c0d4-0000-7000-8000-0000000000c4';
const EXISTING = '0199c0d4-0000-7000-8000-0000000000d1';
const NEW_VARIANT = '0199c0d4-0000-7000-8000-0000000000d2';

type VariantBody = {
  id: string;
  name: string | null;
  unit: string;
  label: string;
  price: number;
  status: string;
  min_order_quantity: string | null;
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
  status: 'ACTIVE' | 'CLOSED' | 'SUSPENDED' = 'ACTIVE',
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
  options: {
    variantStatus?: 'ACTIVE' | 'INACTIVE' | null;
    paused?: boolean;
    deleted?: boolean;
    variantId?: string;
  } = {}
) {
  await prisma.product.create({
    data: {
      id,
      organizationId,
      name: 'T-shirt',
      pausedAt: options.paused ? new Date('2026-02-01T00:00:00.000Z') : null,
      deletedAt: options.deleted ? new Date('2026-02-01T00:00:00.000Z') : null,
    },
  });
  if (options.variantStatus === null) return;
  await prisma.productVariant.create({
    data: {
      id: options.variantId ?? EXISTING,
      productId: id,
      organizationId,
      name: 'Bleu / M',
      unit: 'pièce',
      price: 4000n,
      status: options.variantStatus ?? 'ACTIVE',
    },
  });
}

function post(orgId: string, productId: string, body: unknown, personId = MANAGER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/products/${productId}/variants`)
    .send(body as object);
}

const goodBody = (over: Record<string, unknown> = {}) => ({
  id: NEW_VARIANT,
  name: 'Rouge / L',
  unit: 'pièce',
  price: 5000,
  ...over,
});

const variantCount = () => prisma.productVariant.count();

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009201');
  await seedPerson(MANAGER, '+237600009202');
  await seedPerson(SELLER, '+237600009203');
  await seedPerson(DRIVER, '+237600009204');
  await seedPerson(OTHER_OWNER, '+237600009205');
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

describe('POST /api/v1/organizations/:organizationId/products/:productId/variants', () => {
  it('AC-1 add: 201 with the label, ACTIVE, stored under the product and organization', async () => {
    await seedProduct(PRODUCT_A, ORG_A);

    const response = await post(ORG_A, PRODUCT_A, goodBody());

    expect(response.status).toBe(201);
    expect(bodyOf<VariantBody>(response)).toMatchObject({
      id: NEW_VARIANT,
      name: 'Rouge / L',
      unit: 'pièce',
      label: 'T-shirt — Rouge / L (pièce)',
      price: 5000,
      status: 'ACTIVE',
    });
    const row = await prisma.productVariant.findUniqueOrThrow({ where: { id: NEW_VARIANT } });
    expect(row.productId).toBe(PRODUCT_A);
    expect(row.organizationId).toBe(ORG_A);
    expect(row.priceUpdatedAt).toBeInstanceOf(Date);
  });

  it('the owner may add a variant, a paused product accepts it and stays paused', async () => {
    await seedProduct(PRODUCT_A, ORG_A, { paused: true });

    const response = await post(ORG_A, PRODUCT_A, goodBody({ min_order_quantity: '2.5' }), OWNER);

    expect(response.status).toBe(201);
    expect(bodyOf<VariantBody>(response).min_order_quantity).toBe('2.5');
    const product = await prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_A } });
    expect(product.pausedAt).not.toBeNull();
  });

  describe('AC-2 refusals', () => {
    beforeEach(async () => {
      await seedProduct(PRODUCT_A, ORG_A);
    });

    it.each([
      [
        'the name and unit of a live variant, in other case',
        { name: ' bleu  / m ', unit: 'PIÈCE' },
      ],
    ])('%s -> 409 VARIANT_EXISTS, nothing stored', async (_label, over) => {
      const response = await post(ORG_A, PRODUCT_A, goodBody(over));

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VARIANT_EXISTS');
      expect(await variantCount()).toBe(1);
    });

    it('an empty name equals an empty name (C-47)', async () => {
      await prisma.productVariant.update({ where: { id: EXISTING }, data: { name: null } });

      const response = await post(ORG_A, PRODUCT_A, goodBody({ name: undefined }));

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VARIANT_EXISTS');
    });

    it('the same name with another unit is not a twin', async () => {
      expect(
        (await post(ORG_A, PRODUCT_A, goodBody({ name: 'Bleu / M', unit: 'lot' }))).status
      ).toBe(201);
    });

    it('a deleted variant of the same text is not a twin', async () => {
      await prisma.productVariant.update({
        where: { id: EXISTING },
        data: { deletedAt: new Date('2026-02-01T00:00:00.000Z') },
      });

      expect((await post(ORG_A, PRODUCT_A, goodBody({ name: 'Bleu / M' }))).status).toBe(201);
    });

    it.each([
      ['price 0', { price: 0 }],
      ['price 1.5', { price: 1.5 }],
      ['an empty unit', { unit: '' }],
      ['no unit', { unit: undefined }],
      ['an empty name', { name: '' }],
      ['min_order_quantity 0', { min_order_quantity: 0 }],
      ['a status', { status: 'INACTIVE' }],
      ['a product_id', { product_id: PRODUCT_B }],
      ['an organization_id', { organization_id: ORG_B }],
      ['image_keys', { image_keys: [] }],
      ['a price_updated_at', { price_updated_at: '2020-01-01T00:00:00.000Z' }],
    ])('%s -> 400 VALIDATION_ERROR, nothing stored', async (_label, over) => {
      const response = await post(ORG_A, PRODUCT_A, goodBody(over));

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await variantCount()).toBe(1);
    });

    it('a product id that is not a UUID -> 400 VALIDATION_ERROR', async () => {
      const response = await post(ORG_A, 'not-a-uuid', goodBody());

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    });

    it('a deleted product -> 404 NOT_FOUND, nothing stored', async () => {
      await seedProduct(PRODUCT_B, ORG_A, {
        deleted: true,
        variantId: '0199c0d4-0000-7000-8000-0000000000d3',
      });

      const response = await post(ORG_A, PRODUCT_B, goodBody());

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await variantCount()).toBe(2);
    });

    it('an unknown product -> 404 NOT_FOUND', async () => {
      const response = await post(ORG_A, PRODUCT_B, goodBody());

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    });

    it.each([
      ['CLOSED', ORG_CLOSED, PRODUCT_CLOSED],
      ['SUSPENDED', ORG_SUSPENDED, PRODUCT_SUSPENDED],
    ])(
      'a %s organization -> 409 ORGANIZATION_NOT_ACTIVE, nothing stored',
      async (_s, org, product) => {
        await seedProduct(product, org, { variantId: '0199c0d4-0000-7000-8000-0000000000d4' });

        const response = await post(org, product, goodBody());

        expect(response.status).toBe(409);
        expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
        expect(await variantCount()).toBe(2);
      }
    );

    it.each([
      ['SELLER', SELLER],
      ['DRIVER', DRIVER],
    ])('a %s caller -> 403 FORBIDDEN, nothing stored', async (_role, personId) => {
      const response = await post(ORG_A, PRODUCT_A, goodBody(), personId);

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
      expect(await variantCount()).toBe(1);
    });
  });

  describe('AC-3 back on sale', () => {
    const seedOnSale = async (orgId: string, count: number) => {
      for (let i = 0; i < count; i += 1) {
        const id = `0199c0d4-0000-7000-8000-${String(5000 + i).padStart(12, '0')}`;
        await prisma.product.create({
          data: { id, organizationId: orgId, name: `Fixture ${i}` },
        });
        await prisma.productVariant.create({
          data: {
            id: `0199c0d4-0000-7000-8000-${String(6000 + i).padStart(12, '0')}`,
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

    it('a product with only INACTIVE variants: 409 PRODUCT_LIMIT_REACHED, nothing added', async () => {
      await seedProduct(PRODUCT_A, ORG_A, { variantStatus: 'INACTIVE' });

      const response = await post(ORG_A, PRODUCT_A, goodBody());

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('PRODUCT_LIMIT_REACHED');
      expect(await variantCount()).toBe(31);
    });

    it('a product that has an ACTIVE variant: 201', async () => {
      await seedProduct(PRODUCT_A, ORG_A, { variantStatus: 'ACTIVE' });
      expect((await post(ORG_A, PRODUCT_A, goodBody())).status).toBe(201);
    });

    it('a product with no variant at all: 409 PRODUCT_LIMIT_REACHED', async () => {
      await seedProduct(PRODUCT_A, ORG_A, { variantStatus: null });

      const response = await post(ORG_A, PRODUCT_A, goodBody());

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('PRODUCT_LIMIT_REACHED');
    });

    it('a paused product with only INACTIVE variants accepts the variant, whatever the count', async () => {
      await seedProduct(PRODUCT_A, ORG_A, { variantStatus: 'INACTIVE', paused: true });

      expect((await post(ORG_A, PRODUCT_A, goodBody())).status).toBe(201);
    });
  });

  it('AC-4 repeat: one variant, both answers equal', async () => {
    await seedProduct(PRODUCT_A, ORG_A);

    const first = await post(ORG_A, PRODUCT_A, goodBody());
    const second = await post(ORG_A, PRODUCT_A, goodBody());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.productVariant.count({ where: { productId: PRODUCT_A } })).toBe(2);
  });

  it('a race on the same text falls on the unique index: one 201, one 409 VARIANT_EXISTS', async () => {
    await seedProduct(PRODUCT_A, ORG_A);

    const [first, second] = await Promise.all([
      post(ORG_A, PRODUCT_A, goodBody()),
      post(ORG_A, PRODUCT_A, goodBody({ id: '0199c0d4-0000-7000-8000-0000000000d9' })),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(bodyOf<ErrorBody>(loser).error.code).toBe('VARIANT_EXISTS');
    expect(await prisma.productVariant.count({ where: { productId: PRODUCT_A } })).toBe(2);
  });

  it.each([
    ['SELLER', SELLER],
    ['DRIVER', DRIVER],
  ])('AB-1 %s: 403, nothing stored', async (_role, personId) => {
    await seedProduct(PRODUCT_A, ORG_A);

    const response = await post(ORG_A, PRODUCT_A, goodBody(), personId);

    expect(response.status).toBe(403);
    expect(await variantCount()).toBe(1);
  });

  it('AB-2 a member of A posting to the product of B: 404, B unchanged', async () => {
    await seedProduct(PRODUCT_B, ORG_B);

    const underOwnPath = await post(ORG_A, PRODUCT_B, goodBody());
    const underOtherPath = await post(ORG_B, PRODUCT_B, goodBody());

    expect(underOwnPath.status).toBe(404);
    expect(bodyOf<ErrorBody>(underOwnPath).error.code).toBe('NOT_FOUND');
    expect(underOtherPath.status).toBe(404);
    expect(await variantCount()).toBe(1);
    expect(await prisma.productVariant.count({ where: { productId: PRODUCT_B } })).toBe(1);
  });
});
