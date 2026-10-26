import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0e6-0000-7000-8000-000000000001';
const MANAGER = '0199c0e6-0000-7000-8000-000000000002';
const SELLER = '0199c0e6-0000-7000-8000-000000000003';
const OTHER_OWNER = '0199c0e6-0000-7000-8000-000000000005';
const CUSTOMER = '0199c0e6-0000-7000-8000-000000000011';

const ORG_A = '0199c0e6-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0e6-0000-7000-8000-0000000000b1';

const PRODUCT_A = '0199c0e6-0000-7000-8000-0000000000c1';
const PRODUCT_B = '0199c0e6-0000-7000-8000-0000000000c2';
const V1 = '0199c0e6-0000-7000-8000-0000000000d1';
const V2 = '0199c0e6-0000-7000-8000-0000000000d2';
const V_B = '0199c0e6-0000-7000-8000-0000000000d3';
const UNKNOWN = '0199c0e6-0000-7000-8000-0000000000d9';

const REL = '0199c0e6-0000-7000-8000-000000000021';
const REG = new Date('2026-01-01T00:00:00.000Z');

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
  role: 'OWNER' | 'MANAGER' | 'SELLER',
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
      id: '0199c0e6-0000-7000-8000-000000000031',
      customerRelationshipId: REL,
      enteredById: SELLER,
      placedByParty: 'SUPPLIER',
      status: 'CONFIRMED',
      deliveryCost: 0n,
      totalAmount: 15000n,
      lines: {
        create: {
          id: '0199c0e6-0000-7000-8000-000000000032',
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

async function seedPriceOn(variantId: string, deleted = false) {
  await prisma.customerPrice.create({
    data: {
      id: '0199c0e6-0000-7000-8000-000000000041',
      customerRelationshipId: REL,
      productVariantId: variantId,
      price: 14000n,
      setById: OWNER,
      deletedAt: deleted ? new Date() : null,
    },
  });
}

const deleteVariant = (productId: string, variantId: string, who = MANAGER, orgId = ORG_A) =>
  createAuthenticatedRequest(app, who).delete(
    `/api/v1/organizations/${orgId}/products/${productId}/variants/${variantId}`
  );

const deleteProduct = (productId: string, who = MANAGER, orgId = ORG_A) =>
  createAuthenticatedRequest(app, who).delete(
    `/api/v1/organizations/${orgId}/products/${productId}`
  );

const readVariant = (id: string) => prisma.productVariant.findUniqueOrThrow({ where: { id } });
const readProduct = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009401');
  await seedPerson(MANAGER, '+237600009402');
  await seedPerson(SELLER, '+237600009403');
  await seedPerson(OTHER_OWNER, '+237600009405');
  await seedPerson(CUSTOMER, '+237600009411');
  for (const [id, owner] of [
    [ORG_A, OWNER],
    [ORG_B, OTHER_OWNER],
  ] as const) {
    await prisma.organization.create({
      data: { id, name: 'Org ' + id.slice(-2), status: 'ACTIVE' },
    });
    await seedMember(id, owner, 'OWNER', 9);
  }
  await seedMember(ORG_A, MANAGER, 'MANAGER', 1);
  await seedMember(ORG_A, SELLER, 'SELLER', 2);
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: ORG_A,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
    },
  });
});

