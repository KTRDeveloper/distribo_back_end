import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { resolveVariantForLine } from '../../../src/modules/catalog/catalog.sync-writers';

const ORG = '0199c037-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c037-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c037-0000-7000-8000-0000000000b1';
const DELETED_PRODUCT = '0199c037-0000-7000-8000-0000000000b2';
const OTHER_PRODUCT = '0199c037-0000-7000-8000-0000000000b3';
const LIVE = '0199c037-0000-7000-8000-0000000000c1';
const MERGED = '0199c037-0000-7000-8000-0000000000c2';
const GONE = '0199c037-0000-7000-8000-0000000000c3';
const GONE_OF_DELETED_PRODUCT = '0199c037-0000-7000-8000-0000000000c4';
const TWIN_GONE = '0199c037-0000-7000-8000-0000000000c5';
const BROKEN_TARGET = '0199c037-0000-7000-8000-0000000000c6';
const BROKEN_MERGED = '0199c037-0000-7000-8000-0000000000c7';
const FOREIGN_GONE = '0199c037-0000-7000-8000-0000000000c8';
const FOREIGN_LIVE = '0199c037-0000-7000-8000-0000000000c9';
const UNKNOWN = '0199c037-0000-7000-8000-0000000000ff';
const CHAIN = [1, 2, 3, 4, 5, 6, 7].map(
  (n) => `0199c037-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`
);

type Row = {
  status: string;
  deleted_at: Date | null;
  merged_into_id: string | null;
  server_updated_at: Date;
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

async function readVariant(id: string): Promise<Row> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT status::text AS status, deleted_at, merged_into_id, server_updated_at
    FROM product_variants WHERE id = ${id}::uuid`;
  return rows[0];
}

async function readProduct(id: string) {
  const rows = await prisma.$queryRaw<Array<{ deleted_at: Date | null; server_updated_at: Date }>>`
    SELECT deleted_at, server_updated_at FROM products WHERE id = ${id}::uuid`;
  return rows[0];
}

function resolve(id: string, organizationId = ORG) {
  return prisma.$transaction((tx) => resolveVariantForLine(tx, organizationId, id, new Date()));
}

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${ORG}::uuid, 'Fixture Business'), (${OTHER_ORG}::uuid, 'Other Business')
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price)
    VALUES (${PRODUCT}::uuid, ${ORG}::uuid, 'Farine', '', 1),
           (${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, 'Huile', '', 1)
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price, deleted_at)
    VALUES (${DELETED_PRODUCT}::uuid, ${ORG}::uuid, 'Riz', '', 1, now())
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, status)
    VALUES (${LIVE}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, NULL, 'Sac 10 kg', 3000, 'ACTIVE'),
           (${FOREIGN_LIVE}::uuid, ${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, NULL, 'litre', 900, 'ACTIVE')
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, status, deleted_at)
    VALUES (${GONE}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Fine', 'carton', 500, 'ACTIVE', now()),
           (${GONE_OF_DELETED_PRODUCT}::uuid, ${DELETED_PRODUCT}::uuid, ${ORG}::uuid, NULL, 'sac', 700, 'ACTIVE', now()),
           (${TWIN_GONE}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, NULL, ' SAC  10 KG', 100, 'ACTIVE', now()),
           (${BROKEN_TARGET}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Cassé', 'boite', 100, 'ACTIVE', now()),
           (${FOREIGN_GONE}::uuid, ${OTHER_PRODUCT}::uuid, ${OTHER_ORG}::uuid, NULL, 'bidon', 100, 'ACTIVE', now())
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, status, deleted_at, merged_into_id)
    VALUES (${MERGED}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, NULL, 'sac 10 kg', 100, 'ACTIVE', now(), ${LIVE}::uuid),
           (${BROKEN_MERGED}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Cassé 2', 'boite', 100, 'ACTIVE', now(), ${BROKEN_TARGET}::uuid)
  `;
});

afterAll(cleanUp);

