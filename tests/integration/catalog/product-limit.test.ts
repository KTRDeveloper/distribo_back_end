import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { countProductsOnSale } from '../../../src/modules/catalog/catalog.repository';
import { assertRoomForProduct } from '../../../src/modules/catalog/catalog.service';

const ORG_A = '0199c038-0000-7000-8000-0000000000a1';
const ORG_B = '0199c038-0000-7000-8000-0000000000a2';

let seq = 0;
/** A unique UUIDv7-shaped fixture id. */
function fixtureId(): string {
  seq += 1;
  return `0199c038-0000-7000-8000-${String(seq).padStart(12, '0')}`;
}

type VariantSeed = { status?: 'ACTIVE' | 'INACTIVE'; deleted?: boolean };
type ProductSeed = { deleted?: boolean; paused?: boolean; variants?: VariantSeed[] };

/** Inserts a product with its variants (one ACTIVE variant by default). */
async function seedProduct(organizationId: string, seed: ProductSeed = {}): Promise<void> {
  const id = fixtureId();
  await prisma.product.create({
    data: {
      id,
      organizationId,
      name: 'Fixture product',
      deletedAt: seed.deleted ? new Date('2026-02-01T00:00:00.000Z') : null,
      pausedAt: seed.paused ? new Date('2026-02-01T00:00:00.000Z') : null,
    },
  });
  for (const variant of seed.variants ?? [{}]) {
    await prisma.productVariant.create({
      data: {
        id: fixtureId(),
        productId: id,
        organizationId,
        name: `Variant ${seq}`,
        unit: 'kg',
        price: 100n,
        status: variant.status ?? 'ACTIVE',
        deletedAt: variant.deleted ? new Date('2026-02-01T00:00:00.000Z') : null,
      },
    });
  }
}

async function seedMany(organizationId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await seedProduct(organizationId);
}

/** Creates a business with the given product limit (null for none). */
async function seedOrganization(id: string, maxProducts: number | null): Promise<void> {
  await prisma.organization.create({ data: { id, name: 'Fixture Business', maxProducts } });
}

const count = (organizationId: string) =>
  prisma.$transaction((tx) => countProductsOnSale(tx, organizationId));
const assertRoom = (organizationId: string) =>
  prisma.$transaction((tx) => assertRoomForProduct(tx, organizationId));

beforeEach(async () => {
  seq = 0;
  await seedOrganization(ORG_A, 30);
  await seedOrganization(ORG_B, 30);
});

describe('countProductsOnSale', () => {
  it('counts the live, unpaused products with an ACTIVE variant', async () => {
    await seedProduct(ORG_A);
    await seedProduct(ORG_A);
    await seedProduct(ORG_A, { deleted: true });
    await seedProduct(ORG_A, { paused: true });
    expect(await count(ORG_A)).toBe(2);
  });

  it('answers 0 when every variant is INACTIVE or deleted', async () => {
    await seedProduct(ORG_A, {
      variants: [{ status: 'INACTIVE' }, { deleted: true }, { status: 'INACTIVE', deleted: true }],
    });
    expect(await count(ORG_A)).toBe(0);
  });

  it('counts a product once when it has several ACTIVE variants', async () => {
    await seedProduct(ORG_A, { variants: [{}, {}, { status: 'INACTIVE' }] });
    expect(await count(ORG_A)).toBe(1);
  });

  it('answers 0 for a product of another business', async () => {
    await seedProduct(ORG_B);
    expect(await count(ORG_A)).toBe(0);
  });
});

describe('assertRoomForProduct', () => {
  it('throws 409 PRODUCT_LIMIT_REACHED when the count has reached the limit', async () => {
    await seedMany(ORG_A, 30);
    await expect(assertRoom(ORG_A)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PRODUCT_LIMIT_REACHED',
    });
  });

  it('returns when one place is left', async () => {
    await prisma.organization.update({ where: { id: ORG_A }, data: { maxProducts: 31 } });
    await seedMany(ORG_A, 30);
    await expect(assertRoom(ORG_A)).resolves.toBeUndefined();
  });

  it('returns when the plan has no limit', async () => {
    await prisma.organization.update({ where: { id: ORG_A }, data: { maxProducts: null } });
    await seedMany(ORG_A, 30);
    await expect(assertRoom(ORG_A)).resolves.toBeUndefined();
  });

  it('fails closed with 404 when the business is absent', async () => {
    await expect(assertRoom('0199c038-0000-7000-8000-0000000000ff')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});

describe('another business', () => {
  it("leaves out the products of business B from A's count and limit", async () => {
    await seedMany(ORG_A, 2);
    await seedMany(ORG_B, 40);
    expect(await count(ORG_A)).toBe(2);
    await expect(assertRoom(ORG_A)).resolves.toBeUndefined();
    await expect(assertRoom(ORG_B)).rejects.toMatchObject({ code: 'PRODUCT_LIMIT_REACHED' });
  });
});