describe('DELETE /api/v1/organizations/:organizationId/products/:productId/variants/:variantId', () => {
  it('AC-1 deletes a never-used variant: 204, deleted_at set, the other one stays', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);

    const response = await deleteVariant(PRODUCT_A, V1);

    expect(response.status).toBe(204);
    expect((await readVariant(V1)).deletedAt).not.toBeNull();
    expect((await readVariant(V2)).deletedAt).toBeNull();
    expect((await readProduct(PRODUCT_A)).deletedAt).toBeNull();
  });

  it('the owner may delete a variant', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);

    const response = await deleteVariant(PRODUCT_A, V1, OWNER);

    expect(response.status).toBe(204);
  });

  it('AC-3 an order line blocks the variant: 409 VARIANT_IN_USE, nothing deleted', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await seedOrderLineOn(V1);

    const response = await deleteVariant(PRODUCT_A, V1);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VARIANT_IN_USE');
    expect((await readVariant(V1)).deletedAt).toBeNull();
  });

  it('AC-3 a live negotiated price blocks the variant: 409 VARIANT_IN_USE', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await seedPriceOn(V1);

    const response = await deleteVariant(PRODUCT_A, V1);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VARIANT_IN_USE');
    expect((await readVariant(V1)).deletedAt).toBeNull();
  });

  it('AC-4 a deleted negotiated price does not block: 204', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await seedPriceOn(V1, true);

    const response = await deleteVariant(PRODUCT_A, V1);

    expect(response.status).toBe(204);
    expect((await readVariant(V1)).deletedAt).not.toBeNull();
  });

  it('an order line cancelled or deleted still blocks (C-48)', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await seedOrderLineOn(V1);
    await prisma.$transaction([
      prisma.orderLine.updateMany({ data: { deletedAt: new Date() } }),
      prisma.order.updateMany({ data: { totalAmount: 0n, deletedAt: new Date() } }),
    ]);

    const response = await deleteVariant(PRODUCT_A, V1);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VARIANT_IN_USE');
  });

  it('AC-5 the last live variant: 409 LAST_VARIANT, nothing deleted', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1]);

    const response = await deleteVariant(PRODUCT_A, V1);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('LAST_VARIANT');
    expect((await readVariant(V1)).deletedAt).toBeNull();
  });

  it('the last live variant counts only live ones: a deleted sibling does not help', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await prisma.productVariant.update({ where: { id: V2 }, data: { deletedAt: new Date() } });

    const response = await deleteVariant(PRODUCT_A, V1);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('LAST_VARIANT');
  });

  it('AC-6 an already deleted variant: 204, deleted_at unchanged', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    expect((await deleteVariant(PRODUCT_A, V1)).status).toBe(204);
    const first = (await readVariant(V1)).deletedAt;

    const response = await deleteVariant(PRODUCT_A, V1);

    expect(response.status).toBe(204);
    expect((await readVariant(V1)).deletedAt).toEqual(first);
  });

  it('AC-6 another business: 404 NOT_FOUND, nothing deleted', async () => {
    await seedProduct(PRODUCT_B, ORG_B, [V_B]);

    const throughOwnPath = await deleteVariant(PRODUCT_B, V_B, MANAGER, ORG_A);
    expect(throughOwnPath.status).toBe(404);
    expect(bodyOf<ErrorBody>(throughOwnPath).error.code).toBe('NOT_FOUND');

    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    const mixedPath = await deleteVariant(PRODUCT_A, V_B);
    expect(mixedPath.status).toBe(404);

    expect((await readVariant(V_B)).deletedAt).toBeNull();
  });

  it('an unknown variant: 404; a variant of another product: 404', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await prisma.product.create({
      data: { id: PRODUCT_B, organizationId: ORG_A, name: 'Casquette' },
    });
    await prisma.productVariant.create({
      data: {
        id: V_B,
        productId: PRODUCT_B,
        organizationId: ORG_A,
        name: 'Unique',
        unit: 'pièce',
        price: 100n,
      },
    });

    expect((await deleteVariant(PRODUCT_A, UNKNOWN)).status).toBe(404);
    expect((await deleteVariant(PRODUCT_A, V_B)).status).toBe(404);
    expect((await readVariant(V_B)).deletedAt).toBeNull();
  });

  it('a path id that is not a UUID: 400 VALIDATION_ERROR', async () => {
    const response = await deleteVariant(PRODUCT_A, 'not-a-uuid');

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('AB-2 a seller: 403 FORBIDDEN, nothing deleted', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);

    const response = await deleteVariant(PRODUCT_A, V1, SELLER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect((await readVariant(V1)).deletedAt).toBeNull();
  });

  it('two concurrent deletions of the two variants never leave a product without a variant', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);

    const [first, second] = await Promise.all([
      deleteVariant(PRODUCT_A, V1),
      deleteVariant(PRODUCT_A, V2),
    ]);

    expect([first.status, second.status].sort()).toEqual([204, 409]);
    const live = await prisma.productVariant.count({
      where: { productId: PRODUCT_A, deletedAt: null },
    });
    expect(live).toBe(1);
  });
});

describe('DELETE /api/v1/organizations/:organizationId/products/:productId', () => {
  it('AC-2 deletes the product and all its variants: 204', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);

    const response = await deleteProduct(PRODUCT_A);

    expect(response.status).toBe(204);
    expect((await readProduct(PRODUCT_A)).deletedAt).not.toBeNull();
    expect((await readVariant(V1)).deletedAt).not.toBeNull();
    expect((await readVariant(V2)).deletedAt).not.toBeNull();
  });

  it('a product with a single variant can be deleted', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1]);

    const response = await deleteProduct(PRODUCT_A);

    expect(response.status).toBe(204);
    expect((await readVariant(V1)).deletedAt).not.toBeNull();
  });

  it.each([
    ['an order line', seedOrderLineOn],
    ['a live negotiated price', seedPriceOn],
  ])('AC-3 / AB-1 %s on one variant: 409 VARIANT_IN_USE, nothing deleted', async (_label, seed) => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await seed(V2);

    const response = await deleteProduct(PRODUCT_A);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VARIANT_IN_USE');
    expect((await readProduct(PRODUCT_A)).deletedAt).toBeNull();
    expect((await readVariant(V1)).deletedAt).toBeNull();
    expect((await readVariant(V2)).deletedAt).toBeNull();
    if (_label === 'an order line') {
      const line = await prisma.orderLine.findFirstOrThrow();
      expect(line.productVariantId).toBe(V2);
      expect(line.deletedAt).toBeNull();
    }
  });

  it('AC-4 a deleted negotiated price does not block the product: 204', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await seedPriceOn(V1, true);

    const response = await deleteProduct(PRODUCT_A);

    expect(response.status).toBe(204);
  });

  it('AC-6 an already deleted product: 204', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    expect((await deleteProduct(PRODUCT_A)).status).toBe(204);
    const first = (await readProduct(PRODUCT_A)).deletedAt;

    const response = await deleteProduct(PRODUCT_A);

    expect(response.status).toBe(204);
    expect((await readProduct(PRODUCT_A)).deletedAt).toEqual(first);
  });

  it('a variant of a deleted product: 204', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);
    await deleteProduct(PRODUCT_A);

    expect((await deleteVariant(PRODUCT_A, V1)).status).toBe(204);
  });

  it('AC-6 another business and an unknown id: 404 NOT_FOUND, nothing deleted', async () => {
    await seedProduct(PRODUCT_B, ORG_B, [V_B]);

    const other = await deleteProduct(PRODUCT_B);
    expect(other.status).toBe(404);
    expect(bodyOf<ErrorBody>(other).error.code).toBe('NOT_FOUND');
    expect((await readProduct(PRODUCT_B)).deletedAt).toBeNull();
    expect((await readVariant(V_B)).deletedAt).toBeNull();

    expect((await deleteProduct(UNKNOWN)).status).toBe(404);
  });

  it('AB-2 a seller: 403 FORBIDDEN, nothing deleted', async () => {
    await seedProduct(PRODUCT_A, ORG_A, [V1, V2]);

    const response = await deleteProduct(PRODUCT_A, SELLER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect((await readProduct(PRODUCT_A)).deletedAt).toBeNull();
  });
});
