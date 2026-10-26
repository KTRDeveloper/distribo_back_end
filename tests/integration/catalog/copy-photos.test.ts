import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import * as catalogRepository from '../../../src/modules/catalog/catalog.repository.js';
import type { CopyProductResult } from '../../../src/modules/catalog/catalog.schemas.js';
import * as imageCopyService from '../../../src/modules/images/image-copy.service.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const id = (n: number) => `0199c045-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const OWNER = id(1);
const SUPPLIER_OWNER = id(2);
const SECOND_OWNER = id(3);
const BUYER = id(10);
const SUPPLIER = id(11);
const SECOND_BUYER = id(12);
const RELATIONSHIP = id(20);
const SOURCE = id(30);
const DESTINATION = id(31);
const SOURCE_VARIANT = id(40);
const EXISTING_VARIANT = id(41);
const NEW_PRODUCT = id(50);
const NEW_VARIANT = id(51);
const SECOND_PRODUCT = id(52);
const SECOND_VARIANT = id(53);
const REG = new Date('2026-01-01T00:00:00.000Z');
const key = (n: number) =>
  `products/0199c045-0000-4000-8000-${n.toString(16).padStart(12, '0')}.webp`;
const PRODUCT_PHOTOS = [key(100), key(101)];
const VARIANT_PHOTOS = [key(110), key(111)];
const EXISTING_PHOTOS = [key(120), key(121)];
const EXISTING_VARIANT_PHOTO = key(122);
const files = new Map<string, Buffer>();
let nextCopy = 200;

function copyBody(destination: object = {}) {
  return {
    id: NEW_PRODUCT,
    source_product_id: SOURCE,
    destination,
    variants: [{ id: NEW_VARIANT, source_variant_id: SOURCE_VARIANT, price: 16000 }],
  };
}

