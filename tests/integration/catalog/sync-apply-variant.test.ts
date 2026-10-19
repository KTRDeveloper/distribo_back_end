import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { applyVariantFromSync } from '../../../src/modules/catalog/catalog.sync-writers';

const ORG = '0199c034-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c034-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c034-0000-7000-8000-0000000000b1';
const SECOND_PRODUCT = '0199c034-0000-7000-8000-0000000000b2';
const OTHER_PRODUCT = '0199c034-0000-7000-8000-0000000000b3';
const DELETED_PRODUCT = '0199c034-0000-7000-8000-0000000000b4';
const PIECE = '0199c034-0000-7000-8000-0000000000c1';
const CARTON = '0199c034-0000-7000-8000-0000000000c2';
const OTHER_VARIANT = '0199c034-0000-7000-8000-0000000000c3';
const DELETED_VARIANT = '0199c034-0000-7000-8000-0000000000c4';
const NEW_VARIANT = '0199c034-0000-7000-8000-0000000000c5';
const KEY = 'products/0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';

type Row = {
  product_id: string;
  organization_id: string;
  name: string | null;
  unit: string;
  price: bigint;
  min_order_quantity: string | null;
  status: string;
  image_keys: string[];
  merged_into_id: string | null;
  price_updated_at: Date;
  server_updated_at: Date;
  deleted_at: Date | null;
};

async function cleanUp() {
  await prisma.$executeRaw`
    UPDATE product_variants SET merged_into_id = NULL
    WHERE organization_id IN (${ORG}::uuid, ${OTHER_ORG}::uuid)
  `;
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

async function readRow(id: string): Promise<Row | undefined> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT product_id, organization_id, name, unit, price, min_order_quantity::text AS min_order_quantity,
           status::text AS status, image_keys, merged_into_id, price_updated_at, server_updated_at,
           deleted_at
    FROM product_variants WHERE id = ${id}::uuid`;
  return rows[0];
}

async function countRows(): Promise<number> {
  const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM product_variants
    WHERE organization_id IN (${ORG}::uuid, ${OTHER_ORG}::uuid)`;
  return n;
}

async function productDate(id: string): Promise<Date> {
  const [{ server_updated_at }] = await prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
    SELECT server_updated_at FROM products WHERE id = ${id}::uuid`;
  return server_updated_at;
}

function apply(input: Record<string, unknown>) {
  return prisma.$transaction((tx) =>
    applyVariantFromSync(tx, ORG, input as Parameters<typeof applyVariantFromSync>[2], new Date())
  );
}

const base = {
  id: PIECE,
  productId: PRODUCT,
  name: null,
  unit: 'pièce',
  price: 5000,
  minOrderQuantity: null,
  status: 'ACTIVE',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${ORG}::uuid, 'Fixture Business'), (${OTHER_ORG}::uuid, 'Other Business')
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price)
    VALUES (${PRODUCT}::uuid, ${ORG}::uuid, 'T-shirt', '', 1),
           (${SECOND_PRODUCT}::uuid, ${ORG}::uuid, 'Riz', '', 1),
           (${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, 'Huile', '', 1)
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price, deleted_at)
    VALUES (${DELETED_PRODUCT}::uuid, ${ORG}::uuid, 'Vieux', '', 1, now())
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price)
    VALUES (${PIECE}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Rouge / L', 'pièce', 5000),
           (${CARTON}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Rouge / L', 'carton', 40000),
           (${OTHER_VARIANT}::uuid, ${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, NULL, 'litre', 900)
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, deleted_at)
    VALUES (${DELETED_VARIANT}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Vieux', 'sac', 100, now())
  `;
});

afterAll(cleanUp);

