import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { seedProduct } from '../../helpers/catalog-fixtures';
import { getReferencePrice } from '../../../src/modules/catalog/catalog.repository';

const SUPPLIER_ORG_ID = '0199c017-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199c017-0000-7000-8000-000000000002';
const OWNER_ID = '0199c017-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c017-0000-7000-8000-000000000012';
const OTHER_CUSTOMER_ID = '0199c017-0000-7000-8000-000000000013';
const REL_ID = '0199c017-0000-7000-8000-000000000021';
const OTHER_REL_ID = '0199c017-0000-7000-8000-000000000022';
const PRODUCT_ID = '0199c017-0000-7000-8000-000000000031';
const FOREIGN_PRODUCT_ID = '0199c017-0000-7000-8000-000000000034';
// CAT-013: the legacy variant of a product has the id of the product.
const VARIANT_ID = PRODUCT_ID;
const SECOND_VARIANT_ID = '0199c017-0000-7000-8000-000000000041';
const FOREIGN_VARIANT_ID = FOREIGN_PRODUCT_ID;
const PRICE_ID = '0199c017-0000-7000-8000-000000000051';
const OTHER_PRICE_ID = '0199c017-0000-7000-8000-000000000052';
const UNKNOWN_ID = '0199c017-0000-7000-8000-0000000009ff';

/** Inserts a negotiated price of a relationship for a variant (and its product). */
async function insertPrice(
  id: string,
  relationshipId: string,
  variantId: string,
  price: number,
  deleted = false
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO customer_prices (
      id, customer_relationship_id, product_variant_id, price, set_by_id, deleted_at
    )
    VALUES (
      ${id}::uuid, ${relationshipId}::uuid, ${variantId}::uuid, ${price}::bigint,
      ${OWNER_ID}::uuid, ${deleted ? new Date('2026-02-01T00:00:00.000Z') : null}::timestamptz
    )
  `;
}

const reference = (relationshipId: string, variantId = VARIANT_ID) =>
  prisma.$transaction((tx) => getReferencePrice(tx, relationshipId, variantId));

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700017011', ...registered },
      { id: CUSTOMER_ID, fullName: 'Fixture One', phoneNumber: '+2250700017012', ...registered },
      {
        id: OTHER_CUSTOMER_ID,
        fullName: 'Fixture Two',
        phoneNumber: '+2250700017013',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier'), (${OTHER_ORG_ID}::uuid, 'Fixture Other Business')
  `;
  await seedProduct(prisma, {
    id: PRODUCT_ID,
    organizationId: SUPPLIER_ORG_ID,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: FOREIGN_PRODUCT_ID,
    organizationId: OTHER_ORG_ID,
    name: 'Fixture Oil',
    unit: 'can',
    price: 1500n,
  });
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price)
    VALUES (${SECOND_VARIANT_ID}::uuid, ${PRODUCT_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, 'Large', 'big sack', 5000)
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES
      (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid),
      (${OTHER_REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${OTHER_CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
});

describe('getReferencePrice of a variant (AC-1, CM-11)', () => {
  it('returns the variant price when no negotiated price exists', async () => {
    const result = await reference(REL_ID);
    expect(result.price).toBe(3000n);
    expect(result.negotiated).toBe(false);
    const [variant] = await prisma.$queryRaw<Array<{ price_updated_at: Date }>>`
      SELECT price_updated_at FROM product_variants WHERE id = ${VARIANT_ID}::uuid
    `;
    expect(result.changedAt.getTime()).toBe(variant.price_updated_at.getTime());
  });

  it('returns the negotiated price and its set_at when lower', async () => {
    await insertPrice(PRICE_ID, REL_ID, VARIANT_ID, 2800);
    const result = await reference(REL_ID);
    expect(result.price).toBe(2800n);
    expect(result.negotiated).toBe(true);
    const [row] = await prisma.$queryRaw<Array<{ set_at: Date }>>`
      SELECT set_at FROM customer_prices WHERE id = ${PRICE_ID}::uuid
    `;
    expect(result.changedAt.getTime()).toBe(row.set_at.getTime());
  });

  it('returns the negotiated price even when higher than the variant price', async () => {
    await insertPrice(PRICE_ID, REL_ID, VARIANT_ID, 3500);
    const result = await reference(REL_ID);
    expect(result.price).toBe(3500n);
    expect(result.negotiated).toBe(true);
  });

  it('ignores a deleted negotiated price', async () => {
    await insertPrice(PRICE_ID, REL_ID, VARIANT_ID, 2800, true);
    const result = await reference(REL_ID);
    expect(result.price).toBe(3000n);
    expect(result.negotiated).toBe(false);
  });
});

describe('getReferencePrice each variant has its own price (AC-2, CM-11)', () => {
  it('applies a negotiated price to its variant only', async () => {
    await insertPrice(PRICE_ID, REL_ID, VARIANT_ID, 2800);
    const first = await reference(REL_ID, VARIANT_ID);
    const second = await reference(REL_ID, SECOND_VARIANT_ID);
    expect(first.price).toBe(2800n);
    expect(first.negotiated).toBe(true);
    expect(second.price).toBe(5000n);
    expect(second.negotiated).toBe(false);
  });
});

describe('getReferencePrice refused (AC-3)', () => {
  it.each([
    ['an unknown relationship', UNKNOWN_ID, VARIANT_ID],
    ['an unknown variant', REL_ID, UNKNOWN_ID],
    ['a variant of another business', REL_ID, FOREIGN_VARIANT_ID],
  ])('throws 404 NOT_FOUND for %s', async (_case, relationshipId, variantId) => {
    await expect(reference(relationshipId, variantId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});

describe('getReferencePrice of a product written the old way (AC-4)', () => {
  it('answers with the product id as for any variant', async () => {
    await insertPrice(PRICE_ID, REL_ID, VARIANT_ID, 2800);
    expect((await reference(REL_ID, PRODUCT_ID)).price).toBe(2800n);
    expect((await reference(OTHER_REL_ID, PRODUCT_ID)).price).toBe(3000n);
  });
});

describe('getReferencePrice other customers (AB-1, WSTG-ATHZ-02)', () => {
  it('never returns the price of relationship B for relationship A', async () => {
    await insertPrice(PRICE_ID, REL_ID, VARIANT_ID, 2800);
    await insertPrice(OTHER_PRICE_ID, OTHER_REL_ID, VARIANT_ID, 1000);
    expect((await reference(REL_ID)).price).toBe(2800n);
    expect((await reference(OTHER_REL_ID)).price).toBe(1000n);
  });

  it('is unchanged by another relationship negotiated price', async () => {
    await insertPrice(OTHER_PRICE_ID, OTHER_REL_ID, VARIANT_ID, 1000);
    const result = await reference(REL_ID);
    expect(result.price).toBe(3000n);
    expect(result.negotiated).toBe(false);
  });
});
