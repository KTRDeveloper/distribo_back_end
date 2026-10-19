import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import {
  setProductImageKeys,
  setVariantImageKeys,
} from '../../../src/modules/catalog/catalog.repository';

const ORG = '0199c032-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c032-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c032-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c032-0000-7000-8000-0000000000b2';
const VARIANT = '0199c032-0000-7000-8000-0000000000c1';
const OTHER_VARIANT = '0199c032-0000-7000-8000-0000000000c2';
const UNKNOWN = '0199c032-0000-7000-8000-0000000000ff';

const KEY_A = 'products/0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_B = 'products/1b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_C = 'products/2b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_D = 'products/3b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_E = 'products/4b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_F = 'products/5b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';

async function cleanUp() {
  await prisma.$executeRaw`
    DELETE FROM product_variants WHERE organization_id IN (${ORG}::uuid, ${OTHER_ORG}::uuid)
  `;
  await prisma.$executeRaw`
    DELETE FROM products WHERE organization_id IN (${ORG}::uuid, ${OTHER_ORG}::uuid)
  `;
  await prisma.$executeRaw`
    DELETE FROM organizations WHERE id IN (${ORG}::uuid, ${OTHER_ORG}::uuid)
  `;
}

async function productKeys(id: string): Promise<string[]> {
  const [row] = await prisma.$queryRaw<Array<{ image_keys: string[] }>>`
    SELECT image_keys FROM products WHERE id = ${id}::uuid
  `;
  return row.image_keys;
}

async function variantKeys(id: string): Promise<string[]> {
  const [row] = await prisma.$queryRaw<Array<{ image_keys: string[] }>>`
    SELECT image_keys FROM product_variants WHERE id = ${id}::uuid
  `;
  return row.image_keys;
}

