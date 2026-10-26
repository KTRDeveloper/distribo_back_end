import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProductFromSync,
  deleteVariantFromSync,
} from '../../../src/modules/catalog/catalog.sync-writers.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c036-0000-7000-8000-000000000001';
const CUSTOMER = '0199c036-0000-7000-8000-000000000011';
const ORG_A = '0199c036-0000-7000-8000-0000000000a1';
const ORG_B = '0199c036-0000-7000-8000-0000000000b1';
const PRODUCT_A = '0199c036-0000-7000-8000-0000000000c1';
const PRODUCT_B = '0199c036-0000-7000-8000-0000000000c2';
const V1 = '0199c036-0000-7000-8000-0000000000d1';
const V2 = '0199c036-0000-7000-8000-0000000000d2';
const V3 = '0199c036-0000-7000-8000-0000000000d3';
const V_B = '0199c036-0000-7000-8000-0000000000d4';
const UNKNOWN = '0199c036-0000-7000-8000-0000000000d9';
const REL = '0199c036-0000-7000-8000-000000000021';
const REG = new Date('2026-01-01T00:00:00.000Z');
const NOW = new Date('2026-10-19T10:00:00.000Z');

async function seedProduct(id: string, organizationId: string, variantIds: string[]) {
  await prisma.product.create({
    data: { id, organizationId, name: 'T-shirt' },
  });
  for (const [index, variantId] of variantIds.entries()) {
    await prisma.productVariant.create({
      data: {
        id: variantId,
        productId: id,
        organizationId,
        name: `Taille ${index + 1}`,
        unit: 'pièce',
        price: 15000n,
      },
    });
  }
}

async function seedOrderLineOn(variantId: string) {
  await prisma.order.create({
    data: {
      id: '0199c036-0000-7000-8000-000000000031',
      customerRelationshipId: REL,
      enteredById: OWNER,
      placedByParty: 'SUPPLIER',
      status: 'CONFIRMED',
      deliveryCost: 0n,
      totalAmount: 15000n,
      lines: {
        create: {
          id: '0199c036-0000-7000-8000-000000000032',
          productVariantId: variantId,
          labelApplied: 'T-shirt',
          quantity: '1',
          referencePrice: 15000n,
          unitPriceApplied: 15000n,
          amount: 15000n,
        },
      },
    },
  });
}

async function seedPriceOn(variantId: string) {
  await prisma.customerPrice.create({
    data: {
      id: '0199c036-0000-7000-8000-000000000041',
      customerRelationshipId: REL,
      productId: PRODUCT_A,
      productVariantId: variantId,
      price: 14000n,
      setById: OWNER,
    },
  });
}

const deleteVariant = (variantId: string, organizationId = ORG_A) =>
  prisma.$transaction((tx) => deleteVariantFromSync(tx, organizationId, variantId, NOW));

const deleteProduct = (productId: string, organizationId = ORG_A) =>
  prisma.$transaction((tx) => deleteProductFromSync(tx, organizationId, productId, NOW));

const readVariant = (id: string) => prisma.productVariant.findUniqueOrThrow({ where: { id } });
const readProduct = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  for (const [id, phone] of [
    [OWNER, '+237600009601'],
    [CUSTOMER, '+237600009611'],
  ] as const) {
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
  for (const id of [ORG_A, ORG_B]) {
    await prisma.organization.create({
      data: { id, name: 'Org ' + id.slice(-2), status: 'ACTIVE' },
    });
  }
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: ORG_A,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
    },
  });
});

