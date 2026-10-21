import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { seedCustomerPrice, seedProduct } from '../../helpers/catalog-fixtures.js';
import {
  getActiveProduct,
  getReferencePrice,
} from '../../../src/modules/catalog/catalog.repository';

const SUPPLIER_ORG_ID = '0199c003-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199c003-0000-7000-8000-000000000002';
const OWNER_ID = '0199c003-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c003-0000-7000-8000-000000000012';
const OTHER_CUSTOMER_ID = '0199c003-0000-7000-8000-000000000013';
const REL_ID = '0199c003-0000-7000-8000-000000000021';
const OTHER_REL_ID = '0199c003-0000-7000-8000-000000000022';
const PRODUCT_ID = '0199c003-0000-7000-8000-000000000031';
const INACTIVE_PRODUCT_ID = '0199c003-0000-7000-8000-000000000032';
const DELETED_PRODUCT_ID = '0199c003-0000-7000-8000-000000000033';
const FOREIGN_PRODUCT_ID = '0199c003-0000-7000-8000-000000000034';
const PRICE_ID = '0199c003-0000-7000-8000-000000000041';
const OTHER_PRICE_ID = '0199c003-0000-7000-8000-000000000042';
const UNKNOWN_ID = '0199c003-0000-7000-8000-0000000009ff';

/** Inserts a negotiated price for a relationship on the main product. */
async function insertPrice(
  id: string,
  relationshipId: string,
  price: number,
  deleted = false
): Promise<void> {
  await seedCustomerPrice(prisma, {
    id,
    customerRelationshipId: relationshipId,
    productVariantId: PRODUCT_ID,
    price: BigInt(price),
    setById: OWNER_ID,
    deletedAt: deleted ? new Date('2026-02-01T00:00:00.000Z') : null,
  });
}

const reference = (relationshipId: string, productId = PRODUCT_ID) =>
  prisma.$transaction((tx) => getReferencePrice(tx, relationshipId, productId));

const active = (organizationId: string, productId: string) =>
  prisma.$transaction((tx) => getActiveProduct(tx, organizationId, productId));