describe('applyVariantFromSync', () => {
  describe('creation (AC-1)', () => {
    it('creates an unknown id ACTIVE with the price date set', async () => {
      const result = await apply({
        ...base,
        id: NEW_VARIANT,
        name: 'Bleu / M',
        unit: 'boîte',
        price: 7000,
      });
      expect(result).toEqual({ result: 'CREATED' });
      expect(await readRow(NEW_VARIANT)).toMatchObject({
        product_id: PRODUCT,
        organization_id: ORG,
        name: 'Bleu / M',
        unit: 'boîte',
        price: 7000n,
        min_order_quantity: null,
        status: 'ACTIVE',
        image_keys: [],
        merged_into_id: null,
        deleted_at: null,
      });
      const [{ near }] = await prisma.$queryRaw<Array<{ near: boolean }>>`
        SELECT abs(extract(epoch FROM (now() - price_updated_at))) < 30 AS near
        FROM product_variants WHERE id = ${NEW_VARIANT}::uuid`;
      expect(near).toBe(true);
    });

    it('stores the five fields the phone sent, minimum and status included', async () => {
      await apply({
        ...base,
        id: NEW_VARIANT,
        unit: 'boîte',
        minOrderQuantity: '2.5',
        status: 'INACTIVE',
      });
      expect(await readRow(NEW_VARIANT)).toMatchObject({
        name: null,
        min_order_quantity: '2.500',
        status: 'INACTIVE',
      });
    });

    it('moves the product date', async () => {
      const before = await productDate(PRODUCT);
      await sleep(25);
      await apply({ ...base, id: NEW_VARIANT, unit: 'boîte' });
      expect((await productDate(PRODUCT)).getTime()).toBeGreaterThan(before.getTime());
    });

    it('accepts the same text in another product or against a deleted variant', async () => {
      expect(
        await apply({ ...base, id: NEW_VARIANT, productId: SECOND_PRODUCT, name: 'Rouge / L' })
      ).toEqual({ result: 'CREATED' });
      expect(
        await apply({
          ...base,
          id: '0199c034-0000-7000-8000-0000000000c6',
          name: 'vieux',
          unit: 'SAC',
        })
      ).toEqual({ result: 'CREATED' });
    });
  });

  describe('edit (AC-2, C-13)', () => {
    it('rewrites the five fields and moves the price date with a new price', async () => {
      const before = await readRow(PIECE);
      await sleep(25);
      const result = await apply({
        ...base,
        name: 'Rouge / XL',
        unit: 'pièces',
        price: 5500,
        minOrderQuantity: '3',
        status: 'INACTIVE',
      });
      expect(result).toEqual({ result: 'UPDATED' });
      const row = await readRow(PIECE);
      expect(row).toMatchObject({
        name: 'Rouge / XL',
        unit: 'pièces',
        price: 5500n,
        min_order_quantity: '3.000',
        status: 'INACTIVE',
      });
      expect(row?.price_updated_at.getTime()).toBeGreaterThan(before!.price_updated_at.getTime());
    });

    it('leaves the price date alone when only the name changes', async () => {
      const before = await readRow(PIECE);
      await sleep(25);
      const result = await apply({ ...base, name: 'Rouge / XXL' });
      expect(result).toEqual({ result: 'UPDATED' });
      const row = await readRow(PIECE);
      expect(row?.name).toBe('Rouge / XXL');
      expect(row?.price_updated_at.getTime()).toBe(before?.price_updated_at.getTime());
    });

    it('clears the minimum when the phone sends null', async () => {
      await apply({ ...base, name: 'Rouge / L', minOrderQuantity: '2' });
      expect((await readRow(PIECE))?.min_order_quantity).toBe('2.000');
      expect(await apply({ ...base, name: 'Rouge / L', minOrderQuantity: null })).toEqual({
        result: 'UPDATED',
      });
      expect((await readRow(PIECE))?.min_order_quantity).toBeNull();
    });

    it('answers UNCHANGED and moves no date when nothing differs', async () => {
      const row = await readRow(PIECE);
      const productBefore = await productDate(PRODUCT);
      await sleep(25);
      const result = await apply({ ...base, name: 'Rouge / L' });
      expect(result).toEqual({ result: 'UNCHANGED' });
      expect(await readRow(PIECE)).toEqual(row);
      expect((await productDate(PRODUCT)).getTime()).toBe(productBefore.getTime());
    });

    it('compares the minimum by value, not by text', async () => {
      await apply({ ...base, name: 'Rouge / L', minOrderQuantity: '2.5' });
      expect(await apply({ ...base, name: 'Rouge / L', minOrderQuantity: '2.50' })).toEqual({
        result: 'UNCHANGED',
      });
    });
  });

  describe('twin (AC-3, C-47)', () => {
    it('answers COLLISION and writes nothing when an edit makes a twin', async () => {
      const before = await readRow(CARTON);
      const result = await apply({ ...base, id: CARTON, name: 'rouge  /  l', unit: 'Pièce' });
      expect(result).toEqual({ result: 'COLLISION' });
      expect(await readRow(CARTON)).toEqual(before);
    });

    it('answers COLLISION and creates nothing when a new id is a twin', async () => {
      const count = await countRows();
      const result = await apply({ ...base, id: NEW_VARIANT, name: ' ROUGE / L ', unit: 'Pièce ' });
      expect(result).toEqual({ result: 'COLLISION' });
      expect(await readRow(NEW_VARIANT)).toBeUndefined();
      expect(await countRows()).toBe(count);
    });

    it('lets one of two simultaneous twin creations through and reports the other', async () => {
      const results = await Promise.all([
        apply({ ...base, id: NEW_VARIANT, name: 'Vert', unit: 'lot' }),
        apply({
          ...base,
          id: '0199c034-0000-7000-8000-0000000000c7',
          name: ' VERT ',
          unit: 'Lot',
        }),
      ]);
      expect(results.map((r) => r.result).sort()).toEqual(['COLLISION', 'CREATED']);
    });

    it('does not take a variant for its own twin', async () => {
      const result = await apply({ ...base, name: 'Rouge / L', unit: 'PIÈCE' });
      expect(result).toEqual({ result: 'UPDATED' });
    });
  });

  describe('nothing written (AC-4, AB-1)', () => {
    it.each([
      ['a product of another organization', { id: NEW_VARIANT, productId: OTHER_PRODUCT }],
      ['a deleted product', { id: NEW_VARIANT, productId: DELETED_PRODUCT }],
      [
        'an unknown product',
        { id: NEW_VARIANT, productId: '0199c034-0000-7000-8000-0000000000ff' },
      ],
    ])('NO_PRODUCT for %s', async (_label, patch) => {
      const count = await countRows();
      const result = await apply({ ...base, ...patch });
      expect(result).toEqual({ result: 'NO_PRODUCT' });
      expect(await readRow(NEW_VARIANT)).toBeUndefined();
      expect(await countRows()).toBe(count);
    });

    it('FOREIGN for the id of a variant of another organization', async () => {
      const before = await readRow(OTHER_VARIANT);
      const result = await apply({ ...base, id: OTHER_VARIANT, unit: 'volé', price: 1 });
      expect(result).toEqual({ result: 'FOREIGN' });
      expect(await readRow(OTHER_VARIANT)).toEqual(before);
    });

    it('GONE for the id of a deleted variant', async () => {
      const before = await readRow(DELETED_VARIANT);
      const result = await apply({ ...base, id: DELETED_VARIANT, unit: 'revenu' });
      expect(result).toEqual({ result: 'GONE' });
      expect(await readRow(DELETED_VARIANT)).toEqual(before);
    });

    it.each([
      ['price 0', { price: 0 }, 'price'],
      ['a negative price', { price: -5 }, 'price'],
      ['a fractional price', { price: 10.5 }, 'price'],
      ['an empty unit', { unit: '' }, 'unit'],
      ['a unit of blanks', { unit: '   ' }, 'unit'],
      ['a unit of 101 characters', { unit: 'u'.repeat(101) }, 'unit'],
      ['a name of 101 characters', { name: 'n'.repeat(101) }, 'name'],
      ['minimum 0', { minOrderQuantity: '0' }, 'minOrderQuantity'],
      ['minimum 0.0004', { minOrderQuantity: '0.0004' }, 'minOrderQuantity'],
      ['a negative minimum', { minOrderQuantity: '-1' }, 'minOrderQuantity'],
      ['a minimum in scientific notation', { minOrderQuantity: '1e3' }, 'minOrderQuantity'],
      ['a minimum above the column', { minOrderQuantity: '1000000000000' }, 'minOrderQuantity'],
      ['an unknown status', { status: 'DELETED' }, 'status'],
    ])('INVALID for %s, on an existing variant', async (_label, patch, field) => {
      const before = await readRow(PIECE);
      const result = await apply({ ...base, name: 'Rouge / L', ...patch });
      expect(result).toEqual({ result: 'INVALID', invalidFields: [field] });
      expect(await readRow(PIECE)).toEqual(before);
    });

    it('INVALID creates nothing and names every field, never a value', async () => {
      const count = await countRows();
      const result = await apply({
        ...base,
        id: NEW_VARIANT,
        price: 0,
        unit: '',
        minOrderQuantity: '0',
      });
      expect(result).toEqual({
        result: 'INVALID',
        invalidFields: ['unit', 'price', 'minOrderQuantity'],
      });
      expect(await countRows()).toBe(count);
    });

    it('accepts values at the limits', async () => {
      const result = await apply({
        ...base,
        id: NEW_VARIANT,
        name: 'n'.repeat(100),
        unit: 'u'.repeat(100),
        price: 1,
        minOrderQuantity: '0.001',
      });
      expect(result).toEqual({ result: 'CREATED' });
    });

    it('checks the values before looking at the product', async () => {
      const result = await apply({ ...base, id: NEW_VARIANT, productId: OTHER_PRODUCT, price: 0 });
      expect(result.result).toBe('INVALID');
    });
  });

  describe('server fields (AC-5)', () => {
    const smuggled = {
      merged_into_id: CARTON,
      mergedIntoId: CARTON,
      price_updated_at: new Date('2020-01-01T00:00:00Z'),
      priceUpdatedAt: new Date('2020-01-01T00:00:00Z'),
      image_keys: [KEY],
      imageKeys: [KEY],
      deleted_at: new Date(),
      deletedAt: new Date(),
      organizationId: OTHER_ORG,
      organization_id: OTHER_ORG,
      server_updated_at: new Date('2020-01-01T00:00:00Z'),
    };

    it('writes none of them on an edit, and the product never changes', async () => {
      const before = await readRow(PIECE);
      const result = await apply({
        ...base,
        name: 'Rouge / L',
        price: 5500,
        productId: SECOND_PRODUCT,
        product_id: SECOND_PRODUCT,
        ...smuggled,
      });
      expect(result).toEqual({ result: 'UPDATED' });
      const row = await readRow(PIECE);
      expect(row).toMatchObject({
        product_id: PRODUCT,
        organization_id: ORG,
        image_keys: [],
        merged_into_id: null,
        deleted_at: null,
        price: 5500n,
      });
      expect(row?.price_updated_at.getUTCFullYear()).not.toBe(2020);
      expect(row?.price_updated_at.getTime()).toBeGreaterThanOrEqual(
        before!.price_updated_at.getTime()
      );
      expect(row?.server_updated_at.getUTCFullYear()).not.toBe(2020);
    });

    it('writes none of them on a creation', async () => {
      const result = await apply({ ...base, id: NEW_VARIANT, unit: 'boîte', ...smuggled });
      expect(result).toEqual({ result: 'CREATED' });
      const row = await readRow(NEW_VARIANT);
      expect(row).toMatchObject({
        product_id: PRODUCT,
        organization_id: ORG,
        image_keys: [],
        merged_into_id: null,
        deleted_at: null,
      });
      expect(row?.price_updated_at.getUTCFullYear()).not.toBe(2020);
    });

    it('keeps the photos of an existing variant', async () => {
      await prisma.$executeRaw`
        UPDATE product_variants SET image_keys = ARRAY[${KEY}]::text[] WHERE id = ${PIECE}::uuid`;
      await apply({ ...base, name: 'Rouge / L', price: 6000, image_keys: [], imageKeys: [] });
      expect((await readRow(PIECE))?.image_keys).toEqual([KEY]);
    });
  });

  describe('other product (AB-1, CWE-639)', () => {
    it('stores nothing for a variant slipped into a product of another business', async () => {
      const count = await countRows();
      const result = await apply({ ...base, id: NEW_VARIANT, productId: OTHER_PRODUCT });
      expect(result).toEqual({ result: 'NO_PRODUCT' });
      expect(await countRows()).toBe(count);
      const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM product_variants WHERE product_id = ${OTHER_PRODUCT}::uuid`;
      expect(n).toBe(1);
    });

    it('does not move a variant of the organization into a product of another business', async () => {
      await apply({ ...base, productId: OTHER_PRODUCT, price: 5100 });
      expect((await readRow(PIECE))?.product_id).toBe(PRODUCT);
    });
  });
});
