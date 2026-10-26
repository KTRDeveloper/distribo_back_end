import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { releaseDeletedImageKeys } from '../../../src/modules/catalog/catalog.repository';

const ORG = '0199c046-0000-7000-8000-0000000000a1';
const P_OLD = '0199c046-0000-7000-8000-0000000000b1';
const P_LIVE = '0199c046-0000-7000-8000-0000000000b2';
const P_RECENT = '0199c046-0000-7000-8000-0000000000b3';
const V_OLD = '0199c046-0000-7000-8000-0000000000c1';
const V_LIVE = '0199c046-0000-7000-8000-0000000000c2';
const P_EXTRA_1 = '0199c046-0000-7000-8000-0000000000b4';
const P_EXTRA_2 = '0199c046-0000-7000-8000-0000000000b5';
const P_EXTRA_3 = '0199c046-0000-7000-8000-0000000000b6';

const KEY_A = 'products/0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_B = 'products/1b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_C = 'products/2b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_D = 'products/3b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_E = 'products/4b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_F = 'products/5b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';
const KEY_H = 'products/7b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function cleanUp() {
  await prisma.$executeRaw`DELETE FROM product_variants WHERE organization_id = ${ORG}::uuid`;
  await prisma.$executeRaw`DELETE FROM products WHERE organization_id = ${ORG}::uuid`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG}::uuid`;
}

async function insertProduct(id: string, keys: string[], deletedAt: Date | null) {
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, image_keys, deleted_at)
    VALUES (${id}::uuid, ${ORG}::uuid, 'Fixture Shirt', ${keys}::text[], ${deletedAt})
  `;
}

async function insertVariant(id: string, keys: string[], deletedAt: Date | null, name: string) {
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, image_keys, deleted_at)
    VALUES (${id}::uuid, ${P_LIVE}::uuid, ${ORG}::uuid, ${name}, 'piece', 3000, ${keys}::text[], ${deletedAt})
  `;
}

async function keysOf(table: 'products' | 'product_variants', id: string): Promise<string[]> {
  const rows =
    table === 'products'
      ? await prisma.$queryRaw<Array<{ image_keys: string[] }>>`
          SELECT image_keys FROM products WHERE id = ${id}::uuid`
      : await prisma.$queryRaw<Array<{ image_keys: string[] }>>`
          SELECT image_keys FROM product_variants WHERE id = ${id}::uuid`;
  return rows[0].image_keys;
}

const release = (before: Date, limit: number) =>
  prisma.$transaction((tx) => releaseDeletedImageKeys(tx, before, limit));

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG}::uuid, 'Fixture Business')
  `;
  await insertProduct(P_LIVE, [KEY_D], null);
});

afterAll(cleanUp);

describe('releaseDeletedImageKeys', () => {
  it('released', async () => {
    await insertProduct(P_OLD, [KEY_A, KEY_B], hoursAgo(30));
    await insertVariant(V_OLD, [KEY_C], hoursAgo(25), 'Rouge / L');

    const released = await release(hoursAgo(24), 100);

    expect([...released].sort()).toEqual([KEY_A, KEY_B, KEY_C]);
    expect(await keysOf('products', P_OLD)).toEqual([]);
    expect(await keysOf('product_variants', V_OLD)).toEqual([]);
  });

  it('kept', async () => {
    await insertProduct(P_RECENT, [KEY_E], hoursAgo(2));
    await insertVariant(V_LIVE, [KEY_F], null, 'Bleu / M');

    const released = await release(hoursAgo(24), 100);

    expect(released).toEqual([]);
    expect(await keysOf('products', P_LIVE)).toEqual([KEY_D]);
    expect(await keysOf('products', P_RECENT)).toEqual([KEY_E]);
    expect(await keysOf('product_variants', V_LIVE)).toEqual([KEY_F]);
  });

  it('limit', async () => {
    await insertProduct(P_EXTRA_1, [KEY_A], hoursAgo(50));
    await insertProduct(P_EXTRA_2, [KEY_B], hoursAgo(40));
    await insertProduct(P_EXTRA_3, [KEY_C], hoursAgo(30));

    const released = await release(hoursAgo(24), 2);

    expect([...released].sort()).toEqual([KEY_A, KEY_B]);
    expect(await keysOf('products', P_EXTRA_1)).toEqual([]);
    expect(await keysOf('products', P_EXTRA_2)).toEqual([]);
    expect(await keysOf('products', P_EXTRA_3)).toEqual([KEY_C]);
  });

  it('limit applies to products and variants separately', async () => {
    await insertProduct(P_EXTRA_1, [KEY_A], hoursAgo(50));
    await insertProduct(P_EXTRA_2, [KEY_B], hoursAgo(40));
    await insertVariant(V_OLD, [KEY_C], hoursAgo(50), 'Rouge / L');
    await insertVariant(V_LIVE, [KEY_H], hoursAgo(40), 'Bleu / M');

    const released = await release(hoursAgo(24), 1);

    expect([...released].sort()).toEqual([KEY_A, KEY_C]);
    expect(await keysOf('products', P_EXTRA_2)).toEqual([KEY_B]);
    expect(await keysOf('product_variants', V_LIVE)).toEqual([KEY_H]);
  });

  it('repeat', async () => {
    await insertProduct(P_OLD, [KEY_A, KEY_B], hoursAgo(30));
    await insertVariant(V_OLD, [KEY_C], hoursAgo(25), 'Rouge / L');

    expect(await release(hoursAgo(24), 100)).toHaveLength(3);
    expect(await release(hoursAgo(24), 100)).toEqual([]);
  });
});

describe('live cards', () => {
  it('keep their keys whatever the date', async () => {
    await insertVariant(V_LIVE, [KEY_F], null, 'Bleu / M');

    const released = await release(new Date(Date.now() + 365 * 24 * 3_600_000), 100);

    expect(released).toEqual([]);
    expect(await keysOf('products', P_LIVE)).toEqual([KEY_D]);
    expect(await keysOf('product_variants', V_LIVE)).toEqual([KEY_F]);
  });
});
