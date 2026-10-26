import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const OWNER = '0199e005-0000-7000-8000-000000000001';
const SELLER = '0199e005-0000-7000-8000-000000000002';
const DRIVER = '0199e005-0000-7000-8000-000000000003';
const CUSTOMER = '0199e005-0000-7000-8000-000000000005';
const OWNER_B = '0199e005-0000-7000-8000-000000000006';
const ORG_A = '0199e005-0000-7000-8000-0000000000a1';
const ORG_B = '0199e005-0000-7000-8000-0000000000b1';
const REL = '0199e005-0000-7000-8000-0000000000c1';
const P_ORDERED = '0199e005-0000-7000-8000-0000000000d1';
const P_INACTIVE = '0199e005-0000-7000-8000-0000000000d2';
const P_FREE = '0199e005-0000-7000-8000-0000000000d3';
const P_DELETED = '0199e005-0000-7000-8000-0000000000d4';
const P_B = '0199e005-0000-7000-8000-0000000000d5';
const P_PENDING = '0199e005-0000-7000-8000-0000000000d6';
const P_SACK = '0199e005-0000-7000-8000-0000000000d7';
const V_10KG = '0199e005-0000-7000-8000-0000000000e1';
const V_25KG = '0199e005-0000-7000-8000-0000000000e2';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

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
      id: `0199e005-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

async function seedProduct(
  id: string,
  org: string,
  name: string,
  extra: { status?: 'ACTIVE' | 'INACTIVE'; deletedAt?: Date } = {}
) {
  await prisma.product.create({
    data: {
      id,
      organizationId: org,
      name,
      unit: 'sac',
      price: 12500n,
      minOrderQuantity: '2.500',
      description: 'secret-description',
      category: 'secret-category',
      status: extra.status ?? 'ACTIVE',
      deletedAt: extra.deletedAt ?? null,
      createdAt: LONG_AGO,
    },
  });
  // The database stamps the creation time; move it back so incremental pulls are deterministic.
  await prisma.$executeRaw`UPDATE products SET server_updated_at = ${LONG_AGO} WHERE id = ${id}::uuid`;
  // The product's mirrored variant (same id) is moved back too.
  await prisma.$executeRaw`UPDATE product_variants SET server_updated_at = ${LONG_AGO}, created_at = ${LONG_AGO} WHERE id = ${id}::uuid`;
}

async function seedOrderLine(
  suffix: string,
  productId: string,
  status: 'CONFIRMED' | 'PENDING' | 'IN_DELIVERY' | 'DELIVERED',
  address: string | null = 'Rue 1',
  variantId?: string
) {
  const orderId = `0199e005-0000-7000-8000-0000000002${suffix}`;
  await prisma.order.create({
    data: {
      id: orderId,
      customerRelationshipId: REL,
      placedByParty: status === 'PENDING' ? 'CUSTOMER' : 'SUPPLIER',
      enteredById: SELLER,
      totalAmount: 37500n,
      status,
      deliveryAddressApplied: address,
      lines: {
        create: {
          id: `0199e005-0000-7000-8000-0000000003${suffix}`,
          productVariantId: variantId ?? productId,
          labelApplied: 'x',
          quantity: '3.000',
          referencePrice: 12500n,
          unitPriceApplied: 12500n,
          amount: 37500n,
        },
      },
    },
  });
}

/** A second sold level of a product, moved back in time like the seeded rows. */
async function seedVariant(id: string, productId: string, name: string) {
  await prisma.productVariant.create({
    data: {
      id,
      productId,
      organizationId: ORG_A,
      name,
      unit: 'sac',
      price: 15000n,
      minOrderQuantity: '2.500',
      createdAt: LONG_AGO,
    },
  });
  await prisma.$executeRaw`UPDATE product_variants SET server_updated_at = ${LONG_AGO} WHERE id = ${id}::uuid`;
  await prisma.$executeRaw`UPDATE products SET server_updated_at = ${LONG_AGO} WHERE id = ${productId}::uuid`;
}

const DRIVER_PRODUCT_KEYS = ['id', 'name'];
const DRIVER_VARIANT_KEYS = ['id', 'name', 'product_id', 'unit'];

describe('GET /api/v1/sync/pull (catalog)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600000501', 'Owner A');
    await seedPerson(SELLER, '+237600000502', 'Seller A');
    await seedPerson(DRIVER, '+237600000503', 'Driver A');
    await seedPerson(CUSTOMER, '+237600000505', 'Customer');
    await seedPerson(OWNER_B, '+237600000506', 'Owner B');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedCollaboration('01', OWNER, ORG_A, 'OWNER');
    await seedCollaboration('02', SELLER, ORG_A, 'SELLER');
    await seedCollaboration('03', DRIVER, ORG_A, 'DRIVER');
    await seedCollaboration('05', OWNER_B, ORG_B, 'OWNER');

    await prisma.customerRelationship.create({
      data: {
        id: REL,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        customerLabel: 'Chez Mama',
        creditLimit: 0n,
        createdById: SELLER,
        createdAt: LONG_AGO,
      },
    });
    await seedProduct(P_ORDERED, ORG_A, 'Riz');
    await seedProduct(P_INACTIVE, ORG_A, 'Huile');
    await seedProduct(P_FREE, ORG_A, 'Sucre');
    await seedProduct(P_DELETED, ORG_A, 'Sel', { deletedAt: LONG_AGO });
    await seedProduct(P_PENDING, ORG_A, 'Farine');
    await seedProduct(P_B, ORG_B, 'Produit de B');
    await seedOrderLine('01', P_ORDERED, 'CONFIRMED');
    await seedOrderLine('02', P_INACTIVE, 'IN_DELIVERY');
    await seedOrderLine('03', P_PENDING, 'PENDING');
    // A line needs an ACTIVE product when created; the product is deactivated afterwards.
    await prisma.$executeRaw`UPDATE products SET status = 'INACTIVE', server_updated_at = ${LONG_AGO} WHERE id = ${P_INACTIVE}::uuid`;
  });

  it('seller: every live product of the organization, the price on its variant (AC-1, C-35)', async () => {
    const res = await pull(SELLER);
    expect(res.status).toBe(200);
    const rows = productsOf(bodyOf<PullBody>(res)).created;
    expect(idsOf(rows)).toEqual([P_ORDERED, P_INACTIVE, P_FREE, P_PENDING].sort());
    const riz = rows.find((r) => r['id'] === P_ORDERED)!;
    expect(riz).toMatchObject({ name: 'Riz', organization_id: ORG_A });
    for (const field of ['unit', 'price', 'price_updated_at', 'min_order_quantity', 'status']) {
      expect(riz).not.toHaveProperty(field);
    }
    expect(typeof riz['server_updated_at']).toBe('number');
    // The variant carries the price, the unit, the minimum and the status.
    const variants = variantsOf(bodyOf<PullBody>(res)).created;
    expect(variants.find((r) => r['id'] === P_ORDERED)).toMatchObject({
      product_id: P_ORDERED,
      unit: 'sac',
      price: 12500,
      min_order_quantity: '2.5',
      status: 'ACTIVE',
    });
    expect(variants.find((r) => r['id'] === P_INACTIVE)!['status']).toBe('INACTIVE');
    expect(productsOf(bodyOf<PullBody>(res)).deleted).toEqual([]);
  });

  it('seller: a deleted product is listed in deleted on an incremental pull (C-35)', async () => {
    await sleep(15);
    const since = Date.now();
    await sleep(15);
    await prisma.product.update({ where: { id: P_FREE }, data: { deletedAt: new Date() } });
    const body = bodyOf<PullBody>(await pull(OWNER, `?last_pulled_at=${since}`));
    expect(productsOf(body).deleted).toEqual([P_FREE]);
    expect(productsOf(body).created).toEqual([]);
  });

  it('driver: id and name of products, and their variants, on orders to deliver (AC-2)', async () => {
    const res = await pull(DRIVER);
    expect(res.status).toBe(200);
    const rows = productsOf(bodyOf<PullBody>(res)).created;
    expect(idsOf(rows)).toEqual([P_ORDERED, P_INACTIVE].sort());
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(DRIVER_PRODUCT_KEYS);
    const variants = variantsOf(bodyOf<PullBody>(res)).created;
    expect(idsOf(variants)).toEqual([P_ORDERED, P_INACTIVE].sort());
    for (const row of variants) expect(Object.keys(row).sort()).toEqual(DRIVER_VARIANT_KEYS);
    expect(JSON.stringify(res.body)).not.toContain('secret-description');
  });

  it('customer: the products on sale and their ACTIVE variants (SYNC-026)', async () => {
    const res = await pull(CUSTOMER);
    expect(res.status).toBe(200);
    const body = bodyOf<PullBody>(res);
    expect(idsOf(productsOf(body).created)).toEqual([P_ORDERED, P_FREE, P_PENDING].sort());
    expect(idsOf(variantsOf(body).created)).toEqual([P_ORDERED, P_FREE, P_PENDING].sort());
    expect(productsOf(body).deleted).toEqual([]);
  });

  it('incremental: a changed price arrives as an updated variant, with its product (AC-4)', async () => {
    await sleep(15);
    const since = Date.now();
    await sleep(15);
    await prisma.product.update({ where: { id: P_ORDERED }, data: { price: 15000n } });
    const body = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${since}`));
    expect(productsOf(body).created).toEqual([]);
    expect(productsOf(body).deleted).toEqual([]);
    expect(variantsOf(body).created).toEqual([]);
    expect(variantsOf(body).updated).toHaveLength(1);
    expect(variantsOf(body).updated[0]).toMatchObject({ id: P_ORDERED, price: 15000 });
    expect(productsOf(body).updated).toHaveLength(1);
    expect(productsOf(body).updated[0]).not.toHaveProperty('price');
    expect(productsOf(body).updated[0]).toMatchObject({ id: P_ORDERED });
  });

  it('driver: a product newly on an order to deliver arrives on an incremental pull', async () => {
    await sleep(15);
    const since = Date.now();
    await sleep(15);
    await seedOrderLine('04', P_FREE, 'CONFIRMED');
    const body = bodyOf<PullBody>(await pull(DRIVER, `?last_pulled_at=${since}`));
    const rows = [...productsOf(body).created, ...productsOf(body).updated];
    expect(idsOf(rows)).toEqual([P_FREE]);
    expect(Object.keys(rows[0]).sort()).toEqual(DRIVER_PRODUCT_KEYS);
    const variants = [...variantsOf(body).created, ...variantsOf(body).updated];
    expect(idsOf(variants)).toEqual([P_FREE]);
    expect(Object.keys(variants[0]).sort()).toEqual(DRIVER_VARIANT_KEYS);
  });

  describe('driver: variants named by lines (SYNC-025)', () => {
    beforeEach(async () => {
      await seedProduct(P_SACK, ORG_A, 'Ciment');
      await seedVariant(V_10KG, P_SACK, 'sac 10 kg');
      await seedVariant(V_25KG, P_SACK, 'sac 25 kg');
    });

    it('names only: the variant on the order, with four columns (AC-1, CM-30)', async () => {
      await seedOrderLine('05', P_SACK, 'CONFIRMED', 'Rue 1', V_10KG);
      const body = bodyOf<PullBody>(await pull(DRIVER));
      const product = productsOf(body).created.find((r) => r['id'] === P_SACK)!;
      expect(product).toEqual({ id: P_SACK, name: 'Ciment' });
      const variants = variantsOf(body).created.filter((r) => r['product_id'] === P_SACK);
      expect(variants).toEqual([
        { id: V_10KG, product_id: P_SACK, name: 'sac 10 kg', unit: 'sac' },
      ]);
    });

    it('withdrawn or paused: both still arrive with the same columns (AC-2)', async () => {
      await seedOrderLine('05', P_SACK, 'CONFIRMED', 'Rue 1', V_10KG);
      await prisma.$executeRaw`UPDATE product_variants SET status = 'INACTIVE' WHERE id = ${V_10KG}::uuid`;
      await prisma.$executeRaw`UPDATE products SET paused_at = now() WHERE id = ${P_SACK}::uuid`;
      const body = bodyOf<PullBody>(await pull(DRIVER));
      const product = productsOf(body).created.find((r) => r['id'] === P_SACK)!;
      expect(Object.keys(product).sort()).toEqual(DRIVER_PRODUCT_KEYS);
      const variant = variantsOf(body).created.find((r) => r['id'] === V_10KG)!;
      expect(Object.keys(variant).sort()).toEqual(DRIVER_VARIANT_KEYS);
    });

    it('newly visible: a line on an unchanged variant sends it with its product (AC-3)', async () => {
      await sleep(15);
      const since = Date.now();
      await sleep(15);
      await seedOrderLine('05', P_SACK, 'CONFIRMED', 'Rue 1', V_10KG);
      const body = bodyOf<PullBody>(await pull(DRIVER, `?last_pulled_at=${since}`));
      const variants = [...variantsOf(body).created, ...variantsOf(body).updated];
      expect(idsOf(variants.filter((r) => r['product_id'] === P_SACK))).toEqual([V_10KG]);
      const products = [...productsOf(body).created, ...productsOf(body).updated];
      expect(products.map((r) => r['id'])).toContain(P_SACK);
    });

    it('delivered: the only order naming the variant is delivered, nothing is sent (AC-4)', async () => {
      await seedOrderLine('05', P_SACK, 'CONFIRMED', 'Rue 1', V_10KG);
      await prisma.orderLine.update({
        where: { id: '0199e005-0000-7000-8000-000000000305' },
        data: { deliveredQuantity: '3.000' },
      });
      await prisma.order.update({
        where: { id: '0199e005-0000-7000-8000-000000000205' },
        data: { status: 'DELIVERED', deliveredAt: new Date(), deliveredById: DRIVER },
      });
      const body = bodyOf<PullBody>(await pull(DRIVER));
      expect(productsOf(body).created.map((r) => r['id'])).not.toContain(P_SACK);
      expect(variantsOf(body).created.map((r) => r['id'])).not.toContain(V_10KG);
    });

    it('a deleted variant still named by a line is announced by id (SYNC-005 rule)', async () => {
      await seedOrderLine('05', P_SACK, 'CONFIRMED', 'Rue 1', V_10KG);
      await sleep(15);
      const since = Date.now();
      await sleep(15);
      await prisma.productVariant.update({
        where: { id: V_10KG },
        data: { deletedAt: new Date() },
      });
      const body = bodyOf<PullBody>(await pull(DRIVER, `?last_pulled_at=${since}`));
      expect(variantsOf(body).deleted).toEqual([V_10KG]);
      expect(variantsOf(body).created).toEqual([]);
    });

    it('a variant of another business never reaches the driver (8.2.2)', async () => {
      const res = await pull(DRIVER);
      expect(JSON.stringify(res.body)).not.toContain(P_B);
    });

    it('no prices: forbidden keys are absent from every driver row (AB-1, CWE-213)', async () => {
      await seedOrderLine('05', P_SACK, 'CONFIRMED', 'Rue 1', V_10KG);
      const body = bodyOf<PullBody>(await pull(DRIVER));
      const forbidden = [
        'price',
        'price_updated_at',
        'min_order_quantity',
        'status',
        'image_urls',
        'paused_at',
        'description',
        'category',
      ];
      const rows = [...productsOf(body).created, ...variantsOf(body).created];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) for (const key of forbidden) expect(row).not.toHaveProperty(key);
    });
  });

  it('other business: no product of B reaches a member of A, and A is invisible to B (AB-1)', async () => {
    const a = bodyOf<PullBody>(await pull(OWNER));
    expect(JSON.stringify(a)).not.toContain(P_B);
    const b = bodyOf<PullBody>(await pull(OWNER_B));
    expect(idsOf(productsOf(b).created)).toEqual([P_B]);
  });
});
