import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { applyVariantFromSync } from '../../../src/modules/catalog/catalog.sync-writers';

const ORG = '0199c035-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c035-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c035-0000-7000-8000-0000000000b1';
const SECOND_PRODUCT = '0199c035-0000-7000-8000-0000000000b2';
const OTHER_PRODUCT = '0199c035-0000-7000-8000-0000000000b3';
const FIRST = '0199c035-0000-7000-8000-0000000000c1';
const OTHER_VARIANT = '0199c035-0000-7000-8000-0000000000c3';
const DELETED_VARIANT = '0199c035-0000-7000-8000-0000000000c4';
const DUPLICATE = '0199c035-0000-7000-8000-0000000000d1';
const SECOND_DUPLICATE = '0199c035-0000-7000-8000-0000000000d2';
const OTHER = '0199c035-0000-7000-8000-0000000000c5';

type Row = {
  organization_id: string;
  product_id: string;
  name: string | null;
  unit: string;
  price: bigint;
  status: string;
  merged_into_id: string | null;
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
    SELECT organization_id, product_id, name, unit, price, status::text AS status,
           merged_into_id, deleted_at
    FROM product_variants WHERE id = ${id}::uuid`;
  return rows[0];
}

async function countRowsOf(id: string): Promise<number> {
  const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM product_variants WHERE id = ${id}::uuid`;
  return n;
}

function apply(input: Record<string, unknown>) {
  return prisma.$transaction((tx) =>
    applyVariantFromSync(tx, ORG, input as Parameters<typeof applyVariantFromSync>[2], new Date())
  );
}

const duplicate = {
  id: DUPLICATE,
  productId: PRODUCT,
  name: '',
  unit: 'sac 10 kg ',
  price: 2500,
  minOrderQuantity: null,
  status: 'ACTIVE',
};

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${ORG}::uuid, 'Fixture Business'), (${OTHER_ORG}::uuid, 'Other Business')
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price)
    VALUES (${PRODUCT}::uuid, ${ORG}::uuid, 'Farine', '', 1),
           (${SECOND_PRODUCT}::uuid, ${ORG}::uuid, 'Riz', '', 1),
           (${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, 'Huile', '', 1)
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, status)
    VALUES (${FIRST}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, NULL, 'Sac 10 kg', 3000, 'INACTIVE'),
           (${OTHER_VARIANT}::uuid, ${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, NULL, 'litre', 900, 'ACTIVE')
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, deleted_at)
    VALUES (${DELETED_VARIANT}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Vieux', 'carton', 100, now())
  `;
});

afterAll(cleanUp);

describe('merge of a duplicate variant (CAT-035)', () => {
  it('folds an unknown id with a live twin into it (AC-1, C-47)', async () => {
    const result = await apply(duplicate);
    expect(result).toEqual({
      result: 'MERGED',
      mergedInto: FIRST,
      label: 'Farine — Sac 10 kg',
    });
    expect(await readRow(DUPLICATE)).toMatchObject({
      organization_id: ORG,
      product_id: PRODUCT,
      merged_into_id: FIRST,
    });
    expect((await readRow(DUPLICATE))?.deleted_at).toBeInstanceOf(Date);
  });

  it('gives the label of a named twin', async () => {
    await prisma.$executeRaw`
      UPDATE product_variants SET name = 'Grand' WHERE id = ${FIRST}::uuid`;
    const result = await apply({ ...duplicate, name: ' GRAND ' });
    expect(result).toEqual({
      result: 'MERGED',
      mergedInto: FIRST,
      label: 'Farine — Grand (Sac 10 kg)',
    });
  });

  it('leaves the first with its price and status (AC-2)', async () => {
    await apply({ ...duplicate, price: 2500, status: 'ACTIVE' });
    expect(await readRow(FIRST)).toMatchObject({
      price: 3000n,
      status: 'INACTIVE',
      deleted_at: null,
      merged_into_id: null,
    });
  });

  it('answers MERGED again for the same id with one stored row (AC-3, C-36)', async () => {
    const first = await apply(duplicate);
    const again = await apply({ ...duplicate, price: 9999 });
    expect(again).toEqual(first);
    expect(await countRowsOf(DUPLICATE)).toBe(1);
    expect(await readRow(DUPLICATE)).toMatchObject({ price: 2500n, merged_into_id: FIRST });
  });

  it('answers FOREIGN for a merged id that belongs to another business', async () => {
    const foreign = await prisma.$transaction((tx) =>
      applyVariantFromSync(
        tx,
        OTHER_ORG,
        { ...duplicate, productId: OTHER_PRODUCT } as Parameters<typeof applyVariantFromSync>[2],
        new Date()
      )
    );
    expect(foreign.result).toBe('CREATED');
    expect(await apply({ ...duplicate, productId: PRODUCT })).toEqual({ result: 'FOREIGN' });
  });

  it.each([
    [
      'a live variant of another product',
      { id: OTHER, productId: SECOND_PRODUCT, unit: 'Sac 10 kg' },
    ],
    ['a deleted variant of the same product', { id: OTHER, name: 'vieux', unit: 'CARTON' }],
  ])('creates the variant for the text of %s (AC-4)', async (_label, patch) => {
    const result = await apply({ ...duplicate, ...patch });
    expect(result).toEqual({ result: 'CREATED' });
    expect(await readRow(OTHER)).toMatchObject({ merged_into_id: null, deleted_at: null });
  });

  it('keeps COLLISION for an edit that would make a twin (AC-5)', async () => {
    await apply({ ...duplicate, id: OTHER, unit: 'sac 5 kg' });
    const before = await readRow(OTHER);
    const result = await apply({ ...duplicate, id: OTHER, unit: 'SAC  10 KG' });
    expect(result).toEqual({ result: 'COLLISION' });
    expect(await readRow(OTHER)).toEqual(before);
  });
});

describe('abuse cases', () => {
  it('lets two phones add the same variant: CREATED then MERGED (AB-1, CWE-400)', async () => {
    const results = await Promise.all([
      apply({ ...duplicate, id: DUPLICATE, unit: 'Lot' }),
      apply({ ...duplicate, id: SECOND_DUPLICATE, unit: ' LOT ' }),
    ]);
    expect(results.map((r) => r.result).sort()).toEqual(['CREATED', 'MERGED']);
    const merged = results.find((r) => r.result === 'MERGED');
    const createdId = results[0]?.result === 'CREATED' ? DUPLICATE : SECOND_DUPLICATE;
    expect(merged?.mergedInto).toBe(createdId);
  });

  it('ignores a merge link of another business and points to the live twin (AB-2, CWE-915)', async () => {
    const result = await apply({
      ...duplicate,
      merged_into_id: OTHER_VARIANT,
      mergedIntoId: OTHER_VARIANT,
      mergedInto: OTHER_VARIANT,
    });
    expect(result).toMatchObject({ result: 'MERGED', mergedInto: FIRST });
    expect((await readRow(DUPLICATE))?.merged_into_id).toBe(FIRST);
  });

  it('never links to a twin of another business through a forged product', async () => {
    const result = await apply({ ...duplicate, productId: OTHER_PRODUCT, unit: 'litre' });
    expect(result).toEqual({ result: 'NO_PRODUCT' });
    expect(await readRow(DUPLICATE)).toBeUndefined();
  });
});