function copy(body: object = copyBody(), organizationId = BUYER, personId = OWNER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/products/copy`)
    .send(body);
}

async function copiedRows(productId = NEW_PRODUCT, variantId = NEW_VARIANT) {
  return {
    product: await prisma.product.findUniqueOrThrow({ where: { id: productId } }),
    variant: await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } }),
  };
}

async function expectRolledBack() {
  expect(await prisma.product.findUnique({ where: { id: NEW_PRODUCT } })).toBeNull();
  expect(await prisma.productVariant.findUnique({ where: { id: NEW_VARIANT } })).toBeNull();
  expect(await prisma.imageCopy.count()).toBe(0);
  expect((await prisma.product.findUniqueOrThrow({ where: { id: SOURCE } })).imageKeys).toEqual(
    PRODUCT_PHOTOS
  );
  expect(
    (await prisma.productVariant.findUniqueOrThrow({ where: { id: SOURCE_VARIANT } })).imageKeys
  ).toEqual(VARIANT_PHOTOS);
}

beforeEach(async () => {
  files.clear();
  nextCopy = 200;
  for (const sourceKey of [...PRODUCT_PHOTOS, ...VARIANT_PHOTOS, ...EXISTING_PHOTOS]) {
    files.set(sourceKey, Buffer.from(sourceKey));
  }
  // IMG-006 owns storage and lineage; this fake exercises CAT-045's transaction boundary.
  vi.spyOn(imageCopyService, 'copyImage').mockImplementation(async (tx, sourceKey) => {
    const bytes = files.get(sourceKey);
    if (!bytes) return null;
    const copyKey = key(nextCopy++);
    files.set(copyKey, Buffer.from(bytes));
    const sourceCopy = await tx.imageCopy.findUnique({ where: { copyKey: sourceKey } });
    await tx.imageCopy.create({
      data: { copyKey, sourceKey, rootKey: sourceCopy?.rootKey ?? sourceKey },
    });
    return copyKey;
  });

  for (const [index, personId] of [OWNER, SUPPLIER_OWNER, SECOND_OWNER].entries()) {
    await prisma.person.create({
      data: {
        id: personId,
        fullName: 'Fixture Person',
        phoneNumber: `+23760004500${index}`,
        phoneVerifiedAt: REG,
        passwordHash: 'test-password-hash',
        registeredAt: REG,
      },
    });
  }
  for (const [index, organizationId, personId] of [
    [1, BUYER, OWNER],
    [2, SUPPLIER, SUPPLIER_OWNER],
    [3, SECOND_BUYER, SECOND_OWNER],
  ] as const) {
    await prisma.organization.create({ data: { id: organizationId, name: 'Fixture Business' } });
    await prisma.collaboration.create({
      data: {
        id: id(60 + index),
        personId,
        organizationId,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  }
  for (const [relationshipId, customerOrganizationId] of [
    [RELATIONSHIP, BUYER],
    [id(21), SECOND_BUYER],
  ] as const) {
    await prisma.customerRelationship.create({
      data: {
        id: relationshipId,
        supplierOrganizationId: SUPPLIER,
        customerOrganizationId,
        status: 'ACTIVE',
        createdById: SUPPLIER_OWNER,
      },
    });
  }
  await prisma.product.createMany({
    data: [
      {
        id: SOURCE,
        organizationId: SUPPLIER,
        name: 'Riz',
        imageKeys: PRODUCT_PHOTOS,
      },
      {
        id: DESTINATION,
        organizationId: BUYER,
        name: 'Notre riz',
        imageKeys: EXISTING_PHOTOS,
      },
    ],
  });
  await prisma.productVariant.create({
    data: {
      id: SOURCE_VARIANT,
      productId: SOURCE,
      organizationId: SUPPLIER,
      name: 'sac 25 kg',
      unit: 'sac',
      price: 12000n,
      imageKeys: VARIANT_PHOTOS,
    },
  });
});

afterEach(() => vi.restoreAllMocks());

describe('CAT-045 copied catalog photos', () => {
  it('AC-1 copies new product and variant photos in order without changing the supplier', async () => {
    const response = await copy();
    expect(response.status).toBe(201);
    const result = bodyOf<CopyProductResult>(response);
    const rows = await copiedRows();
    for (const [copiedKeys, sourceKeys, urls] of [
      [rows.product.imageKeys, PRODUCT_PHOTOS, result.product.image_urls],
      [rows.variant.imageKeys, VARIANT_PHOTOS, result.product.variants[0].image_urls],
    ]) {
      expect(copiedKeys).toHaveLength(2);
      expect(urls).toHaveLength(2);
      for (const [index, copyKey] of copiedKeys.entries()) {
        expect(sourceKeys).not.toContain(copyKey);
        expect(files.get(copyKey)).toEqual(files.get(sourceKeys.at(index)!));
        expect(urls.at(index)).toContain(copyKey);
      }
    }
    expect((await prisma.product.findUniqueOrThrow({ where: { id: SOURCE } })).imageKeys).toEqual(
      PRODUCT_PHOTOS
    );
    expect(
      (await prisma.productVariant.findUniqueOrThrow({ where: { id: SOURCE_VARIANT } })).imageKeys
    ).toEqual(VARIANT_PHOTOS);
  });

  it('AC-2 keeps an existing destination product photos and copies only the new variant photos', async () => {
    const response = await copy(copyBody({ product_id: DESTINATION }));
    expect(response.status).toBe(201);
    const rows = await copiedRows(DESTINATION);
    expect(rows.product.imageKeys).toEqual(EXISTING_PHOTOS);
    expect(rows.variant.imageKeys).toHaveLength(2);
    expect(
      vi.mocked(imageCopyService.copyImage).mock.calls.map(([, sourceKey]) => sourceKey)
    ).toEqual(VARIANT_PHOTOS);
    expect(bodyOf<CopyProductResult>(response).product.image_urls).toEqual(
      EXISTING_PHOTOS.map((sourceKey) => expect.stringContaining(sourceKey) as unknown)
    );
  });

  it('AC-3 keeps already_in_catalog variant photos without copying any files', async () => {
    await prisma.productVariant.create({
      data: {
        id: EXISTING_VARIANT,
        productId: DESTINATION,
        organizationId: BUYER,
        name: ' SAC 25 KG ',
        unit: ' SAC ',
        price: 17000n,
        imageKeys: [EXISTING_VARIANT_PHOTO],
      },
    });
    const response = await copy(copyBody({ product_id: DESTINATION }));
    expect(response.status).toBe(201);
    const result = bodyOf<CopyProductResult>(response);
    expect(result.copied).toEqual([]);
    expect(result.already_in_catalog).toEqual([
      { source_variant_id: SOURCE_VARIANT, variant_id: EXISTING_VARIANT, status: 'ACTIVE' },
    ]);
    expect((await copiedRows(DESTINATION, EXISTING_VARIANT)).variant.imageKeys).toEqual([
      EXISTING_VARIANT_PHOTO,
    ]);
    expect(imageCopyService.copyImage).not.toHaveBeenCalled();
    expect(await prisma.imageCopy.count()).toBe(0);
  });

  it.each(['product', 'variant'] as const)('AC-4 skips a missing %s source file', async (card) => {
    const sourceKeys = card === 'product' ? PRODUCT_PHOTOS : VARIANT_PHOTOS;
    files.delete(sourceKeys[0]);
    const response = await copy();
    expect(response.status).toBe(201);
    const rows = await copiedRows();
    const copiedKeys = card === 'product' ? rows.product.imageKeys : rows.variant.imageKeys;
    expect(copiedKeys).toHaveLength(1);
    expect(files.get(copiedKeys[0])).toEqual(files.get(sourceKeys[1]));
    const result = bodyOf<CopyProductResult>(response);
    expect(
      card === 'product' ? result.product.image_urls : result.product.variants[0].image_urls
    ).toHaveLength(1);
    expect(await prisma.imageCopy.count()).toBe(3);
  });

  it('AC-5 registers each copy with its source and inherited root', async () => {
    const rootKey = key(130);
    await prisma.imageCopy.create({
      data: { copyKey: VARIANT_PHOTOS[0], sourceKey: rootKey, rootKey },
    });
    const response = await copy();
    expect(response.status).toBe(201);
    const rows = await copiedRows();
    for (const [copiedKeys, sourceKeys] of [
      [rows.product.imageKeys, PRODUCT_PHOTOS],
      [rows.variant.imageKeys, VARIANT_PHOTOS],
    ]) {
      for (const [index, copyKey] of copiedKeys.entries()) {
        const sourceKey = sourceKeys.at(index)!;
        expect(await prisma.imageCopy.findUnique({ where: { copyKey } })).toMatchObject({
          copyKey,
          sourceKey,
          rootKey: sourceKey === VARIANT_PHOTOS[0] ? rootKey : sourceKey,
        });
      }
    }
    expect(await prisma.imageCopy.count()).toBe(5);
  });

  it('AB-1 gives two resellers files with distinct keys from each other and the supplier', async () => {
    const first = await copy();
    const second = await copy(
      {
        ...copyBody(),
        id: SECOND_PRODUCT,
        variants: [{ id: SECOND_VARIANT, source_variant_id: SOURCE_VARIANT, price: 18000 }],
      },
      SECOND_BUYER,
      SECOND_OWNER
    );
    expect([first.status, second.status]).toEqual([201, 201]);
    const rows = await copiedRows();
    const other = await copiedRows(SECOND_PRODUCT, SECOND_VARIANT);
    const allKeys = [
      ...PRODUCT_PHOTOS,
      ...VARIANT_PHOTOS,
      ...rows.product.imageKeys,
      ...rows.variant.imageKeys,
      ...other.product.imageKeys,
      ...other.variant.imageKeys,
    ];
    expect(allKeys).toHaveLength(12);
    expect(new Set(allKeys).size).toBe(12);
    expect(allKeys.every((imageKey) => files.has(imageKey))).toBe(true);
  });

  it('AB-2 exposes only copied image URLs, never supplier keys or registry fields', async () => {
    const response = await copy();
    expect(response.status).toBe(201);
    const rows = await copiedRows();
    const serialized = JSON.stringify(
      [response.body as unknown, rows.product, rows.variant],
      (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value)
    );
    for (const sourceKey of [...PRODUCT_PHOTOS, ...VARIANT_PHOTOS]) {
      expect(serialized).not.toContain(sourceKey);
    }
    const result = bodyOf<CopyProductResult>(response);
    expect(Object.keys(result).sort()).toEqual(['already_in_catalog', 'copied', 'product']);
    expect(Object.keys(result.product).sort()).toEqual([
      'category',
      'description',
      'id',
      'image_urls',
      'name',
      'paused',
      'variants',
    ]);
    expect(Object.keys(result.product.variants[0]).sort()).toEqual([
      'id',
      'image_urls',
      'label',
      'min_order_quantity',
      'name',
      'price',
      'price_updated_at',
      'status',
      'unit',
    ]);
  });

  it('rolls back cards and registry on a later storage error, leaving stored files for cleanup', async () => {
    const fakeCopy = vi.mocked(imageCopyService.copyImage).getMockImplementation()!;
    vi.mocked(imageCopyService.copyImage).mockImplementation(async (tx, sourceKey) => {
      if (sourceKey === VARIANT_PHOTOS[1]) throw new Error('Fixture storage failure');
      return fakeCopy(tx, sourceKey);
    });
    const before = files.size;
    const response = await copy();
    expect(response.status).toBe(500);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('INTERNAL_ERROR');
    await expectRolledBack();
    expect(files.size).toBeGreaterThan(before);
  });

  it('rolls back cards and registry when the destination photo write fails', async () => {
    vi.spyOn(catalogRepository, 'setVariantImageKeys').mockRejectedValue(
      new Error('Fixture database failure')
    );
    const response = await copy();
    expect(response.status).toBe(500);
    await expectRolledBack();
  });

  it('does not read or copy photos without a live supplier relationship', async () => {
    await prisma.customerRelationship.update({
      where: { id: RELATIONSHIP },
      data: { deletedAt: REG },
    });
    const response = await copy();
    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(imageCopyService.copyImage).not.toHaveBeenCalled();
    await expectRolledBack();
  });

  it('an idempotent repeat keeps the first photo URLs and creates no extra files or registry rows', async () => {
    const first = await copy();
    expect(first.status).toBe(201);
    const before = files.size;
    const second = await copy();
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(files.size).toBe(before);
    expect(imageCopyService.copyImage).toHaveBeenCalledTimes(4);
    expect(await prisma.imageCopy.count()).toBe(4);
  });

  it('C-49 copies the maximum five photos per card in display order', async () => {
    const productKeys = Array.from({ length: 5 }, (_, index) => key(300 + index));
    const variantKeys = Array.from({ length: 5 }, (_, index) => key(310 + index));
    for (const sourceKey of [...productKeys, ...variantKeys]) {
      files.set(sourceKey, Buffer.from(sourceKey));
    }
    await prisma.product.update({ where: { id: SOURCE }, data: { imageKeys: productKeys } });
    await prisma.productVariant.update({
      where: { id: SOURCE_VARIANT },
      data: { imageKeys: variantKeys },
    });
    const response = await copy();
    expect(response.status).toBe(201);
    const rows = await copiedRows();
    expect(rows.product.imageKeys.map((imageKey) => files.get(imageKey))).toEqual(
      productKeys.map((imageKey) => files.get(imageKey))
    );
    expect(rows.variant.imageKeys.map((imageKey) => files.get(imageKey))).toEqual(
      variantKeys.map((imageKey) => files.get(imageKey))
    );
    expect(await prisma.imageCopy.count()).toBe(10);
  });
});
