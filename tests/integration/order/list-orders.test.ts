import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c019-0000-7000-8000-000000000001';
const SELLER = '0199c019-0000-7000-8000-000000000003';
const DRIVER = '0199c019-0000-7000-8000-000000000004';
const CUSTOMER_1 = '0199c019-0000-7000-8000-000000000005';
const CUSTOMER_2 = '0199c019-0000-7000-8000-000000000006';
const OTHER_OWNER = '0199c019-0000-7000-8000-000000000007';

const SUPPLIER = '0199c019-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c019-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c019-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c019-0000-7000-8000-0000000000b2';
const REL_1 = '0199c019-0000-7000-8000-0000000000e1';
const REL_2 = '0199c019-0000-7000-8000-0000000000e2';
const OTHER_REL = '0199c019-0000-7000-8000-0000000000e3';

const REG = new Date('2026-01-01T00:00:00.000Z');

/** Oldest first: order n is created n days after the first one, so the list is n5, n4, ... n1. */
const orderId = (n: number) => `0199c019-0000-7000-8000-0000000001${n}0`;
const lineId = (n: number) => `0199c019-0000-7000-8000-0000000002${n}0`;

type Item = { id: string; status: string; customer_relationship_id: string; lines: unknown[] };
type Page = { items: Item[]; next_cursor: string | null };

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'SELLER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c019-0000-7000-8000-0000000001${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedOrder(
  n: number,
  relationshipId: string,
  status: 'PENDING' | 'CONFIRMED',
  productId = PRODUCT
) {
  await prisma.order.create({
    data: {
      id: orderId(n),
      customerRelationshipId: relationshipId,
      enteredById: SELLER,
      placedByParty: status === 'PENDING' ? 'CUSTOMER' : 'SUPPLIER',
      status,
      deliveryCost: 0n,
      totalAmount: 3000n,
      createdAt: new Date(Date.UTC(2026, 5, n)),
      lines: {
        create: {
          id: lineId(n),
          productVariantId: productId,
          labelApplied: 'Rice (sack)',
          quantity: '1',
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 3000n,
        },
      },
    },
  });
}

