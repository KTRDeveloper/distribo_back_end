import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { SYNC_TABLES } from '../../../src/modules/sync/sync.types.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const OWNER = '0199e024-0000-7000-8000-000000000001';
const SELLER = '0199e024-0000-7000-8000-000000000002';
const DRIVER = '0199e024-0000-7000-8000-000000000003';
const OWNER_B = '0199e024-0000-7000-8000-000000000006';
const ORG_A = '0199e024-0000-7000-8000-0000000000a1';
const ORG_B = '0199e024-0000-7000-8000-0000000000b1';
const P_RICE = '0199e024-0000-7000-8000-0000000000d1';
const P_PAUSED = '0199e024-0000-7000-8000-0000000000d2';
const P_B = '0199e024-0000-7000-8000-0000000000d5';
const V_SMALL = '0199e024-0000-7000-8000-0000000000e1';
const V_BIG = '0199e024-0000-7000-8000-0000000000e2';
const V_PAUSED = '0199e024-0000-7000-8000-0000000000e3';
const V_B = '0199e024-0000-7000-8000-0000000000e5';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const PHOTO = 'products/0b2f6c1e-3d4a-4b5c-8d6e-7f8091a2b3c4.webp';

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/pull${query}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const productsOf = (body: PullBody) => body.changes['products'];
const variantsOf = (body: PullBody) => body.changes['product_variants'];
const idsOf = (rows: Rows) => rows.map((r) => r['id']).sort();

async function seedPerson(id: string, phone: string, name: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: name,
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${name.toLowerCase().replace(/\W/g, '')}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
}

