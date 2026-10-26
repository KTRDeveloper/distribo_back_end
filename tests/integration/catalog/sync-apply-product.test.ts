import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { applyProductFromSync } from '../../../src/modules/catalog/catalog.sync-writers';

const ORG = '0199c033-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c033-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c033-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c033-0000-7000-8000-0000000000b2';
const DELETED_PRODUCT = '0199c033-0000-7000-8000-0000000000b3';
const NEW_PRODUCT = '0199c033-0000-7000-8000-0000000000b4';
const KEY = 'products/0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';

type Row = {
  organization_id: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  price: bigint;
  paused_at: Date | null;
  image_keys: string[];
  server_updated_at: Date;
  deleted_at: Date | null;
};

async function cleanUp() {
  await prisma.$executeRaw`
    DELETE FROM products WHERE organization_id IN (${ORG}::uuid, ${OTHER_ORG}::uuid)
  `;
  await prisma.$executeRaw`
    DELETE FROM organizations WHERE id IN (${ORG}::uuid, ${OTHER_ORG}::uuid)
  `;
}

async function readRow(id: string): Promise<Row | undefined> {
  const rows = await prisma.$queryRaw<Row[]>`SELECT * FROM products WHERE id = ${id}::uuid`;
  return rows[0];
}

function apply(input: Record<string, unknown>) {
  return prisma.$transaction((tx) =>
    applyProductFromSync(
      tx,
      ORG,
      input as Parameters<typeof applyProductFromSync>[2],
      new Date()
    )
  );
}

const base = { id: PRODUCT, name: 'Riz', description: null, category: null };

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${ORG}::uuid, 'Fixture Business'), (${OTHER_ORG}::uuid, 'Other Business')
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, description, category)
    VALUES (${PRODUCT}::uuid, ${ORG}::uuid, 'Riz', 'Sac de 25 kg', 'Céréales'),
           (${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, 'Huile', 'Bidon', NULL)
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, deleted_at)
    VALUES (${DELETED_PRODUCT}::uuid, ${ORG}::uuid, 'Vieux', now())
  `;
});

afterAll(cleanUp);

describe('applyProductFromSync', () => {
  it('creates an unknown product new-style', async () => {
    const result = await apply({
      id: NEW_PRODUCT,
      name: 'Riz parfumé',
      description: 'Long grain',
      category: 'Céréales',
    });
    expect(result).toEqual({ result: 'CREATED' });
    const row = await readRow(NEW_PRODUCT);
    expect(row).toMatchObject({
      organization_id: ORG,
      name: 'Riz parfumé',
      description: 'Long grain',
      category: 'Céréales',
      paused_at: null,
      image_keys: [],
      deleted_at: null,
    });
    const [{ near }] = await prisma.$queryRaw<Array<{ near: boolean }>>`
      SELECT abs(extract(epoch FROM (now() - server_updated_at))) < 30 AS near
      FROM products WHERE id = ${NEW_PRODUCT}::uuid
    `;
    expect(near).toBe(true);
  });

  it('rewrites the three text fields of an edited product', async () => {
    const result = await apply({ ...base, name: 'Riz parfumé' });
    expect(result).toEqual({ result: 'UPDATED' });
    expect(await readRow(PRODUCT)).toMatchObject({
      name: 'Riz parfumé',
      description: null,
      category: null,
    });
  });

  it('answers UNCHANGED and keeps the date when the same input comes twice', async () => {
    expect((await apply({ ...base, name: 'Riz parfumé' })).result).toBe('UPDATED');
    const first = await readRow(PRODUCT);
    const second = await apply({ ...base, name: 'Riz parfumé' });
    expect(second).toEqual({ result: 'UNCHANGED' });
    const after = await readRow(PRODUCT);
    expect(after?.server_updated_at.getTime()).toBe(first?.server_updated_at.getTime());
  });

  it('writes nothing for a product of another organization', async () => {
    const before = await readRow(OTHER_PRODUCT);
    const result = await apply({ ...base, id: OTHER_PRODUCT, name: 'Volé' });
    expect(result).toEqual({ result: 'FOREIGN' });
    expect(await readRow(OTHER_PRODUCT)).toEqual(before);
  });

  it('writes nothing for a deleted product', async () => {
    const before = await readRow(DELETED_PRODUCT);
    const result = await apply({ ...base, id: DELETED_PRODUCT, name: 'Revenu' });
    expect(result).toEqual({ result: 'GONE' });
    expect(await readRow(DELETED_PRODUCT)).toEqual(before);
  });

  it.each([
    ['an empty name', { name: '' }, 'name'],
    ['a name of 101 characters', { name: 'a'.repeat(101) }, 'name'],
    ['a description of 2001 characters', { description: 'd'.repeat(2001) }, 'description'],
    ['a category of 101 characters', { category: 'c'.repeat(101) }, 'category'],
  ])('refuses %s and writes nothing', async (_label, patch, field) => {
    const before = await readRow(PRODUCT);
    const result = await apply({ ...base, ...patch });
    expect(result).toEqual({ result: 'INVALID', invalidFields: [field] });
    expect(await readRow(PRODUCT)).toEqual(before);
  });

  it('refuses an invalid new product without creating it', async () => {
    const result = await apply({ ...base, id: NEW_PRODUCT, name: '' });
    expect(result).toEqual({ result: 'INVALID', invalidFields: ['name'] });
    expect(await readRow(NEW_PRODUCT)).toBeUndefined();
  });

  it('accepts texts at the limits', async () => {
    const result = await apply({
      ...base,
      name: 'a'.repeat(100),
      description: 'd'.repeat(2000),
      category: 'c'.repeat(100),
    });
    expect(result).toEqual({ result: 'UPDATED' });
  });

  it('reports every invalid field name and no value', async () => {
    const result = await apply({ ...base, name: '', description: 'd'.repeat(2001) });
    expect(result).toEqual({ result: 'INVALID', invalidFields: ['name', 'description'] });
  });

  it('never writes the server fields carried by the input', async () => {
    const result = await apply({
      ...base,
      name: 'Riz parfumé',
      description: 'Sac de 25 kg',
      category: 'Céréales',
      paused_at: new Date(),
      pausedAt: new Date(),
      image_keys: [KEY],
      imageKeys: [KEY],
      unit: 'kg',
      price: 9999n,
    });
    expect(result).toEqual({ result: 'UPDATED' });
    const row = await readRow(PRODUCT);
    expect(row).toMatchObject({
      paused_at: null,
      image_keys: [],
    });
  });

  it('does not set the server fields on a creation either', async () => {
    await apply({ ...base, id: NEW_PRODUCT, unit: 'kg', price: 9999n, imageKeys: [KEY] });
    expect(await readRow(NEW_PRODUCT)).toMatchObject({
      image_keys: [],
      paused_at: null,
    });
  });

  it('keeps a paused product paused when the input says it is not', async () => {
    await prisma.$executeRaw`UPDATE products SET paused_at = now() WHERE id = ${PRODUCT}::uuid`;
    const before = await readRow(PRODUCT);
    const result = await apply({ ...base, name: 'Riz parfumé', paused_at: null, pausedAt: null });
    expect(result).toEqual({ result: 'UPDATED' });
    const row = await readRow(PRODUCT);
    expect(row?.paused_at?.getTime()).toBe(before?.paused_at?.getTime());
  });
});