describe('deleteVariantFromSync (CAT-036)', () => {
  it('AC-1 deletes a never sold variant with the given date', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);

    expect(await deleteVariant(V1)).toEqual({ result: 'DELETED', retiredLabels: [] });

    expect((await readVariant(V1)).deletedAt).toEqual(NOW);
    expect((await readVariant(V2)).deletedAt).toBeNull();
    expect((await readProduct(PRODUCT_A)).deletedAt).toBeNull();
  });

  it.each([
    ['an order line in any state', seedOrderLineOn],
    ['a live negotiated price', seedPriceOn],
  ])('AC-2 a variant cited by %s is retired, not deleted', async (_use, seed) => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await seed(V1);

    expect(await deleteVariant(V1)).toEqual({
      result: 'RETIRED',
      retiredLabels: ['T-shirt — Taille 1 (pièce)'],
    });

    const row = await readVariant(V1);
    expect(row.status).toBe('INACTIVE');
    expect(row.deletedAt).toBeNull();
    expect(row.price).toBe(15000n);
  });

  it('AC-2 an order line cancelled and deleted still retires the variant', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await seedOrderLineOn(V1);
    await prisma.$transaction([
      prisma.orderLine.updateMany({ data: { deletedAt: new Date() } }),
      prisma.order.updateMany({ data: { totalAmount: 0n, deletedAt: new Date() } }),
    ]);

    expect((await deleteVariant(V1)).result).toBe('RETIRED');
    expect((await readVariant(V1)).deletedAt).toBeNull();
  });

  it('a sold variant that is the last one is retired, not kept (C-48 before C-45)', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1]);
    await seedOrderLineOn(V1);

    expect((await deleteVariant(V1)).result).toBe('RETIRED');
    expect((await readVariant(V1)).status).toBe('INACTIVE');
  });

  it('AC-3 the last live variant is kept', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1]);

    expect(await deleteVariant(V1)).toEqual({ result: 'LAST_VARIANT', retiredLabels: [] });

    const row = await readVariant(V1);
    expect(row.deletedAt).toBeNull();
    expect(row.status).toBe('ACTIVE');
  });

  it('AC-3 a deleted sibling does not count as a live variant', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await prisma.productVariant.update({ where: { id: V2 }, data: { deletedAt: new Date() } });

    expect((await deleteVariant(V1)).result).toBe('LAST_VARIANT');
  });

  it('AC-5 an already deleted variant answers ALREADY and keeps its date', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    const earlier = new Date('2026-05-01T00:00:00.000Z');
    await prisma.productVariant.update({ where: { id: V1 }, data: { deletedAt: earlier } });

    expect(await deleteVariant(V1)).toEqual({ result: 'ALREADY', retiredLabels: [] });
    expect((await readVariant(V1)).deletedAt).toEqual(earlier);
  });

  it('AC-5 an unknown id answers NOT_FOUND', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);

    expect(await deleteVariant(UNKNOWN)).toEqual({ result: 'NOT_FOUND', retiredLabels: [] });
  });

  it('AB-2 a variant of another business answers NOT_FOUND and stays unchanged', async () => {
    await seedProduct(PRODUCT_B, ORG_B, [V_B]);
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);

    expect(await deleteVariant(V_B)).toEqual({ result: 'NOT_FOUND', retiredLabels: [] });

    const row = await readVariant(V_B);
    expect(row.deletedAt).toBeNull();
    expect(row.status).toBe('ACTIVE');
  });

  it('moves the product date with a variant change (CAT-021)', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    const before = (await readProduct(PRODUCT_A)).serverUpdatedAt;
    await new Promise((resolve) => setTimeout(resolve, 20));

    await deleteVariant(V1);

    expect((await readProduct(PRODUCT_A)).serverUpdatedAt.getTime()).toBeGreaterThan(
      before.getTime()
    );
  });
});

describe('deleteProductFromSync (CAT-036)', () => {
  it('AC-4 a product with one sold variant keeps it off sale and deletes the others', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2, V3]);
    await seedOrderLineOn(V2);

    expect(await deleteProduct(PRODUCT_A)).toEqual({
      result: 'RETIRED',
      retiredLabels: ['T-shirt — Taille 2 (pièce)'],
    });

    const sold = await readVariant(V2);
    expect(sold.status).toBe('INACTIVE');
    expect(sold.deletedAt).toBeNull();
    expect((await readVariant(V1)).deletedAt).toEqual(NOW);
    expect((await readVariant(V3)).deletedAt).toEqual(NOW);
    expect((await readProduct(PRODUCT_A)).deletedAt).toBeNull();
  });

  it('AC-4 a product with a live negotiated price is retired the same way', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2, V3]);
    await seedPriceOn(V3);

    const answer = await deleteProduct(PRODUCT_A);

    expect(answer.result).toBe('RETIRED');
    expect(answer.retiredLabels).toEqual(['T-shirt — Taille 3 (pièce)']);
    expect((await readVariant(V3)).status).toBe('INACTIVE');
  });

  it('AC-4 a product never sold is deleted with its variants', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2, V3]);

    expect(await deleteProduct(PRODUCT_A)).toEqual({ result: 'DELETED', retiredLabels: [] });

    expect((await readProduct(PRODUCT_A)).deletedAt).toEqual(NOW);
    for (const id of [V1, V2, V3]) expect((await readVariant(id)).deletedAt).toEqual(NOW);
  });

  it('AC-5 an already deleted product answers ALREADY and writes nothing', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    const earlier = new Date('2026-05-01T00:00:00.000Z');
    await prisma.product.update({ where: { id: PRODUCT_A }, data: { deletedAt: earlier } });

    expect(await deleteProduct(PRODUCT_A)).toEqual({ result: 'ALREADY', retiredLabels: [] });
    expect((await readProduct(PRODUCT_A)).deletedAt).toEqual(earlier);
    expect((await readVariant(V1)).deletedAt).toBeNull();
  });

  it('AC-5 an unknown id answers NOT_FOUND', async () => {
    expect(await deleteProduct(UNKNOWN)).toEqual({ result: 'NOT_FOUND', retiredLabels: [] });
  });

  it('AB-2 a product of another business answers NOT_FOUND and stays unchanged', async () => {
    await seedProduct(PRODUCT_B, ORG_B, [V_B]);

    expect(await deleteProduct(PRODUCT_B)).toEqual({ result: 'NOT_FOUND', retiredLabels: [] });

    expect((await readProduct(PRODUCT_B)).deletedAt).toBeNull();
    expect((await readVariant(V_B)).deletedAt).toBeNull();
  });

  it('AB-1 after the deletion of a sold product every order line still finds its variant and product', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await seedOrderLineOn(V1);

    await deleteProduct(PRODUCT_A);

    const line = await prisma.orderLine.findFirstOrThrow({
      include: { productVariant: { include: { product: true } } },
    });
    expect(line.deletedAt).toBeNull();
    expect(line.productVariant.deletedAt).toBeNull();
    expect(line.productVariant.product.deletedAt).toBeNull();
  });
});