describe('resolution of the variant of a line (CAT-037)', () => {
  it('answers a live variant with itself and writes nothing (AC-1)', async () => {
    const before = await readVariant(LIVE);
    expect(await resolve(LIVE)).toEqual({
      variantId: LIVE,
      productId: PRODUCT,
      label: 'Farine — Sac 10 kg',
      restored: false,
      redirectedFrom: null,
    });
    expect(await readVariant(LIVE)).toEqual(before);
  });

  it('answers the live variant a merged duplicate points to (AC-2, C-47)', async () => {
    expect(await resolve(MERGED)).toEqual({
      variantId: LIVE,
      productId: PRODUCT,
      label: 'Farine — Sac 10 kg',
      restored: false,
      redirectedFrom: MERGED,
    });
    expect((await readVariant(MERGED)).deleted_at).toBeInstanceOf(Date);
  });

  it('brings back a deleted variant off sale, with its deleted product (AC-3, C-48)', async () => {
    const before = await readVariant(GONE_OF_DELETED_PRODUCT);
    const productBefore = await readProduct(DELETED_PRODUCT);
    expect(await resolve(GONE_OF_DELETED_PRODUCT)).toEqual({
      variantId: GONE_OF_DELETED_PRODUCT,
      productId: DELETED_PRODUCT,
      label: 'Riz — sac',
      restored: true,
      redirectedFrom: null,
    });
    const after = await readVariant(GONE_OF_DELETED_PRODUCT);
    expect(after).toMatchObject({ status: 'INACTIVE', deleted_at: null, merged_into_id: null });
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
    const productAfter = await readProduct(DELETED_PRODUCT);
    expect(productAfter.deleted_at).toBeNull();
    expect(productAfter.server_updated_at.getTime()).toBeGreaterThan(
      productBefore.server_updated_at.getTime()
    );
  });

  it('never counts a brought-back variant as a product on sale (C-46)', async () => {
    await resolve(GONE);
    const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM product_variants
      WHERE id = ${GONE}::uuid AND status = 'ACTIVE' AND deleted_at IS NULL`;
    expect(n).toBe(0);
  });

  it('answers the live twin that took its place and restores nothing (AC-4, C-47)', async () => {
    expect(await resolve(TWIN_GONE)).toEqual({
      variantId: LIVE,
      productId: PRODUCT,
      label: 'Farine — Sac 10 kg',
      restored: false,
      redirectedFrom: TWIN_GONE,
    });
    expect((await readVariant(TWIN_GONE)).deleted_at).toBeInstanceOf(Date);
    expect((await readVariant(LIVE)).status).toBe('ACTIVE');
  });

  it.each([
    ['unknown', UNKNOWN],
    ['a variant of another organization', FOREIGN_LIVE],
  ])('answers null for %s and writes nothing (AC-5)', async (_name, id) => {
    const before = await readVariant(LIVE);
    expect(await resolve(id)).toBeNull();
    expect(await readVariant(LIVE)).toEqual(before);
  });

  it('brings back the end of a broken chain and answers it (AC-6, C-36)', async () => {
    expect(await resolve(BROKEN_MERGED)).toEqual({
      variantId: BROKEN_TARGET,
      productId: PRODUCT,
      label: 'Farine — Cassé (boite)',
      restored: true,
      redirectedFrom: BROKEN_MERGED,
    });
    expect(await readVariant(BROKEN_TARGET)).toMatchObject({
      status: 'INACTIVE',
      deleted_at: null,
    });
    expect((await readVariant(BROKEN_MERGED)).deleted_at).toBeInstanceOf(Date);
  });

  it('keeps a deleted variant of another business deleted and answers null (AB-1)', async () => {
    const before = await readVariant(FOREIGN_GONE);
    expect(await resolve(FOREIGN_GONE)).toBeNull();
    expect(await readVariant(FOREIGN_GONE)).toEqual(before);
    expect((await readProduct(OTHER_PRODUCT)).deleted_at).toBeNull();
  });

  it('follows a chain of links and stops after 5 (C-36)', async () => {
    // CHAIN[0] -> CHAIN[1] -> ... -> CHAIN[6]; the last is live, 6 links away from the first.
    await prisma.$executeRaw`
      INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, status)
      VALUES (${CHAIN[6]}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Fin', 'kg', 100, 'ACTIVE')`;
    for (let i = 5; i >= 0; i--) {
      await prisma.$executeRaw`
        INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, status, deleted_at, merged_into_id)
        VALUES (${CHAIN[i]}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, ${`Maillon ${i}`}, 'kg', 100, 'ACTIVE', now(), ${CHAIN[i + 1]}::uuid)`;
    }
    // From the second one the live end is 5 links away: followed.
    expect(await resolve(CHAIN[1])).toMatchObject({
      variantId: CHAIN[6],
      restored: false,
      redirectedFrom: CHAIN[1],
    });
    // From the first one it is 6 links away: the fifth link's target is treated as deleted
    // without a link and brought back off sale.
    const answer = await resolve(CHAIN[0]);
    expect(answer).toMatchObject({
      variantId: CHAIN[5],
      restored: true,
      redirectedFrom: CHAIN[0],
    });
    expect(await readVariant(CHAIN[5])).toMatchObject({
      status: 'INACTIVE',
      deleted_at: null,
      merged_into_id: null,
    });
  });
});