/** Seeds variant-backed fixtures for reference-price checks. */
async function seedReferenceProducts(): Promise<void> {
  await seedProduct(prisma, {
    id: PRODUCT_ID,
    organizationId: SUPPLIER_ORG_ID,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: INACTIVE_PRODUCT_ID,
    organizationId: SUPPLIER_ORG_ID,
    name: 'Fixture Sugar',
    unit: 'sack',
    price: 900n,
    status: 'INACTIVE',
  });
  await seedProduct(prisma, {
    id: DELETED_PRODUCT_ID,
    organizationId: SUPPLIER_ORG_ID,
    name: 'Fixture Salt',
    unit: 'bag',
    price: 400n,
    deletedAt: new Date(),
  });
  await seedProduct(prisma, {
    id: FOREIGN_PRODUCT_ID,
    organizationId: OTHER_ORG_ID,
    name: 'Fixture Oil',
    unit: 'can',
    price: 1500n,
  });
}

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700003011', ...registered },
      { id: CUSTOMER_ID, fullName: 'Fixture One', phoneNumber: '+2250700003012', ...registered },
      {
        id: OTHER_CUSTOMER_ID,
        fullName: 'Fixture Two',
        phoneNumber: '+2250700003013',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier'), (${OTHER_ORG_ID}::uuid, 'Fixture Other Business')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES
      (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid),
      (${OTHER_REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${OTHER_CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
});

describe('getReferencePrice (AC-1, CM-11)', () => {
  beforeEach(seedReferenceProducts);

  it('returns the product price when no negotiated price exists', async () => {
    const result = await reference(REL_ID);
    expect(result.price).toBe(3000n);
    expect(result.negotiated).toBe(false);
    const [variant] = await prisma.$queryRaw<Array<{ price_updated_at: Date }>>`
      SELECT price_updated_at FROM product_variants WHERE id = ${PRODUCT_ID}::uuid
    `;
    expect(result.changedAt.getTime()).toBe(variant.price_updated_at.getTime());
  });

  it('returns the negotiated price and its set_at when lower', async () => {
    await insertPrice(PRICE_ID, REL_ID, 2800);
    const result = await reference(REL_ID);
    expect(result.price).toBe(2800n);
    expect(result.negotiated).toBe(true);
    const [row] = await prisma.$queryRaw<Array<{ set_at: Date }>>`
      SELECT set_at FROM customer_prices WHERE id = ${PRICE_ID}::uuid
    `;
    expect(result.changedAt.getTime()).toBe(row.set_at.getTime());
  });

  it('returns the negotiated price even when higher than the product price', async () => {
    await insertPrice(PRICE_ID, REL_ID, 3500);
    const result = await reference(REL_ID);
    expect(result.price).toBe(3500n);
    expect(result.negotiated).toBe(true);
  });

  it('ignores a deleted negotiated price', async () => {
    await insertPrice(PRICE_ID, REL_ID, 2800, true);
    const result = await reference(REL_ID);
    expect(result.price).toBe(3000n);
    expect(result.negotiated).toBe(false);
  });

  it('uses the live price when a deleted one also exists', async () => {
    await insertPrice(PRICE_ID, REL_ID, 2800, true);
    await insertPrice(OTHER_PRICE_ID, REL_ID, 2700);
    const result = await reference(REL_ID);
    expect(result.price).toBe(2700n);
    expect(result.negotiated).toBe(true);
  });

  it('throws 404 NOT_FOUND for an unknown product', async () => {
    await expect(reference(REL_ID, UNKNOWN_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});

describe('getReferencePrice other customers (AC-2, AB-1, CWE-200)', () => {
  beforeEach(seedReferenceProducts);

  it('is unchanged by another relationship negotiated price', async () => {
    await insertPrice(OTHER_PRICE_ID, OTHER_REL_ID, 1000);
    const result = await reference(REL_ID);
    expect(result.price).toBe(3000n);
    expect(result.negotiated).toBe(false);
  });

  it('never returns the price of relationship B for relationship A', async () => {
    await insertPrice(PRICE_ID, REL_ID, 2800);
    await insertPrice(OTHER_PRICE_ID, OTHER_REL_ID, 1000);
    expect((await reference(REL_ID)).price).toBe(2800n);
    expect((await reference(OTHER_REL_ID)).price).toBe(1000n);
  });
});

describe('getActiveProduct (AC-3, C-15)', () => {
  beforeEach(async () => {
    // Keep legacy fixtures only for this obsolete reader until CAT-041 removes it.
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name, unit, price, status, deleted_at)
      VALUES
        (${PRODUCT_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'Fixture Rice', 'sack', 3000, 'ACTIVE', NULL),
        (${INACTIVE_PRODUCT_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'Fixture Sugar', 'sack', 900, 'INACTIVE', NULL),
        (${DELETED_PRODUCT_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'Fixture Salt', 'bag', 400, 'ACTIVE', now()),
        (${FOREIGN_PRODUCT_ID}::uuid, ${OTHER_ORG_ID}::uuid, 'Fixture Oil', 'can', 1500, 'ACTIVE', NULL)
    `;
  });

  it('returns an ACTIVE product of the organization', async () => {
    const product = await active(SUPPLIER_ORG_ID, PRODUCT_ID);
    expect(product.id).toBe(PRODUCT_ID);
    expect(product.price).toBe(3000n);
  });

  it.each([
    ['an INACTIVE product', SUPPLIER_ORG_ID, INACTIVE_PRODUCT_ID],
    ['a deleted product', SUPPLIER_ORG_ID, DELETED_PRODUCT_ID],
    ['a product of another organization', SUPPLIER_ORG_ID, FOREIGN_PRODUCT_ID],
    ['an unknown product', SUPPLIER_ORG_ID, UNKNOWN_ID],
  ])('throws 404 NOT_FOUND for %s', async (_case, organizationId, productId) => {
    await expect(active(organizationId, productId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});
