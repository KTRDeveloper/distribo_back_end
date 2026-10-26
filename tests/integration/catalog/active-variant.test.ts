import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { seedProduct } from '../../helpers/catalog-fixtures';
import { getActiveVariant } from '../../../src/modules/catalog/catalog.repository';

const ORG_ID = '0199c019-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199c019-0000-7000-8000-000000000002';
// Variants are inserted by hand.
const PRODUCT_ID = '0199c019-0000-7000-8000-000000000031';
const DELETED_PRODUCT_ID = '0199c019-0000-7000-8000-000000000032';
const PAUSED_PRODUCT_ID = '0199c019-0000-7000-8000-000000000033';
const FOREIGN_PRODUCT_ID = '0199c019-0000-7000-8000-000000000034';
// A product whose variant has the id of the product (CAT-013).
const LEGACY_PRODUCT_ID = '0199c019-0000-7000-8000-000000000035';
const VARIANT_ID = '0199c019-0000-7000-8000-000000000041';
const INACTIVE_VARIANT_ID = '0199c019-0000-7000-8000-000000000042';
const DELETED_VARIANT_ID = '0199c019-0000-7000-8000-000000000043';
const DELETED_PRODUCT_VARIANT_ID = '0199c019-0000-7000-8000-000000000044';
const PAUSED_PRODUCT_VARIANT_ID = '0199c019-0000-7000-8000-000000000045';
const FOREIGN_VARIANT_ID = '0199c019-0000-7000-8000-000000000046';
const UNKNOWN_ID = '0199c019-0000-7000-8000-0000000009ff';

const read = (variantId: string, organizationId = ORG_ID) =>
  prisma.$transaction((tx) => getActiveVariant(tx, organizationId, variantId));

async function refusal(variantId: string, organizationId = ORG_ID): Promise<unknown> {
  try {
    await read(variantId, organizationId);
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

beforeEach(async () => {
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${ORG_ID}::uuid, 'Fixture Business'), (${OTHER_ORG_ID}::uuid, 'Fixture Other Business')
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, deleted_at, paused_at)
    VALUES
      (${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'T-shirt', NULL, NULL),
      (${DELETED_PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Fixture Deleted',
        '2026-02-01T00:00:00Z'::timestamptz, NULL),
      (${PAUSED_PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Fixture Paused',
        NULL, '2026-02-01T00:00:00Z'::timestamptz),
      (${FOREIGN_PRODUCT_ID}::uuid, ${OTHER_ORG_ID}::uuid, 'Fixture Foreign', NULL, NULL)
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price,
      min_order_quantity, status, deleted_at)
    VALUES
      (${VARIANT_ID}::uuid, ${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Rouge / L', 'piece', 3000,
        2.5, 'ACTIVE', NULL),
      (${INACTIVE_VARIANT_ID}::uuid, ${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Inactive', 'piece', 3000,
        NULL, 'INACTIVE', NULL),
      (${DELETED_VARIANT_ID}::uuid, ${PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Deleted', 'piece', 3000,
        NULL, 'ACTIVE', '2026-02-01T00:00:00Z'::timestamptz),
      (${DELETED_PRODUCT_VARIANT_ID}::uuid, ${DELETED_PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Of deleted',
        'piece', 3000, NULL, 'ACTIVE', NULL),
      (${PAUSED_PRODUCT_VARIANT_ID}::uuid, ${PAUSED_PRODUCT_ID}::uuid, ${ORG_ID}::uuid, 'Of paused',
        'piece', 3000, NULL, 'ACTIVE', NULL),
      (${FOREIGN_VARIANT_ID}::uuid, ${FOREIGN_PRODUCT_ID}::uuid, ${OTHER_ORG_ID}::uuid, 'Foreign',
        'piece', 3000, NULL, 'ACTIVE', NULL)
  `;
});

describe('getActiveVariant', () => {
  it('returns the variant with its product name', async () => {
    const [row] = await prisma.$queryRaw<Array<{ price_updated_at: Date }>>`
      SELECT price_updated_at FROM product_variants WHERE id = ${VARIANT_ID}::uuid
    `;
    const variant = await read(VARIANT_ID);
    expect(variant).toMatchObject({
      id: VARIANT_ID,
      productId: PRODUCT_ID,
      productName: 'T-shirt',
      variantName: 'Rouge / L',
      unit: 'piece',
      price: 3000n,
      priceUpdatedAt: row.price_updated_at,
    });
    expect(variant.minOrderQuantity?.toString()).toBe('2.5');
    expect(Object.keys(variant).sort()).toEqual(
      [
        'id',
        'minOrderQuantity',
        'priceUpdatedAt',
        'price',
        'productId',
        'productName',
        'unit',
        'variantName',
      ].sort()
    );
  });

  it.each([
    ['an INACTIVE variant', INACTIVE_VARIANT_ID],
    ['a deleted variant', DELETED_VARIANT_ID],
    ['a variant of a deleted product', DELETED_PRODUCT_VARIANT_ID],
    ['a variant of a paused product', PAUSED_PRODUCT_VARIANT_ID],
    ['a variant of another business', FOREIGN_VARIANT_ID],
    ['an unknown variant', UNKNOWN_ID],
  ])('refuses %s with the same 404', async (_case, variantId) => {
    expect(await refusal(variantId)).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Not found',
    });
  });

  it('answers for the id of a product written the old way', async () => {
    await seedProduct(prisma, {
      id: LEGACY_PRODUCT_ID,
      organizationId: ORG_ID,
      name: 'Fixture Rice',
      unit: 'sack',
      price: 4000n,
    });
    const variant = await read(LEGACY_PRODUCT_ID);
    expect(variant).toMatchObject({
      id: LEGACY_PRODUCT_ID,
      productId: LEGACY_PRODUCT_ID,
      productName: 'Fixture Rice',
      unit: 'sack',
      price: 4000n,
    });
  });

  it('gives the same 404 for another business and for an unknown variant (AB-1)', async () => {
    const other = await refusal(FOREIGN_VARIANT_ID);
    const unknown = await refusal(UNKNOWN_ID);
    expect(other).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect({
      statusCode: (other as { statusCode: number }).statusCode,
      code: (other as { code: string }).code,
      message: (other as Error).message,
    }).toEqual({
      statusCode: (unknown as { statusCode: number }).statusCode,
      code: (unknown as { code: string }).code,
      message: (unknown as Error).message,
    });
  });
});
