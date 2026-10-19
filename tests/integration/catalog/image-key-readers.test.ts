import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import {
  lockProductImageKeys,
  lockVariantImageKeys,
  readProductImageKeys,
  readVariantImageKeys,
  setProductImageKeys,
} from '../../../src/modules/catalog/catalog.repository';

const ORG = '0199c044-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c044-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c044-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c044-0000-7000-8000-0000000000b2';
const VARIANT = '0199c044-0000-7000-8000-0000000000c1';
const OTHER_VARIANT = '0199c044-0000-7000-8000-0000000000c2';
const UNKNOWN = '0199c044-0000-7000-8000-0000000000ff';

const KEY_A = 'products/0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_B = 'products/1b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_C = 'products/2b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_D = 'products/3b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';

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

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${ORG}::uuid, 'Fixture Business'), (${OTHER_ORG}::uuid, 'Other Business')
  `;
  // An empty unit marks a new-style product: no variant is mirrored from it (CAT-014).
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price, image_keys) VALUES
      (${PRODUCT}::uuid, ${ORG}::uuid, 'Fixture Shirt', '', 3000, ARRAY[${KEY_A}, ${KEY_B}]::text[]),
      (${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, 'Other Shirt', '', 3000, ARRAY[${KEY_D}]::text[])
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, image_keys) VALUES
      (${VARIANT}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Rouge / L', 'piece', 3000, ARRAY[${KEY_C}]::text[]),
      (${OTHER_VARIANT}::uuid, ${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, 'Bleu / M', 'piece', 3000, ARRAY[${KEY_D}]::text[])
  `;
});

afterAll(cleanUp);

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const run = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn);
const notFound = { statusCode: 404, code: 'NOT_FOUND' };

describe('product readers', () => {
  it.each([
    ['lockProductImageKeys', lockProductImageKeys],
    ['readProductImageKeys', readProductImageKeys],
  ])('%s returns the keys in display order', async (_name, reader) => {
    expect(await run((tx) => reader(tx, ORG, PRODUCT))).toEqual([KEY_A, KEY_B]);
  });
});

describe('variant readers', () => {
  it.each([
    ['lockVariantImageKeys', lockVariantImageKeys],
    ['readVariantImageKeys', readVariantImageKeys],
  ])('%s returns the product id and the keys', async (_name, reader) => {
    expect(await run((tx) => reader(tx, ORG, VARIANT))).toEqual({
      productId: PRODUCT,
      keys: [KEY_C],
    });
  });

  it('reads an INACTIVE variant', async () => {
    await prisma.$executeRaw`UPDATE product_variants SET status = 'INACTIVE' WHERE id = ${VARIANT}::uuid`;
    expect(await run((tx) => lockVariantImageKeys(tx, ORG, VARIANT))).toEqual({
      productId: PRODUCT,
      keys: [KEY_C],
    });
  });
});

describe('the lock holds', () => {
  it('makes a second locker wait, then return the list the first committed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));

    const first = run(async (tx) => {
      await lockProductImageKeys(tx, ORG, PRODUCT);
      locked();
      await gate;
      await setProductImageKeys(tx, ORG, PRODUCT, [KEY_D]);
    });
    await hasLock;

    let secondDone = false;
    const second = run((tx) => lockProductImageKeys(tx, ORG, PRODUCT)).then((keys) => {
      secondDone = true;
      return keys;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(secondDone).toBe(false);

    release();
    await first;
    expect(await second).toEqual([KEY_D]);
  });

  it('makes a second variant locker wait too', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));

    const first = run(async (tx) => {
      await lockVariantImageKeys(tx, ORG, VARIANT);
      locked();
      await gate;
      await tx.$executeRaw`UPDATE product_variants SET image_keys = ARRAY[${KEY_D}]::text[] WHERE id = ${VARIANT}::uuid`;
    });
    await hasLock;

    let secondDone = false;
    const second = run((tx) => lockVariantImageKeys(tx, ORG, VARIANT)).then((value) => {
      secondDone = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(secondDone).toBe(false);

    release();
    await first;
    expect(await second).toEqual({ productId: PRODUCT, keys: [KEY_D] });
  });
});

describe('rows that cannot be read', () => {
  const readers = [
    ['lockProductImageKeys', lockProductImageKeys],
    ['readProductImageKeys', readProductImageKeys],
    ['lockVariantImageKeys', lockVariantImageKeys],
    ['readVariantImageKeys', readVariantImageKeys],
  ] as const;

  it.each(readers)('%s answers 404 for an unknown id', async (_name, reader) => {
    await expect(run((tx) => reader(tx, ORG, UNKNOWN))).rejects.toMatchObject(notFound);
  });

  it('answers 404 for a deleted product', async () => {
    await prisma.$executeRaw`UPDATE products SET deleted_at = now() WHERE id = ${PRODUCT}::uuid`;
    await expect(run((tx) => lockProductImageKeys(tx, ORG, PRODUCT))).rejects.toMatchObject(
      notFound
    );
    await expect(run((tx) => readProductImageKeys(tx, ORG, PRODUCT))).rejects.toMatchObject(
      notFound
    );
  });

  it('answers 404 for a deleted variant', async () => {
    await prisma.$executeRaw`UPDATE product_variants SET deleted_at = now() WHERE id = ${VARIANT}::uuid`;
    await expect(run((tx) => lockVariantImageKeys(tx, ORG, VARIANT))).rejects.toMatchObject(
      notFound
    );
    await expect(run((tx) => readVariantImageKeys(tx, ORG, VARIANT))).rejects.toMatchObject(
      notFound
    );
  });
});

describe('a card of another organization', () => {
  it('answers 404 and returns no key to organization B', async () => {
    await expect(run((tx) => lockProductImageKeys(tx, OTHER_ORG, PRODUCT))).rejects.toMatchObject(
      notFound
    );
    await expect(run((tx) => readProductImageKeys(tx, OTHER_ORG, PRODUCT))).rejects.toMatchObject(
      notFound
    );
    await expect(run((tx) => lockVariantImageKeys(tx, OTHER_ORG, VARIANT))).rejects.toMatchObject(
      notFound
    );
    await expect(run((tx) => readVariantImageKeys(tx, OTHER_ORG, VARIANT))).rejects.toMatchObject(
      notFound
    );
  });
});