function list(query = '', personId = SELLER, organizationId = SUPPLIER) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${organizationId}/orders${query}`
  );
}

/** Five orders: customer 1 holds orders 1, 2 and 5; customer 2 holds 3 and 4; 1 and 3 are PENDING. */
async function seedBase() {
  await seedPerson(OWNER, '+237600019001');
  await seedPerson(SELLER, '+237600019003');
  await seedPerson(DRIVER, '+237600019004');
  await seedPerson(CUSTOMER_1, '+237600019005');
  await seedPerson(CUSTOMER_2, '+237600019006');
  await seedPerson(OTHER_OWNER, '+237600019007');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await seedProduct(prisma, {
    id: PRODUCT,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: OTHER_PRODUCT,
    organizationId: OTHER_ORG,
    name: 'Oil',
    unit: 'l',
    price: 900n,
  });
  for (const [id, customer] of [
    [REL_1, CUSTOMER_1],
    [REL_2, CUSTOMER_2],
  ] as const) {
    await prisma.customerRelationship.create({
      data: {
        id,
        supplierOrganizationId: SUPPLIER,
        customerPersonId: customer,
        createdById: OWNER,
        status: 'ACTIVE',
      },
    });
  }
  await prisma.customerRelationship.create({
    data: {
      id: OTHER_REL,
      supplierOrganizationId: OTHER_ORG,
      customerPersonId: CUSTOMER_1,
      createdById: OTHER_OWNER,
      status: 'ACTIVE',
    },
  });
  await seedOrder(1, REL_1, 'PENDING');
  await seedOrder(2, REL_1, 'CONFIRMED');
  await seedOrder(3, REL_2, 'PENDING');
  await seedOrder(4, REL_2, 'CONFIRMED');
  await seedOrder(5, REL_1, 'CONFIRMED');
}

describe('ORD-019 seller lists the orders', () => {
  beforeEach(seedBase);

  it('lists the 5 orders newest first, each with its lines (AC-1)', async () => {
    const response = await list();

    expect(response.status).toBe(200);
    const page = bodyOf<Page>(response);
    expect(page.items.map((item) => item.id)).toEqual([5, 4, 3, 2, 1].map(orderId));
    expect(page.items.every((item) => item.lines.length === 1)).toBe(true);
    expect(page.next_cursor).toBeNull();
  });

  it('answers with the supplier projection', async () => {
    const page = bodyOf<Page>(await list('', OWNER));

    expect(page.items[0]).toMatchObject({
      entered_by_id: SELLER,
      sync_issue: null,
      total_amount: 3000,
    });
    expect(page.items[0]?.lines[0]).toHaveProperty('price_set_by_id');
    const sellerView = bodyOf<Page>(await list('', SELLER));
    expect(sellerView.items[0]?.lines[0]).not.toHaveProperty('price_set_by_id');
  });

  it.each([
    ['status=PENDING', 2],
    ['status=DELIVERED', 0],
  ])('filters with %s (AC-2)', async (query, count) => {
    const page = bodyOf<Page>(await list(`?${query}`));

    expect(page.items).toHaveLength(count);
  });

  it('filters by the id of customer 1 (AC-2)', async () => {
    const page = bodyOf<Page>(await list(`?customer_relationship_id=${REL_1}`));

    expect(page.items.map((item) => item.id)).toEqual([5, 2, 1].map(orderId));
  });

  it('combines the status and the customer filters', async () => {
    const page = bodyOf<Page>(await list(`?status=PENDING&customer_relationship_id=${REL_2}`));

    expect(page.items.map((item) => item.id)).toEqual([orderId(3)]);
  });

  it('pages 2, 2 and 1 orders with the returned cursor (AC-3)', async () => {
    const sizes: number[] = [];
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 4; i += 1) {
      const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
      const page = bodyOf<Page>(await list(query));
      sizes.push(page.items.length);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.next_cursor;
      if (!cursor) break;
    }

    expect(sizes).toEqual([2, 2, 1]);
    expect(seen).toEqual([5, 4, 3, 2, 1].map(orderId));
  });

  it('refuses a DRIVER with 403 (AC-4)', async () => {
    const response = await list('', DRIVER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('rejects an unknown query field, a bad status and a bad cursor with 400', async () => {
    for (const query of ['?foo=1', '?status=NOPE', '?cursor=%%%', '?customer_relationship_id=x']) {
      const response = await list(query);
      expect(response.status, query).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('never lists a deleted order or a deleted line', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.orderLine.update({ where: { id: lineId(5) }, data: { deletedAt: REG } });
      await tx.orderLine.create({
        data: {
          id: '0199c019-0000-7000-8000-0000000003f0',
          orderId: orderId(5),
          productVariantId: PRODUCT,
          labelApplied: 'Rice (sack)',
          quantity: '1',
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 3000n,
        },
      });
    });
    await prisma.order.update({ where: { id: orderId(4) }, data: { deletedAt: REG } });

    const page = bodyOf<Page>(await list());

    expect(page.items.map((item) => item.id)).toEqual([5, 3, 2, 1].map(orderId));
    expect(page.items[0]?.lines).toHaveLength(1);
  });

  it('answers 404 when a member of another business lists these orders (AB-1)', async () => {
    const response = await list('', OTHER_OWNER, SUPPLIER);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('lists nothing of this business to the other business (AB-1)', async () => {
    await seedOrder(6, OTHER_REL, 'CONFIRMED', OTHER_PRODUCT);

    const own = bodyOf<Page>(await list('', OTHER_OWNER, OTHER_ORG));
    const supplier = bodyOf<Page>(await list());

    expect(own.items.map((item) => item.id)).toEqual([orderId(6)]);
    expect(supplier.items).toHaveLength(5);
  });

  it('returns an empty list when the customer filter belongs to another business (AB-2)', async () => {
    await seedOrder(6, OTHER_REL, 'CONFIRMED', OTHER_PRODUCT);

    const response = await list(`?customer_relationship_id=${OTHER_REL}`);

    expect(response.status).toBe(200);
    expect(bodyOf<Page>(response).items).toEqual([]);
  });
});
