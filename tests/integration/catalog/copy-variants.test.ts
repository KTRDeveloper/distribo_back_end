import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import * as organizationRepository from '../../../src/modules/organization/organization.repository.js';
import type { CopyProductResult } from '../../../src/modules/catalog/catalog.schemas.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const photoFiles = vi.hoisted(() => new Map<string, Buffer>());

vi.mock('../../../src/modules/images/image.ports.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getImageStorage: () => ({
    get: (key: string) => Promise.resolve(photoFiles.get(key) ?? null),
    put: (key: string, bytes: Buffer) => {
      photoFiles.set(key, Buffer.from(bytes));
      return Promise.resolve();
    },
  }),
  getImageProcessor: () => ({
    reencode: (bytes: Buffer) => Promise.resolve(Buffer.concat([bytes, Buffer.from('-copy')])),
  }),
}));

const id = (n: number) => `0199c031-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const OWNER = id(1);
const MANAGER = id(2);
const SELLER = id(3);
const DRIVER = id(4);
const SUPPLIER_OWNER = id(5);
const BUYER = id(10);
const SUPPLIER = id(11);
const OTHER = id(12);
const RELATIONSHIP = id(20);
const SOURCE = id(30);
const DESTINATION = id(31);
const FOREIGN_PRODUCT = id(32);
const SMALL = id(40);
const LARGE = id(41);
const EXISTING = id(42);
const NEW_PRODUCT = id(50);
const NEW_SMALL = id(51);
const NEW_LARGE = id(52);
const REG = new Date('2026-01-01T00:00:00.000Z');

function validBody(overrides: object = {}) {
  return {
    id: NEW_PRODUCT,
    source_product_id: SOURCE,
    destination: {},
    variants: [
      { id: NEW_SMALL, source_variant_id: SMALL, price: 16000 },
      { id: NEW_LARGE, source_variant_id: LARGE, price: 31000 },
    ],
    ...overrides,
  };
}

function copy(body: object = validBody(), caller = MANAGER) {
  return createAuthenticatedRequest(app, caller)
    .post(`/api/v1/organizations/${BUYER}/products/copy`)
    .send(body);
}

async function buyerCounts() {
  return Promise.all([
    prisma.product.count({ where: { organizationId: BUYER } }),
    prisma.productVariant.count({ where: { organizationId: BUYER } }),
  ]);
}

async function fullPlan() {
  const fields = await organizationRepository.readPlanFields(prisma, BUYER);
  if (!fields) throw new Error('Missing fixture organization');
  vi.spyOn(organizationRepository, 'readPlanFields').mockResolvedValue({
    ...fields,
    maxProducts: 0,
  });
}

beforeEach(async () => {
  photoFiles.clear();
  for (const [index, personId] of [
    [1, OWNER],
    [2, MANAGER],
    [3, SELLER],
    [4, DRIVER],
    [5, SUPPLIER_OWNER],
  ] as const) {
    await prisma.person.create({
      data: {
        id: personId,
        fullName: 'Fixture Person',
        phoneNumber: `+23760003100${index}`,
        phoneVerifiedAt: REG,
        passwordHash: 'test-password-hash',
        registeredAt: REG,
      },
    });
  }
  for (const [organizationId, name] of [
    [BUYER, 'Buyer'],
    [SUPPLIER, 'Supplier'],
    [OTHER, 'Other'],
  ] as const) {
    await prisma.organization.create({ data: { id: organizationId, name } });
  }
  for (const [index, personId, role, organizationId] of [
    [1, OWNER, 'OWNER', BUYER],
    [2, MANAGER, 'MANAGER', BUYER],
    [3, SELLER, 'SELLER', BUYER],
    [4, DRIVER, 'DRIVER', BUYER],
    [5, SUPPLIER_OWNER, 'OWNER', SUPPLIER],
  ] as const) {
    await prisma.collaboration.create({
      data: {
        id: id(100 + index),
        personId,
        organizationId,
        role,
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  }
  await prisma.customerRelationship.create({
    data: {
      id: RELATIONSHIP,
      supplierOrganizationId: SUPPLIER,
      customerOrganizationId: BUYER,
      status: 'ACTIVE',
      createdById: SUPPLIER_OWNER,
    },
  });
  for (const [productId, organizationId, name] of [
    [SOURCE, SUPPLIER, 'Riz'],
    [DESTINATION, BUYER, 'Notre riz'],
    [FOREIGN_PRODUCT, OTHER, 'Autre riz'],
  ] as const) {
    await prisma.product.create({
      data: {
        id: productId,
        organizationId,
        name,
        unit: '',
        description: 'Description fixture',
        category: 'Cereales',
      },
    });
  }
  await prisma.productVariant.createMany({
    data: [
      {
        id: SMALL,
        productId: SOURCE,
        organizationId: SUPPLIER,
        name: 'sac 25 kg',
        unit: 'sac',
        price: 12000n,
        minOrderQuantity: '5',
      },
      {
        id: LARGE,
        productId: SOURCE,
        organizationId: SUPPLIER,
        name: 'sac 50 kg',
        unit: 'sac',
        price: 24000n,
        minOrderQuantity: '10',
      },
      {
        id: EXISTING,
        productId: DESTINATION,
        organizationId: BUYER,
        name: ' SAC   25 KG ',
        unit: ' SAC ',
        price: 17000n,
      },
    ],
  });
});

afterEach(() => vi.restoreAllMocks());

describe('CAT-031 copy purchased variants', () => {
  it('AC-1 creates a new product and the selected variants at the reseller prices', async () => {
    const response = await copy();
    expect(response.status).toBe(201);
    const result = bodyOf<CopyProductResult>(response);
    expect(result).toEqual({
      product: {
        id: NEW_PRODUCT,
        name: 'Riz',
        description: 'Description fixture',
        category: 'Cereales',
        image_urls: [],
        paused: false,
        variants: [
          {
            id: NEW_SMALL,
            name: 'sac 25 kg',
            unit: 'sac',
            label: expect.any(String) as unknown,
            price: 16000,
            price_updated_at: expect.any(String) as unknown,
            min_order_quantity: null,
            image_urls: [],
            status: 'ACTIVE',
          },
          {
            id: NEW_LARGE,
            name: 'sac 50 kg',
            unit: 'sac',
            label: expect.any(String) as unknown,
            price: 31000,
            price_updated_at: expect.any(String) as unknown,
            min_order_quantity: null,
            image_urls: [],
            status: 'ACTIVE',
          },
        ],
      },
      copied: [NEW_SMALL, NEW_LARGE],
      already_in_catalog: [],
    });
    const row = await prisma.product.findUniqueOrThrow({ where: { id: NEW_PRODUCT } });
    expect(row.organizationId).toBe(BUYER);
    expect(row.unit).toBe('');
  });

  it('AC-1 accepts a destination name and the owner role', async () => {
    const response = await copy(validBody({ destination: { name: 'Notre assortiment' } }), OWNER);
    expect(response.status).toBe(201);
    expect(bodyOf<CopyProductResult>(response).product.name).toBe('Notre assortiment');
  });

  it.each(['ACTIVE', 'INACTIVE'] as const)(
    'AC-2 reports an existing simplified twin with status %s without changing its price',
    async (status) => {
      await prisma.productVariant.update({ where: { id: EXISTING }, data: { status } });
      const response = await copy(validBody({ destination: { product_id: DESTINATION } }));
      expect(response.status).toBe(201);
      const result = bodyOf<CopyProductResult>(response);
      expect(result.product.id).toBe(DESTINATION);
      expect(result.product.name).toBe('Notre riz');
      expect(result.product.variants).toHaveLength(2);
      expect(result.copied).toEqual([NEW_LARGE]);
      expect(result.already_in_catalog).toEqual([
        { source_variant_id: SMALL, variant_id: EXISTING, status },
      ]);
      expect(await prisma.productVariant.findUnique({ where: { id: NEW_SMALL } })).toBeNull();
      expect(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: EXISTING } })).price
      ).toBe(17000n);
      expect(await prisma.product.findUnique({ where: { id: NEW_PRODUCT } })).toBeNull();
    }
  );

  it('C-47 a deleted destination twin does not prevent a new copy', async () => {
    await prisma.productVariant.update({ where: { id: EXISTING }, data: { deletedAt: REG } });
    const response = await copy(validBody({ destination: { product_id: DESTINATION } }));
    expect(response.status).toBe(201);
    expect(bodyOf<CopyProductResult>(response).copied).toEqual([NEW_SMALL, NEW_LARGE]);
    expect(bodyOf<CopyProductResult>(response).already_in_catalog).toEqual([]);
  });

  it('C-47 matches an unnamed source variant to an empty destination name', async () => {
    await prisma.productVariant.update({ where: { id: SMALL }, data: { name: null } });
    await prisma.productVariant.update({ where: { id: EXISTING }, data: { name: null } });
    const response = await copy(validBody({ destination: { product_id: DESTINATION } }));
    expect(response.status).toBe(201);
    expect(bodyOf<CopyProductResult>(response).already_in_catalog).toEqual([
      { source_variant_id: SMALL, variant_id: EXISTING, status: 'ACTIVE' },
    ]);
  });

  it.each(['INACTIVE', 'deleted', 'other product'] as const)(
    'AC-3 a source variant %s refuses the entire copy',
    async (state) => {
      const data =
        state === 'INACTIVE'
          ? { status: 'INACTIVE' as const }
          : state === 'deleted'
            ? { deletedAt: REG }
            : { productId: FOREIGN_PRODUCT, organizationId: OTHER };
      await prisma.productVariant.update({ where: { id: LARGE }, data });
      const before = await buyerCounts();
      const response = await copy();
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await buyerCounts()).toEqual(before);
    }
  );

  it.each(['paused', 'deleted'] as const)('a %s source product fails closed', async (state) => {
    await prisma.product.update({
      where: { id: SOURCE },
      data: state === 'paused' ? { pausedAt: REG } : { deletedAt: REG },
    });
    const before = await buyerCounts();
    const response = await copy();
    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await buyerCounts()).toEqual(before);
  });

  it.each(['other organization', 'deleted', 'missing'] as const)(
    'AC-3 a destination in state %s is hidden and writes nothing',
    async (state) => {
      if (state === 'deleted') {
        await prisma.product.update({ where: { id: DESTINATION }, data: { deletedAt: REG } });
      }
      const productId =
        state === 'other organization'
          ? FOREIGN_PRODUCT
          : state === 'missing'
            ? id(999)
            : DESTINATION;
      const before = await buyerCounts();
      const response = await copy(validBody({ destination: { product_id: productId } }));
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await buyerCounts()).toEqual(before);
    }
  );

  it.each([
    ['zero price', { variants: [{ id: NEW_SMALL, source_variant_id: SMALL, price: 0 }] }],
    [
      'duplicate source id',
      {
        variants: [
          { id: NEW_SMALL, source_variant_id: SMALL, price: 16000 },
          { id: NEW_LARGE, source_variant_id: SMALL, price: 31000 },
        ],
      },
    ],
    [
      'duplicate destination variant id',
      {
        variants: [
          { id: NEW_SMALL, source_variant_id: SMALL, price: 16000 },
          { id: NEW_SMALL, source_variant_id: LARGE, price: 31000 },
        ],
      },
    ],
    ['no variants', { variants: [] }],
    [
      '51 variants',
      {
        variants: Array.from({ length: 51 }, (_, index) => ({
          id: id(200 + index),
          source_variant_id: id(300 + index),
          price: 1,
        })),
      },
    ],
    ['status', { status: 'ACTIVE' }],
    ['photo', { image_urls: [] }],
    ['mixed destination', { destination: { product_id: DESTINATION, name: 'Other' } }],
    ['destination status', { destination: { status: 'ACTIVE' } }],
    [
      'variant minimum',
      {
        variants: [
          { id: NEW_SMALL, source_variant_id: SMALL, price: 16000, min_order_quantity: 1 },
        ],
      },
    ],
    ['old body', { destination: undefined, variants: undefined, price: 16000 }],
  ])('AC-3 strict validation refuses %s without storing anything', async (_name, overrides) => {
    const before = await buyerCounts();
    const response = await copy(validBody(overrides));
    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await buyerCounts()).toEqual(before);
  });

  it.each([SELLER, DRIVER])('AC-3 role %s cannot copy', async (caller) => {
    const before = await buyerCounts();
    const response = await copy(validBody(), caller);
    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await buyerCounts()).toEqual(before);
  });

  it('AC-3 a full plan refuses a new product atomically', async () => {
    await fullPlan();
    const before = await buyerCounts();
    const response = await copy();
    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('PRODUCT_LIMIT_REACHED');
    expect(await buyerCounts()).toEqual(before);
  });

  it('C-46 a full plan refuses to activate a destination with no active variant', async () => {
    await prisma.productVariant.update({ where: { id: EXISTING }, data: { status: 'INACTIVE' } });
    await fullPlan();
    const before = await buyerCounts();
    const response = await copy(validBody({ destination: { product_id: DESTINATION } }));
    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('PRODUCT_LIMIT_REACHED');
    expect(await buyerCounts()).toEqual(before);
  });

  it('C-46 a full plan still allows adding to an already on-sale destination', async () => {
    await fullPlan();
    const response = await copy(validBody({ destination: { product_id: DESTINATION } }));
    expect(response.status).toBe(201);
    expect(bodyOf<CopyProductResult>(response).copied).toEqual([NEW_LARGE]);
  });

  it('AC-4 an idempotent repeat returns the first response and creates only one copy', async () => {
    const first = await copy();
    const second = await copy();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.product.count({ where: { id: NEW_PRODUCT } })).toBe(1);
    expect(await prisma.productVariant.count({ where: { productId: NEW_PRODUCT } })).toBe(2);
  });

  it('AB-1 a competitor without a relationship is hidden', async () => {
    const before = await buyerCounts();
    const response = await copy(validBody({ source_product_id: FOREIGN_PRODUCT }));
    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await buyerCounts()).toEqual(before);
  });

  it('AB-1 a deleted supplier relationship does not authorize copying', async () => {
    await prisma.customerRelationship.update({
      where: { id: RELATIONSHIP },
      data: { deletedAt: REG },
    });
    const before = await buyerCounts();
    const response = await copy();
    expect(response.status).toBe(404);
    expect(await buyerCounts()).toEqual(before);
  });

  it('AB-2 keeps reseller prices and minimums independent and copies photos under new keys', async () => {
    const productPhoto = 'products/0199c031-0000-4000-8000-000000000001.webp';
    const variantPhoto = 'products/0199c031-0000-4000-8000-000000000002.webp';
    photoFiles.set(productPhoto, Buffer.from('supplier-product'));
    photoFiles.set(variantPhoto, Buffer.from('supplier-variant'));
    await prisma.product.update({
      where: { id: SOURCE },
      data: { imageKeys: [productPhoto] },
    });
    await prisma.productVariant.update({
      where: { id: SMALL },
      data: { imageKeys: [variantPhoto] },
    });
    const response = await copy();
    expect(response.status).toBe(201);
    const result = bodyOf<CopyProductResult>(response);
    expect(result.product.image_urls).toHaveLength(1);
    expect(result.product.variants.map((variant) => variant.price)).toEqual([16000, 31000]);
    expect(result.product.variants.map((variant) => variant.min_order_quantity)).toEqual([
      null,
      null,
    ]);
    expect(result.product.variants.map((variant) => variant.image_urls.length)).toEqual([1, 0]);
    const rows = await prisma.productVariant.findMany({
      where: { productId: NEW_PRODUCT },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((row) => row.price)).toEqual([16000n, 31000n]);
    expect(rows.every((row) => row.minOrderQuantity === null)).toBe(true);
    expect(rows.map((row) => row.imageKeys.length)).toEqual([1, 0]);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: NEW_PRODUCT } });
    expect(product.price).not.toBe(12000n);
    expect(product.minOrderQuantity).toBeNull();
    expect(product.imageKeys).toHaveLength(1);
    const copiedKeys = [...product.imageKeys, ...rows.flatMap((row) => row.imageKeys)];
    expect(new Set([...copiedKeys, productPhoto, variantPhoto]).size).toBe(4);
    expect(copiedKeys.every((key) => photoFiles.has(key))).toBe(true);
    expect(result.product.image_urls[0]).toContain(product.imageKeys[0]);
    expect(result.product.variants[0].image_urls[0]).toContain(rows[0].imageKeys[0]);
    const serialized = JSON.stringify(
      [result, product, rows],
      (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value)
    );
    expect(serialized).not.toContain(productPhoto);
    expect(serialized).not.toContain(variantPhoto);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: SOURCE } })).imageKeys).toEqual([
      productPhoto,
    ]);
    expect(
      (await prisma.productVariant.findUniqueOrThrow({ where: { id: SMALL } })).imageKeys
    ).toEqual([variantPhoto]);
  });

  it('C-47 concurrent copies into the same destination report the winning live variant', async () => {
    const firstBody = validBody({
      destination: { product_id: DESTINATION },
      variants: [{ id: NEW_LARGE, source_variant_id: LARGE, price: 31000 }],
    });
    const secondBody = validBody({
      id: id(60),
      destination: { product_id: DESTINATION },
      variants: [{ id: id(61), source_variant_id: LARGE, price: 32000 }],
    });
    const responses = await Promise.all([copy(firstBody), copy(secondBody)]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const results = responses.map((response) => bodyOf<CopyProductResult>(response));
    const copiedIds = results.flatMap((result) => result.copied);
    expect(copiedIds).toHaveLength(1);
    expect(results.flatMap((result) => result.already_in_catalog)).toEqual([
      { source_variant_id: LARGE, variant_id: copiedIds[0], status: 'ACTIVE' },
    ]);
    expect(
      await prisma.productVariant.count({ where: { productId: DESTINATION, deletedAt: null } })
    ).toBe(2);
  });

  it('an invalid later source variant leaves an existing destination unchanged', async () => {
    await prisma.productVariant.update({ where: { id: LARGE }, data: { status: 'INACTIVE' } });
    await prisma.productVariant.update({ where: { id: EXISTING }, data: { deletedAt: REG } });
    const before = await buyerCounts();
    const response = await copy(validBody({ destination: { product_id: DESTINATION } }));
    expect(response.status).toBe(404);
    expect(await buyerCounts()).toEqual(before);
    expect(await prisma.productVariant.findUnique({ where: { id: NEW_SMALL } })).toBeNull();
  });
});
