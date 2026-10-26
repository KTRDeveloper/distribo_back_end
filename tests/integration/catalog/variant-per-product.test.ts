import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { seedProduct } from '../../helpers/catalog-fixtures';

const ORG_A = '0199c013-0000-7000-8000-0000000000a1';
const PRODUCT_PRICED = '0199c013-0000-7000-8000-0000000000b1';

type VariantRow = {
  price_updated_at: Date;
};

function variantsOf(productId: string) {
  return prisma.$queryRaw<VariantRow[]>`
    SELECT price_updated_at FROM product_variants WHERE product_id = ${productId}::uuid ORDER BY id
  `;
}

async function cleanUp() {
  await prisma.$executeRaw`DELETE FROM product_variants WHERE organization_id = ${ORG_A}::uuid`;
  await prisma.$executeRaw`DELETE FROM products WHERE organization_id = ${ORG_A}::uuid`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG_A}::uuid`;
}

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_A}::uuid, 'Fixture Business A')`;
  await seedProduct(prisma, {
    id: PRODUCT_PRICED,
    organizationId: ORG_A,
    name: 'Rice',
    unit: 'sack',
    price: 3000n,
    minOrderQuantity: '2.5',
    status: 'INACTIVE',
  });
});

afterAll(cleanUp);

describe('variant per product', () => {
  it('trigger: the price-date trigger is on and moves the date only when the price changes', async () => {
    const [enabled] = await prisma.$queryRaw<Array<{ tgenabled: string }>>`
      SELECT tgenabled::text AS tgenabled FROM pg_trigger
      WHERE tgname = 'product_variants_set_price_updated_at'
    `;
    expect(enabled.tgenabled).toBe('O');

    const [before] = await variantsOf(PRODUCT_PRICED);
    await prisma.$executeRaw`UPDATE product_variants SET price = 3200 WHERE id = ${PRODUCT_PRICED}::uuid`;
    const [afterPrice] = await variantsOf(PRODUCT_PRICED);
    expect(afterPrice.price_updated_at.getTime()).toBeGreaterThan(before.price_updated_at.getTime());

    await prisma.$executeRaw`UPDATE product_variants SET unit = 'bag' WHERE id = ${PRODUCT_PRICED}::uuid`;
    const [afterUnit] = await variantsOf(PRODUCT_PRICED);
    expect(afterUnit.price_updated_at.getTime()).toBe(afterPrice.price_updated_at.getTime());
  });
});
