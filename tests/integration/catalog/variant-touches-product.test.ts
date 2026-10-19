import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const ORG = '0199c021-0000-7000-8000-0000000000a1';
const PRODUCT = '0199c021-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c021-0000-7000-8000-0000000000b2';
const OLD_STYLE = '0199c021-0000-7000-8000-0000000000b3';
const VARIANT = '0199c021-0000-7000-8000-0000000000c1';
const OTHER_VARIANT = '0199c021-0000-7000-8000-0000000000c2';

const appPrisma = getAppRolePrisma();

async function cleanUp() {
  await prisma.$executeRaw`DELETE FROM product_variants WHERE organization_id = ${ORG}::uuid`;
  await prisma.$executeRaw`DELETE FROM products WHERE organization_id = ${ORG}::uuid`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG}::uuid`;
}

/** Puts every fixture product back to an old server date (the product triggers are switched off). */
async function ageProducts() {
  await prisma.$executeRaw`ALTER TABLE products DISABLE TRIGGER USER`;
  try {
    await prisma.$executeRaw`
      UPDATE products SET server_updated_at = '2020-01-01T00:00:00Z'::timestamptz
      WHERE organization_id = ${ORG}::uuid
    `;
  } finally {
    await prisma.$executeRaw`ALTER TABLE products ENABLE TRIGGER USER`;
  }
}

async function productDate(id: string): Promise<Date> {
  const [row] = await prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
    SELECT server_updated_at FROM products WHERE id = ${id}::uuid
  `;
  return row.server_updated_at;
}

async function expectRecent(id: string) {
  const [row] = await prisma.$queryRaw<Array<{ server_updated_at: Date; now: Date }>>`
    SELECT server_updated_at, now() AS now FROM products WHERE id = ${id}::uuid
  `;
  expect(row.server_updated_at.getUTCFullYear()).toBeGreaterThan(2020);
  expect(Math.abs(row.server_updated_at.getTime() - row.now.getTime())).toBeLessThan(60_000);
}

function insertVariant(id: string, product: string) {
  return prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price)
    VALUES (${id}::uuid, ${product}::uuid, ${ORG}::uuid, 'Large', 'sack', 3000)
  `;
}

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG}::uuid, 'Fixture Business')`;
  // An empty unit marks a new-style product: no variant is mirrored from it (CAT-014).
  for (const id of [PRODUCT, OTHER_PRODUCT]) {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name, unit, price)
      VALUES (${id}::uuid, ${ORG}::uuid, 'Fixture Rice', '', 3000)
    `;
  }
});

afterAll(async () => {
  await cleanUp();
  await appPrisma.$disconnect();
});

describe('a variant change moves its product server date', () => {
  it('insert: the product date becomes the database time', async () => {
    await ageProducts();
    expect((await productDate(PRODUCT)).getUTCFullYear()).toBe(2020);

    await insertVariant(VARIANT, PRODUCT);

    await expectRecent(PRODUCT);
  });

  describe('update', () => {
    const changes: Array<[string, () => Promise<unknown>]> = [
      [
        'a new price',
        () => prisma.$executeRaw`UPDATE product_variants SET price = 3500 WHERE id = ${VARIANT}::uuid`,
      ],
      [
        'status INACTIVE',
        () =>
          prisma.$executeRaw`UPDATE product_variants SET status = 'INACTIVE' WHERE id = ${VARIANT}::uuid`,
      ],
      [
        'a new name',
        () =>
          prisma.$executeRaw`UPDATE product_variants SET name = 'Small' WHERE id = ${VARIANT}::uuid`,
      ],
      [
        'deleted_at set',
        () =>
          prisma.$executeRaw`UPDATE product_variants SET deleted_at = now() WHERE id = ${VARIANT}::uuid`,
      ],
      [
        'a new image_keys list',
        () =>
          prisma.$executeRaw`UPDATE product_variants SET image_keys = ARRAY['k-1','k-2']::text[] WHERE id = ${VARIANT}::uuid`,
      ],
    ];

    it.each(changes)('%s', async (_label, change) => {
      await insertVariant(VARIANT, PRODUCT);
      await ageProducts();

      await change();

      await expectRecent(PRODUCT);
    });
  });

  it('only its own product moves', async () => {
    await insertVariant(VARIANT, PRODUCT);
    await insertVariant(OTHER_VARIANT, OTHER_PRODUCT);
    await ageProducts();

    await prisma.$executeRaw`UPDATE product_variants SET price = 3500 WHERE id = ${VARIANT}::uuid`;

    await expectRecent(PRODUCT);
    expect((await productDate(OTHER_PRODUCT)).getUTCFullYear()).toBe(2020);
  });

  it('no loop: an old-style price update ends and both rows carry the price', async () => {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name, unit, price)
      VALUES (${OLD_STYLE}::uuid, ${ORG}::uuid, 'Old Rice', 'sack', 3000)
    `;
    await ageProducts();

    await prisma.$executeRaw`UPDATE products SET price = 4000 WHERE id = ${OLD_STYLE}::uuid`;

    const [row] = await prisma.$queryRaw<Array<{ product_price: bigint; variant_price: bigint }>>`
      SELECT p.price AS product_price, v.price AS variant_price
      FROM products p JOIN product_variants v ON v.id = p.id
      WHERE p.id = ${OLD_STYLE}::uuid
    `;
    expect(row).toEqual({ product_price: 4000n, variant_price: 4000n });
    await expectRecent(OLD_STYLE);
  });

  it('raw write as the application account still moves the product date', async () => {
    await insertVariant(VARIANT, PRODUCT);
    await ageProducts();

    await appPrisma.$executeRaw`UPDATE product_variants SET price = 3600 WHERE id = ${VARIANT}::uuid`;

    await expectRecent(PRODUCT);
  });
});
