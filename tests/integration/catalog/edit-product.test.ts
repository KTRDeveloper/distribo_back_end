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

const ORG_A = '0199c0b5-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0b5-0000-7000-8000-0000000000b1';

const PRODUCT_A = '0199c0b5-0000-7000-8000-0000000000c1';
const PRODUCT_B = '0199c0b5-0000-7000-8000-0000000000c2';
const UNKNOWN = '0199c0b5-0000-7000-8000-0000000000c9';

const REG = new Date('2026-01-01T00:00:00.000Z');

type ProductBody = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  image_urls: string[];
  paused: boolean;
  variants: unknown[];
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

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009101');
  await seedPerson(MANAGER, '+237600009102');
  await seedPerson(SELLER, '+237600009103');
  await seedPerson(DRIVER, '+237600009104');
  await seedPerson(OTHER_OWNER, '+237600009105');
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
  it('AC-1 change fields: 200, new values, closed product view with its variants', async () => {
    const response = await patch(ORG_A, PRODUCT_A, { name: 'Riz long', category: 'Épicerie' });

    expect(response.status).toBe(200);
    const body = bodyOf<ProductBody>(response);
    expect(body).toMatchObject({
      id: PRODUCT_A,
      name: 'Riz long',
      category: 'Épicerie',
      description: 'Sac',
    });
    expect(Object.keys(body).sort()).toEqual(
      ['category', 'description', 'id', 'image_urls', 'name', 'paused', 'variants'].sort()
    );
    expect(await rowOf(PRODUCT_A)).toMatchObject({ name: 'Riz long', category: 'Épicerie' });
  });

  it('AC-2 description null clears it', async () => {
    const response = await patch(ORG_A, PRODUCT_A, { description: null });

    expect(response.status).toBe(200);
    expect(bodyOf<ProductBody>(response).description).toBeNull();
    expect((await rowOf(PRODUCT_A)).description).toBeNull();
  });

  it('OWNER may edit too', async () => {
    expect((await patch(ORG_A, PRODUCT_A, { name: 'Par le patron' }, OWNER)).status).toBe(200);
  });

  describe('AC-4 refusals', () => {
    const rows: [string, Record<string, unknown>][] = [
      ['no field', {}],
      ['status sent', { status: 'INACTIVE' }],
      ['price sent', { price: 100 }],
      ['organization_id sent', { organization_id: ORG_B }],
      ['price_updated_at sent', { price_updated_at: '2020-01-01T00:00:00.000Z' }],
      ['unknown field', { color: 'red' }],
      ['name empty', { name: '' }],
      ['name 101 chars', { name: 'a'.repeat(101) }],
      ['description 2001 chars', { description: 'a'.repeat(2001) }],
      ['min_order_quantity sent', { min_order_quantity: 2 }],
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

  it('AB-1 seller renames an article: 403 and the name is unchanged', async () => {
    const response = await patch(ORG_A, PRODUCT_A, { name: 'Renommé' }, SELLER);

    expect(response.status).toBe(403);
    expect((await rowOf(PRODUCT_A)).name).toBe('Riz');
  });

  it('AB-2 member of A patches a product of B under A path: 404 and B unchanged', async () => {
    const before = await rowOf(PRODUCT_B);
    const response = await patch(ORG_A, PRODUCT_B, { name: 'Volé', category: null });

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