async function seedCollaboration(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e024-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

/** A new-style product: no unit and no price of its own, its variants are created apart. */
async function seedProduct(id: string, org: string, name: string, pausedAt: Date | null = null) {
  await prisma.product.create({
    data: {
      id,
      organizationId: org,
      name,
      description: 'Riz long grain',
      category: 'Céréales',
      imageKeys: [PHOTO],
      pausedAt,
      createdAt: LONG_AGO,
    },
  });
  await prisma.$executeRaw`UPDATE products SET server_updated_at = ${LONG_AGO} WHERE id = ${id}::uuid`;
}

async function seedVariant(
  id: string,
  productId: string,
  org: string,
  name: string,
  price: bigint,
  status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE'
) {
  await prisma.productVariant.create({
    data: {
      id,
      productId,
      organizationId: org,
      name,
      unit: 'sac',
      price,
      minOrderQuantity: '2.500',
      imageKeys: [PHOTO],
      status,
      createdAt: LONG_AGO,
    },
  });
  // The variant trigger moved the product too (CM-42); both go back to a fixed past.
  await prisma.$executeRaw`UPDATE product_variants SET server_updated_at = ${LONG_AGO} WHERE id = ${id}::uuid`;
  await prisma.$executeRaw`UPDATE products SET server_updated_at = ${LONG_AGO} WHERE id = ${productId}::uuid`;
}

describe('GET /api/v1/sync/pull (products and variants)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600002401', 'Owner A');
    await seedPerson(SELLER, '+237600002402', 'Seller A');
    await seedPerson(DRIVER, '+237600002403', 'Driver A');
    await seedPerson(OWNER_B, '+237600002406', 'Owner B');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedCollaboration('01', OWNER, ORG_A, 'OWNER');
    await seedCollaboration('02', SELLER, ORG_A, 'SELLER');
    await seedCollaboration('03', DRIVER, ORG_A, 'DRIVER');
    await seedCollaboration('06', OWNER_B, ORG_B, 'OWNER');

    await seedProduct(P_RICE, ORG_A, 'Riz');
    await seedProduct(P_PAUSED, ORG_A, 'Huile', new Date('2026-02-01T00:00:00.000Z'));
    await seedProduct(P_B, ORG_B, 'Produit de B');
    await seedVariant(V_SMALL, P_RICE, ORG_A, 'sac 10 kg', 15000n);
    await seedVariant(V_BIG, P_RICE, ORG_A, 'sac 25 kg', 32000n, 'INACTIVE');
    await seedVariant(V_PAUSED, P_PAUSED, ORG_A, 'bidon', 9000n);
    await seedVariant(V_B, P_B, ORG_B, 'sac B', 1000n);
  });

  it('team rows: the product has no price, its variants carry it (AC-1)', async () => {
    const res = await pull(SELLER);
    expect(res.status).toBe(200);
    const body = bodyOf<PullBody>(res);
    const rice = productsOf(body).created.find((r) => r['id'] === P_RICE)!;
    expect(Object.keys(rice).sort()).toEqual(
      [
        'id',
        'organization_id',
        'name',
        'description',
        'category',
        'image_urls',
        'paused_at',
        'created_at',
        'server_updated_at',
      ].sort()
    );
    expect(rice).toMatchObject({
      name: 'Riz',
      description: 'Riz long grain',
      category: 'Céréales',
      image_urls: [`http://localhost:3000/images/${PHOTO}`],
      paused_at: null,
    });

    const variants = variantsOf(body).created;
    expect(idsOf(variants.filter((r) => r['product_id'] === P_RICE))).toEqual(
      [V_SMALL, V_BIG].sort()
    );
    const small = variants.find((r) => r['id'] === V_SMALL)!;
    expect(Object.keys(small).sort()).toEqual(
      [
        'id',
        'product_id',
        'organization_id',
        'name',
        'unit',
        'price',
        'price_updated_at',
        'min_order_quantity',
        'status',
        'image_urls',
        'created_at',
        'server_updated_at',
      ].sort()
    );
    expect(small).toMatchObject({
      product_id: P_RICE,
      organization_id: ORG_A,
      name: 'sac 10 kg',
      unit: 'sac',
      price: 15000,
      min_order_quantity: '2.5',
      status: 'ACTIVE',
      image_urls: [`http://localhost:3000/images/${PHOTO}`],
    });
    expect(variants.find((r) => r['id'] === V_BIG)).toMatchObject({
      status: 'INACTIVE',
      price: 32000,
    });
    expect(JSON.stringify(res.body)).not.toContain(`"${PHOTO}"`);
  });

  it('paused: a paused product arrives with paused_at, with its variants (AC-2)', async () => {
    const body = bodyOf<PullBody>(await pull(SELLER));
    const paused = productsOf(body).created.find((r) => r['id'] === P_PAUSED)!;
    expect(paused['paused_at']).toBe(new Date('2026-02-01T00:00:00.000Z').getTime());
    expect(variantsOf(body).created.map((r) => r['id'])).toContain(V_PAUSED);
  });

  it('price change: the variant and its product are both updated (AC-3, CM-42)', async () => {
    await sleep(15);
    const since = Date.now();
    await sleep(15);
    await prisma.productVariant.update({ where: { id: V_SMALL }, data: { price: 17000n } });
    const body = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${since}`));
    expect(variantsOf(body).created).toEqual([]);
    expect(variantsOf(body).updated).toHaveLength(1);
    expect(variantsOf(body).updated[0]).toMatchObject({ id: V_SMALL, price: 17000 });
    expect(productsOf(body).created).toEqual([]);
    expect(idsOf(productsOf(body).updated)).toEqual([P_RICE]);
  });

  it('deletion: a deleted or merged variant is listed in deleted (AC-4, C-35)', async () => {
    await sleep(15);
    const since = Date.now();
    await sleep(15);
    await prisma.productVariant.update({
      where: { id: V_BIG },
      data: { deletedAt: new Date(), mergedIntoId: V_SMALL },
    });
    await prisma.productVariant.update({
      where: { id: V_PAUSED },
      data: { deletedAt: new Date() },
    });
    const body = bodyOf<PullBody>(await pull(OWNER, `?last_pulled_at=${since}`));
    expect([...variantsOf(body).deleted].sort()).toEqual([V_BIG, V_PAUSED].sort());
    expect(variantsOf(body).created).toEqual([]);
    expect(variantsOf(body).updated).toEqual([]);
  });

  it('a deleted variant is absent from a full pull (C-35)', async () => {
    await prisma.productVariant.update({ where: { id: V_BIG }, data: { deletedAt: new Date() } });
    const body = bodyOf<PullBody>(await pull(OWNER));
    expect(variantsOf(body).created.map((r) => r['id'])).not.toContain(V_BIG);
    expect(variantsOf(body).deleted).toEqual([]);
  });

  it('new table: the answer has a product_variants entry and 15 tables exist (AC-5)', async () => {
    expect(SYNC_TABLES).toHaveLength(15);
    expect(SYNC_TABLES).toContain('product_variants');
    const body = bodyOf<PullBody>(await pull(SELLER));
    expect(variantsOf(body).created.length).toBeGreaterThan(0);
    expect(variantsOf(body).updated).toEqual([]);
    expect(variantsOf(body).deleted).toEqual([]);
  });

  it('other business: nothing of B reaches a member of A (AB-1, WSTG-ATHZ-04)', async () => {
    const a = bodyOf<PullBody>(await pull(OWNER));
    expect(JSON.stringify(a)).not.toContain(P_B);
    expect(JSON.stringify(a)).not.toContain(V_B);
    const b = bodyOf<PullBody>(await pull(OWNER_B));
    expect(idsOf(variantsOf(b).created)).toEqual([V_B]);
  });

  it('driver: receives no variant row (ASVS v5.0.0-15.3.1)', async () => {
    const body = bodyOf<PullBody>(await pull(DRIVER));
    expect(variantsOf(body)).toEqual({ created: [], updated: [], deleted: [] });
  });
});
