import { beforeEach, describe, expect, it } from 'vitest';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup.js';

const ORGANIZATION_ID = '0199c040-0000-7000-8000-000000000001';
const PRODUCT_ID = '0199c040-0000-7000-8000-000000000011';
const PAUSED_AT = new Date('2026-02-01T00:00:00.000Z');
const DELETED_AT = new Date('2026-02-02T00:00:00.000Z');

beforeEach(async () => {
  await prisma.organization.create({ data: { id: ORGANIZATION_ID, name: 'Fixture Business' } });
});

describe('seedProduct', () => {
  it('creates one product and one ACTIVE variant with the same id and organization', async () => {
    const result = await seedProduct(prisma, { id: PRODUCT_ID, organizationId: ORGANIZATION_ID });

    expect(result).toEqual({ productId: PRODUCT_ID, variantId: PRODUCT_ID });
    expect(await prisma.product.findMany()).toMatchObject([
      {
        id: PRODUCT_ID,
        organizationId: ORGANIZATION_ID,
        name: 'Product',
        pausedAt: null,
        deletedAt: null,
      },
    ]);
    expect(await prisma.productVariant.findMany()).toMatchObject([
      {
        id: PRODUCT_ID,
        productId: PRODUCT_ID,
        organizationId: ORGANIZATION_ID,
        unit: 'kg',
        price: 1000n,
        status: 'ACTIVE',
        name: null,
        minOrderQuantity: null,
        deletedAt: null,
      },
    ]);
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.productVariant.count()).toBe(1);
  });

  it('writes options to the variant, the pause to the product and deletion to both', async () => {
    await seedProduct(prisma, {
      id: PRODUCT_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Fixture Rice',
      unit: 'sac',
      price: 15000n,
      minOrderQuantity: '2.000',
      status: 'INACTIVE',
      variantName: '25 kg',
      pausedAt: PAUSED_AT,
      deletedAt: DELETED_AT,
    });

    expect(await prisma.product.findUniqueOrThrow({ where: { id: PRODUCT_ID } })).toMatchObject({
      name: 'Fixture Rice',
      pausedAt: PAUSED_AT,
      deletedAt: DELETED_AT,
    });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: PRODUCT_ID } });
    expect(variant).toMatchObject({
      productId: PRODUCT_ID,
      organizationId: ORGANIZATION_ID,
      unit: 'sac',
      price: 15000n,
      status: 'INACTIVE',
      name: '25 kg',
      deletedAt: DELETED_AT,
    });
    expect(variant.minOrderQuantity?.toFixed(3)).toBe('2.000');
  });

  it('commits both rows with the transaction client', async () => {
    const result = await prisma.$transaction(async (tx) => {
      const seeded = await seedProduct(tx, { id: PRODUCT_ID, organizationId: ORGANIZATION_ID });
      expect(await tx.product.count()).toBe(1);
      expect(await tx.productVariant.count()).toBe(1);
      return seeded;
    });

    expect(result).toEqual({ productId: PRODUCT_ID, variantId: PRODUCT_ID });
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.productVariant.count()).toBe(1);
  });

  it('rolls back both rows with the enclosing transaction', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await seedProduct(tx, { id: PRODUCT_ID, organizationId: ORGANIZATION_ID });
        throw new Error('rollback fixture');
      })
    ).rejects.toThrow('rollback fixture');

    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.productVariant.count()).toBe(0);
  });

  it('leaves no product when the variant write fails in a transaction', async () => {
    await expect(
      prisma.$transaction((tx) =>
        seedProduct(tx, { id: PRODUCT_ID, organizationId: ORGANIZATION_ID, price: 0n })
      )
    ).rejects.toThrow();

    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.productVariant.count()).toBe(0);
  });
});