async function productDate(id: string): Promise<Date> {
  const [row] = await prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
    SELECT server_updated_at FROM products WHERE id = ${id}::uuid
  `;
  return row.server_updated_at;
}

async function setProductKeys(keys: string[]) {
  await prisma.$executeRaw`UPDATE products SET image_keys = ${keys}::text[] WHERE id = ${PRODUCT}::uuid`;
}

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${ORG}::uuid, 'Fixture Business'), (${OTHER_ORG}::uuid, 'Other Business')
  `;
  // An empty unit marks a new-style product: no variant is mirrored from it (CAT-014).
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price) VALUES
      (${PRODUCT}::uuid, ${ORG}::uuid, 'Fixture Shirt', '', 3000),
      (${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, 'Other Shirt', '', 3000)
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price) VALUES
      (${VARIANT}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Rouge / L', 'piece', 3000),
      (${OTHER_VARIANT}::uuid, ${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, 'Bleu / M', 'piece', 3000)
  `;
});

afterAll(cleanUp);

const run = <T>(fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>) =>
  prisma.$transaction(fn);

describe('setProductImageKeys', () => {
  const rows: Array<{ before: string[]; given: string[] }> = [
    { before: [], given: [KEY_A] },
    { before: [KEY_A], given: [KEY_B, KEY_C] },
    { before: [KEY_B, KEY_C], given: [] },
  ];

  it.each(rows)('returns $before and stores $given', async ({ before, given }) => {
    await setProductKeys(before);
    const previous = await run((tx) => setProductImageKeys(tx, ORG, PRODUCT, given));
    expect(previous).toEqual(before);
    expect(await productKeys(PRODUCT)).toEqual(given);
  });

  it('accepts five keys', async () => {
    const five = [KEY_A, KEY_B, KEY_C, KEY_D, KEY_E];
    await run((tx) => setProductImageKeys(tx, ORG, PRODUCT, five));
    expect(await productKeys(PRODUCT)).toEqual(five);
  });

  it('moves the server date of the product', async () => {
    const before = await productDate(PRODUCT);
    await run((tx) => setProductImageKeys(tx, ORG, PRODUCT, [KEY_A]));
    expect((await productDate(PRODUCT)).getTime()).toBeGreaterThan(before.getTime());
  });
});

describe('setVariantImageKeys', () => {
  it('stores the key and moves the date of the product', async () => {
    const before = await productDate(PRODUCT);
    const previous = await run((tx) => setVariantImageKeys(tx, ORG, VARIANT, [KEY_A]));
    expect(previous).toEqual([]);
    expect(await variantKeys(VARIANT)).toEqual([KEY_A]);
    expect((await productDate(PRODUCT)).getTime()).toBeGreaterThan(before.getTime());
  });

  it('replaces and clears, returning the previous list', async () => {
    await run((tx) => setVariantImageKeys(tx, ORG, VARIANT, [KEY_A, KEY_B]));
    expect(await run((tx) => setVariantImageKeys(tx, ORG, VARIANT, [KEY_C]))).toEqual([
      KEY_A,
      KEY_B,
    ]);
    expect(await run((tx) => setVariantImageKeys(tx, ORG, VARIANT, []))).toEqual([KEY_C]);
    expect(await variantKeys(VARIANT)).toEqual([]);
  });

  it('writes an INACTIVE variant', async () => {
    await prisma.$executeRaw`UPDATE product_variants SET status = 'INACTIVE' WHERE id = ${VARIANT}::uuid`;
    await run((tx) => setVariantImageKeys(tx, ORG, VARIANT, [KEY_A]));
    expect(await variantKeys(VARIANT)).toEqual([KEY_A]);
  });
});

describe('rows that cannot be written', () => {
  it('answers 404 for an id that is neither a product nor a variant', async () => {
    await expect(run((tx) => setProductImageKeys(tx, ORG, UNKNOWN, [KEY_A]))).rejects.toMatchObject(
      { statusCode: 404, code: 'NOT_FOUND' }
    );
    await expect(run((tx) => setVariantImageKeys(tx, ORG, UNKNOWN, [KEY_A]))).rejects.toMatchObject(
      { statusCode: 404, code: 'NOT_FOUND' }
    );
  });

  it('answers 404 for a deleted product or variant and writes nothing', async () => {
    await prisma.$executeRaw`UPDATE product_variants SET deleted_at = now() WHERE id = ${VARIANT}::uuid`;
    await prisma.$executeRaw`UPDATE products SET deleted_at = now() WHERE id = ${PRODUCT}::uuid`;
    await expect(run((tx) => setProductImageKeys(tx, ORG, PRODUCT, [KEY_A]))).rejects.toMatchObject(
      { statusCode: 404, code: 'NOT_FOUND' }
    );
    await expect(run((tx) => setVariantImageKeys(tx, ORG, VARIANT, [KEY_A]))).rejects.toMatchObject(
      { statusCode: 404, code: 'NOT_FOUND' }
    );
    expect(await productKeys(PRODUCT)).toEqual([]);
    expect(await variantKeys(VARIANT)).toEqual([]);
  });
});

describe('two replacements at once', () => {
  it('serializes them: one sees A, the other sees the first writer key', async () => {
    await setProductKeys([KEY_A]);
    const results = await Promise.all([
      run((tx) => setProductImageKeys(tx, ORG, PRODUCT, [KEY_B])),
      run((tx) => setProductImageKeys(tx, ORG, PRODUCT, [KEY_C])),
    ]);
    const [first, second] = results;
    const finalKeys = await productKeys(PRODUCT);
    expect([KEY_B, KEY_C]).toContain(finalKeys[0]);
    // The writer that ran last returns the key of the one that ran first.
    const lastWriterReturned = finalKeys[0] === KEY_B ? first : second;
    const firstWriterReturned = finalKeys[0] === KEY_B ? second : first;
    expect(firstWriterReturned).toEqual([KEY_A]);
    expect(lastWriterReturned).toEqual([finalKeys[0] === KEY_B ? KEY_C : KEY_B]);
  });
});

describe('crafted keys', () => {
  const crafted: Array<[string, string[]]> = [
    ['another folder', ['avatars/0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp']],
    ['a path segment', ['products/../x.webp']],
    ['an uppercase UUID', ['products/0B1C2D3E-4F5A-4B6C-8D7E-9F0A1B2C3D4E.webp']],
    ['six keys', [KEY_A, KEY_B, KEY_C, KEY_D, KEY_E, KEY_F]],
    ['the same key twice', [KEY_A, KEY_A]],
  ];

  it.each(crafted)('throws a RangeError for %s and changes nothing', async (_name, keys) => {
    await setProductKeys([KEY_F]);
    await run((tx) => setVariantImageKeys(tx, ORG, VARIANT, [KEY_E]));
    await expect(run((tx) => setProductImageKeys(tx, ORG, PRODUCT, keys))).rejects.toBeInstanceOf(
      RangeError
    );
    await expect(run((tx) => setVariantImageKeys(tx, ORG, VARIANT, keys))).rejects.toBeInstanceOf(
      RangeError
    );
    expect(await productKeys(PRODUCT)).toEqual([KEY_F]);
    expect(await variantKeys(VARIANT)).toEqual([KEY_E]);
  });
});

describe('a product of another business', () => {
  it('answers 404 and leaves the keys of the other business unchanged', async () => {
    await prisma.$executeRaw`UPDATE products SET image_keys = ARRAY[${KEY_A}]::text[] WHERE id = ${OTHER_PRODUCT}::uuid`;
    await prisma.$executeRaw`UPDATE product_variants SET image_keys = ARRAY[${KEY_B}]::text[] WHERE id = ${OTHER_VARIANT}::uuid`;
    await expect(
      run((tx) => setProductImageKeys(tx, ORG, OTHER_PRODUCT, [KEY_C]))
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    await expect(
      run((tx) => setVariantImageKeys(tx, ORG, OTHER_VARIANT, [KEY_C]))
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(await productKeys(OTHER_PRODUCT)).toEqual([KEY_A]);
    expect(await variantKeys(OTHER_VARIANT)).toEqual([KEY_B]);
  });
});
