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
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/pull${query}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const productsOf = (body: PullBody) => body.changes['products'];
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
}

async function seedOrderLine(
  suffix: string,
  productId: string,
  status: 'CONFIRMED' | 'PENDING' | 'IN_DELIVERY',
  address: string | null = 'Rue 1'
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
          productId,
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

  it('seller: every live product of the organization with price and min_order_quantity (AC-1, C-35)', async () => {
    const res = await pull(SELLER);
    expect(res.status).toBe(200);
    const rows = productsOf(bodyOf<PullBody>(res)).created;
    expect(idsOf(rows)).toEqual([P_ORDERED, P_INACTIVE, P_FREE, P_PENDING].sort());
    const riz = rows.find((r) => r['id'] === P_ORDERED)!;
    expect(riz).toMatchObject({
      name: 'Riz',
      unit: 'sac',
      price: 12500,
      min_order_quantity: '2.5',
      status: 'ACTIVE',
      organization_id: ORG_A,
    });
    expect(typeof riz['server_updated_at']).toBe('number');
    expect(rows.find((r) => r['id'] === P_INACTIVE)!['status']).toBe('INACTIVE');
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

  it('driver: only id, name and unit of products on orders to deliver (AC-2)', async () => {
    const res = await pull(DRIVER);
    expect(res.status).toBe(200);
    const rows = productsOf(bodyOf<PullBody>(res)).created;
    expect(idsOf(rows)).toEqual([P_ORDERED, P_INACTIVE].sort());
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['id', 'name', 'unit']);
    expect(JSON.stringify(res.body)).not.toContain('secret-description');
  });

  it('customer: no product rows (AC-3)', async () => {
    const res = await pull(CUSTOMER);
    expect(res.status).toBe(200);
    expect(productsOf(bodyOf<PullBody>(res))).toEqual({ created: [], updated: [], deleted: [] });
  });

  it('incremental: a changed price arrives as updated (AC-4)', async () => {
    await sleep(15);
    const since = Date.now();
    await sleep(15);
    await prisma.product.update({ where: { id: P_ORDERED }, data: { price: 15000n } });
    const body = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${since}`));
    expect(productsOf(body).created).toEqual([]);
    expect(productsOf(body).deleted).toEqual([]);
    expect(productsOf(body).updated).toHaveLength(1);
    expect(productsOf(body).updated[0]).toMatchObject({ id: P_ORDERED, price: 15000 });
  });

  it('driver: a product newly on an order to deliver arrives on an incremental pull', async () => {
    await sleep(15);
    const since = Date.now();
    await sleep(15);
    await seedOrderLine('04', P_FREE, 'CONFIRMED');
    const body = bodyOf<PullBody>(await pull(DRIVER, `?last_pulled_at=${since}`));
    const rows = [...productsOf(body).created, ...productsOf(body).updated];
    expect(idsOf(rows)).toEqual([P_FREE]);
    expect(Object.keys(rows[0]).sort()).toEqual(['id', 'name', 'unit']);
  });

  it('other business: no product of B reaches a member of A, and A is invisible to B (AB-1)', async () => {
    const a = bodyOf<PullBody>(await pull(OWNER));
    expect(JSON.stringify(a)).not.toContain(P_B);
    const b = bodyOf<PullBody>(await pull(OWNER_B));
    expect(idsOf(productsOf(b).created)).toEqual([P_B]);
  });
});
