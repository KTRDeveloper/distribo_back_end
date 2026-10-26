import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const OWNER_A = '0199e026-0000-7000-8000-000000000001';
const CUSTOMER = '0199e026-0000-7000-8000-000000000005';
const OWNER_B = '0199e026-0000-7000-8000-000000000006';
const SELLER_A = '0199e026-0000-7000-8000-000000000007';
const ORG_A = '0199e026-0000-7000-8000-0000000000a1';
const ORG_B = '0199e026-0000-7000-8000-0000000000b1';
const REL_A = '0199e026-0000-7000-8000-0000000000c1';
const P_RICE = '0199e026-0000-7000-8000-0000000000d1';
const P_PAUSED = '0199e026-0000-7000-8000-0000000000d2';
const P_WITHDRAWN = '0199e026-0000-7000-8000-0000000000d3';
const P_DELETED = '0199e026-0000-7000-8000-0000000000d4';
const P_B = '0199e026-0000-7000-8000-0000000000d5';
const V_SMALL = '0199e026-0000-7000-8000-0000000000e1';
const V_BIG = '0199e026-0000-7000-8000-0000000000e2';
const V_OLD = '0199e026-0000-7000-8000-0000000000e3';
const V_PAUSED = '0199e026-0000-7000-8000-0000000000e4';
const V_WITHDRAWN = '0199e026-0000-7000-8000-0000000000e5';
const V_DELETED = '0199e026-0000-7000-8000-0000000000e6';
const V_B = '0199e026-0000-7000-8000-0000000000e7';
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
const sent = (c: Changes) => [...c.created, ...c.updated];

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
      id: `0199e026-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

async function seedRelationship(id: string, org: string, personId: string) {
  await prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: org,
      customerPersonId: personId,
      customerLabel: 'Chez Mama',
      creditLimit: 0n,
      createdById: OWNER_A,
      createdAt: LONG_AGO,
    },
  });
  await prisma.$executeRaw`UPDATE customer_relationships SET server_updated_at = ${LONG_AGO} WHERE id = ${id}::uuid`;
}

/** A new-style product: its variants are created apart; every write goes back to a fixed past. */
async function seedProduct(
  id: string,
  org: string,
  name: string,
  extra: { pausedAt?: Date | null; deletedAt?: Date | null } = {}
) {
  await prisma.product.create({
    data: {
      id,
      organizationId: org,
      name,
      description: 'secret-description-' + name,
      category: 'Céréales',
      imageKeys: [PHOTO],
      pausedAt: extra.pausedAt ?? null,
      deletedAt: extra.deletedAt ?? null,
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
  extra: { status?: 'ACTIVE' | 'INACTIVE'; deletedAt?: Date | null } = {}
) {
  await prisma.productVariant.create({
    data: {
      id,
      productId,
      organizationId: org,
      name,
      unit: 'sac',
      price: 12500n,
      minOrderQuantity: '2.500',
      imageKeys: [PHOTO],
      status: extra.status ?? 'ACTIVE',
      deletedAt: extra.deletedAt ?? null,
      createdAt: LONG_AGO,
    },
  });
  // The variant trigger moved the product too (CM-42); both go back to a fixed past.
  await prisma.$executeRaw`UPDATE product_variants SET server_updated_at = ${LONG_AGO} WHERE id = ${id}::uuid`;
  await prisma.$executeRaw`UPDATE products SET server_updated_at = ${LONG_AGO} WHERE id = ${productId}::uuid`;
}

const CUSTOMER_PRODUCT_KEYS = [
  'category',
  'description',
  'id',
  'image_urls',
  'name',
  'organization_id',
];
const CUSTOMER_VARIANT_KEYS = [
  'id',
  'image_urls',
  'min_order_quantity',
  'name',
  'organization_id',
  'price',
  'product_id',
  'unit',
];

/** Waits, takes a pull cursor, waits again: what happens next is after the last pull. */
async function cursor(): Promise<number> {
  await sleep(15);
  const since = Date.now();
  await sleep(15);
  return since;
}

describe('GET /api/v1/sync/pull (customer catalog)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER_A, '+237600002601', 'Owner A');
    await seedPerson(CUSTOMER, '+237600002605', 'Customer');
    await seedPerson(OWNER_B, '+237600002606', 'Owner B');
    await seedPerson(SELLER_A, '+237600002607', 'Seller A');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedCollaboration('01', OWNER_A, ORG_A, 'OWNER');
    await seedCollaboration('06', OWNER_B, ORG_B, 'OWNER');
    await seedCollaboration('07', SELLER_A, ORG_A, 'SELLER');
    await seedRelationship(REL_A, ORG_A, CUSTOMER);

    // A product of two ACTIVE variants and one INACTIVE.
    await seedProduct(P_RICE, ORG_A, 'Riz');
    await seedVariant(V_SMALL, P_RICE, ORG_A, 'sac 10 kg');
    await seedVariant(V_BIG, P_RICE, ORG_A, 'sac 25 kg');
    await seedVariant(V_OLD, P_RICE, ORG_A, 'sac 50 kg', { status: 'INACTIVE' });
    // The four products that are not on sale.
    await seedProduct(P_PAUSED, ORG_A, 'Huile', { pausedAt: LONG_AGO });
    await seedVariant(V_PAUSED, P_PAUSED, ORG_A, 'bidon');
    await seedProduct(P_WITHDRAWN, ORG_A, 'Sucre');
    await seedVariant(V_WITHDRAWN, P_WITHDRAWN, ORG_A, 'sac', { status: 'INACTIVE' });
    await seedProduct(P_DELETED, ORG_A, 'Sel', { deletedAt: LONG_AGO });
    await seedVariant(V_DELETED, P_DELETED, ORG_A, 'sachet', { deletedAt: LONG_AGO });
    // Another business the customer does not buy from.
    await seedProduct(P_B, ORG_B, 'Produit de B');
    await seedVariant(V_B, P_B, ORG_B, 'unité');
  });

  it('on sale: the product and its two ACTIVE variants, with price and minimum (AC-1)', async () => {
    const res = await pull(CUSTOMER);
    expect(res.status).toBe(200);
    const body = bodyOf<PullBody>(res);
    const products = productsOf(body).created;
    expect(idsOf(products)).toEqual([P_RICE]);
    expect(Object.keys(products[0]).sort()).toEqual(CUSTOMER_PRODUCT_KEYS);
    expect(products[0]).toMatchObject({
      organization_id: ORG_A,
      name: 'Riz',
      description: 'secret-description-Riz',
      category: 'Céréales',
    });
    const variants = variantsOf(body).created;
    expect(idsOf(variants)).toEqual([V_SMALL, V_BIG].sort());
    for (const row of variants) expect(Object.keys(row).sort()).toEqual(CUSTOMER_VARIANT_KEYS);
    expect(variants.find((r) => r['id'] === V_SMALL)).toMatchObject({
      product_id: P_RICE,
      organization_id: ORG_A,
      name: 'sac 10 kg',
      unit: 'sac',
      price: 12500,
      min_order_quantity: '2.5',
    });
    expect(productsOf(body).deleted).toEqual([]);
    expect(variantsOf(body).deleted).toEqual([]);
  });

  describe('left out (AC-2, C-46)', () => {
    it('a paused product, a product with only INACTIVE variants and a deleted product', async () => {
      const body = bodyOf<PullBody>(await pull(CUSTOMER));
      const ids = JSON.stringify(body.changes);
      for (const id of [
        P_PAUSED,
        P_WITHDRAWN,
        P_DELETED,
        V_PAUSED,
        V_WITHDRAWN,
        V_DELETED,
        V_OLD,
      ]) {
        expect(ids).not.toContain(id);
      }
    });

    it('a SUSPENDED business sends nothing', async () => {
      await prisma.organization.update({ where: { id: ORG_A }, data: { status: 'SUSPENDED' } });
      const body = bodyOf<PullBody>(await pull(CUSTOMER));
      expect(productsOf(body)).toEqual({ created: [], updated: [], deleted: [] });
      expect(variantsOf(body)).toEqual({ created: [], updated: [], deleted: [] });
    });

    it.each([
      ['ENDED', { status: 'ENDED' as const, endedByParty: 'CUSTOMER' as const }],
      ['deleted', { deletedAt: new Date() }],
    ])('a %s relationship sends nothing', async (_name, data) => {
      await prisma.customerRelationship.update({ where: { id: REL_A }, data });
      const body = bodyOf<PullBody>(await pull(CUSTOMER));
      expect(productsOf(body)).toEqual({ created: [], updated: [], deleted: [] });
      expect(variantsOf(body)).toEqual({ created: [], updated: [], deleted: [] });
    });
  });

  it('back on sale: the only variant returns to ACTIVE, product and variant arrive (AC-3, CM-42)', async () => {
    const since = await cursor();
    await prisma.productVariant.update({ where: { id: V_WITHDRAWN }, data: { status: 'ACTIVE' } });
    const body = bodyOf<PullBody>(await pull(CUSTOMER, `?last_pulled_at=${since}`));
    expect(idsOf(sent(productsOf(body)))).toEqual([P_WITHDRAWN]);
    expect(idsOf(sent(variantsOf(body)))).toEqual([V_WITHDRAWN]);
    expect(productsOf(body).deleted).toEqual([]);
  });

  it('back on sale: a variant returning travels with its product and sibling variants (CM-42)', async () => {
    const since = await cursor();
    await prisma.productVariant.update({ where: { id: V_OLD }, data: { status: 'ACTIVE' } });
    const body = bodyOf<PullBody>(await pull(CUSTOMER, `?last_pulled_at=${since}`));
    expect(idsOf(sent(productsOf(body)))).toEqual([P_RICE]);
    expect(idsOf(sent(variantsOf(body)))).toEqual([V_SMALL, V_BIG, V_OLD].sort());
  });

  it('no longer on sale: the last ACTIVE variant is withdrawn, ids are in deleted (AC-4)', async () => {
    const since = await cursor();
    await prisma.productVariant.updateMany({
      where: { productId: P_RICE },
      data: { status: 'INACTIVE' },
    });
    const body = bodyOf<PullBody>(await pull(CUSTOMER, `?last_pulled_at=${since}`));
    expect(productsOf(body).deleted).toEqual([P_RICE]);
    expect(variantsOf(body).deleted.sort()).toEqual([V_SMALL, V_BIG, V_OLD].sort());
    expect(sent(productsOf(body))).toEqual([]);
    expect(sent(variantsOf(body))).toEqual([]);
  });

  it('no longer on sale: the product is paused, product and variants are in deleted (AC-4)', async () => {
    const since = await cursor();
    await prisma.product.update({ where: { id: P_RICE }, data: { pausedAt: new Date() } });
    const body = bodyOf<PullBody>(await pull(CUSTOMER, `?last_pulled_at=${since}`));
    expect(productsOf(body).deleted).toEqual([P_RICE]);
    expect(variantsOf(body).deleted.sort()).toEqual([V_SMALL, V_BIG, V_OLD].sort());
    expect(sent(productsOf(body))).toEqual([]);
    expect(sent(variantsOf(body))).toEqual([]);
  });

  it('no longer on sale: one variant of two withdrawn leaves the product, drops the variant (AC-4)', async () => {
    const since = await cursor();
    await prisma.productVariant.update({ where: { id: V_BIG }, data: { status: 'INACTIVE' } });
    const body = bodyOf<PullBody>(await pull(CUSTOMER, `?last_pulled_at=${since}`));
    expect(idsOf(sent(productsOf(body)))).toEqual([P_RICE]);
    expect(variantsOf(body).deleted).toContain(V_BIG);
    expect(idsOf(sent(variantsOf(body)))).toEqual([V_SMALL]);
  });

  it('a relationship created after the last pull brings the supplier catalog on the next one', async () => {
    const other = '0199e026-0000-7000-8000-000000000008';
    await seedPerson(other, '+237600002608', 'Newcomer');
    const since = await cursor();
    await seedRelationship('0199e026-0000-7000-8000-0000000000c2', ORG_A, other);
    await prisma.$executeRaw`UPDATE customer_relationships SET server_updated_at = now() WHERE id = '0199e026-0000-7000-8000-0000000000c2'::uuid`;
    const body = bodyOf<PullBody>(await pull(other, `?last_pulled_at=${since}`));
    expect(idsOf(sent(productsOf(body)))).toEqual([P_RICE]);
    expect(idsOf(sent(variantsOf(body)))).toEqual([V_SMALL, V_BIG].sort());
  });

  it('a member of the supplier keeps the staff view, not the customer one (8.2.2)', async () => {
    await seedRelationship('0199e026-0000-7000-8000-0000000000c3', ORG_A, SELLER_A);
    const body = bodyOf<PullBody>(await pull(SELLER_A));
    expect(idsOf(productsOf(body).created)).toEqual([P_RICE, P_PAUSED, P_WITHDRAWN].sort());
    expect(productsOf(body).created.find((r) => r['id'] === P_PAUSED)).toHaveProperty('paused_at');
  });

  it('other supplier: nothing of a business without a live relationship arrives (AB-1)', async () => {
    const res = await pull(CUSTOMER);
    expect(JSON.stringify(res.body)).not.toContain(P_B);
    expect(JSON.stringify(res.body)).not.toContain(V_B);
    const body = bodyOf<PullBody>(res);
    const forbidden = ['image_keys', 'paused_at', 'status'];
    const rows = [...productsOf(body).created, ...variantsOf(body).created];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) for (const key of forbidden) expect(row).not.toHaveProperty(key);
    // Another customer of B only sees B, never the catalog of A.
    const bOnly = '0199e026-0000-7000-8000-000000000009';
    await seedPerson(bOnly, '+237600002609', 'Customer B');
    await seedRelationship('0199e026-0000-7000-8000-0000000000c4', ORG_B, bOnly);
    const bBody = bodyOf<PullBody>(await pull(bOnly));
    expect(idsOf(productsOf(bBody).created)).toEqual([P_B]);
    expect(JSON.stringify(bBody.changes)).not.toContain(P_RICE);
  });
});
