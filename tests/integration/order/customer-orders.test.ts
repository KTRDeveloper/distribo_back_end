import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c021-0000-7000-8000-000000000001';
const SELLER = '0199c021-0000-7000-8000-000000000003';
const OTHER_OWNER = '0199c021-0000-7000-8000-000000000004';
const CUSTOMER_A = '0199c021-0000-7000-8000-000000000005';
const CUSTOMER_B = '0199c021-0000-7000-8000-000000000006';
const BUYER_OWNER = '0199c021-0000-7000-8000-000000000007';
const BUYER_MANAGER = '0199c021-0000-7000-8000-000000000008';
const BUYER_SELLER = '0199c021-0000-7000-8000-000000000009';
const OTHER_BUYER_OWNER = '0199c021-0000-7000-8000-00000000000a';

const SUPPLIER = '0199c021-0000-7000-8000-0000000000a1';
const OTHER_SUPPLIER = '0199c021-0000-7000-8000-0000000000a2';
const BUYER = '0199c021-0000-7000-8000-0000000000a3';
const OTHER_BUYER = '0199c021-0000-7000-8000-0000000000a4';
const PRODUCT = '0199c021-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c021-0000-7000-8000-0000000000b2';
const REL_A1 = '0199c021-0000-7000-8000-0000000000e1';
const REL_A2 = '0199c021-0000-7000-8000-0000000000e2';
const REL_B = '0199c021-0000-7000-8000-0000000000e3';
const REL_BUYER = '0199c021-0000-7000-8000-0000000000e4';
const REL_OTHER_BUYER = '0199c021-0000-7000-8000-0000000000e5';

const REG = new Date('2026-01-01T00:00:00.000Z');

/** Order n is created n days into June, so newest first is the highest n first. */
const orderId = (n: number) => `0199c021-0000-7000-8000-0000000001${n}0`;
const lineId = (n: number) => `0199c021-0000-7000-8000-0000000002${n}0`;

type Line = Record<string, unknown>;
type Item = {
  id: string;
  status: string;
  customer_relationship_id: string;
  lines: Line[];
} & Record<string, unknown>;
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
  role: 'OWNER' | 'MANAGER' | 'SELLER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c021-0000-7000-8000-0000000003${n}0`,
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
  // A PENDING line starts at the reference price; a CONFIRMED one carries a price gap and its author.
  const gap = status === 'CONFIRMED';
  const price = gap ? 2700n : 3000n;
  await prisma.order.create({
    data: {
      id: orderId(n),
      customerRelationshipId: relationshipId,
      enteredById: SELLER,
      placedByParty: status === 'PENDING' ? 'CUSTOMER' : 'SUPPLIER',
      status,
      deliveryCost: 0n,
      totalAmount: price,
      syncIssue: 'PRICE_CONFLICT',
      createdAt: new Date(Date.UTC(2026, 5, n)),
      lines: {
        create: {
          id: lineId(n),
          productId,
          labelApplied: 'Rice (sack)',
          quantity: '1',
          referencePrice: 3000n,
          unitPriceApplied: price,
          amount: price,
          ...(gap ? { priceSetById: SELLER, priceSetAt: REG } : {}),
        },
      },
    },
  });
}

function listOwn(query = '', personId = CUSTOMER_A) {
  return createAuthenticatedRequest(app, personId).get(`/api/v1/orders${query}`);
}

function openOwn(id: string, personId = CUSTOMER_A) {
  return createAuthenticatedRequest(app, personId).get(`/api/v1/orders/${id}`);
}

function listPurchases(query = '', personId = BUYER_MANAGER, organizationId = BUYER) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${organizationId}/purchases${query}`
  );
}

function openPurchase(id: string, personId = BUYER_MANAGER, organizationId = BUYER) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${organizationId}/purchases/${id}`
  );
}

/**
 * Customer A holds orders 1 (PENDING), 2 and 5 at the supplier and 3 at the other supplier; B holds
 * 4; the business BUYER holds 6 and 7; the business OTHER_BUYER holds 8.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600021001');
  await seedPerson(SELLER, '+237600021003');
  await seedPerson(OTHER_OWNER, '+237600021004');
  await seedPerson(CUSTOMER_A, '+237600021005');
  await seedPerson(CUSTOMER_B, '+237600021006');
  await seedPerson(BUYER_OWNER, '+237600021007');
  await seedPerson(BUYER_MANAGER, '+237600021008');
  await seedPerson(BUYER_SELLER, '+237600021009');
  await seedPerson(OTHER_BUYER_OWNER, '+237600021010');
  for (const [id, name] of [
    [SUPPLIER, 'Supplier'],
    [OTHER_SUPPLIER, 'Other supplier'],
    [BUYER, 'Buyer'],
    [OTHER_BUYER, 'Other buyer'],
  ] as const) {
    await prisma.organization.create({ data: { id, name, status: 'ACTIVE' } });
  }
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 2);
  await seedMember(OTHER_SUPPLIER, OTHER_OWNER, 'OWNER', 3);
  await seedMember(BUYER, BUYER_OWNER, 'OWNER', 4);
  await seedMember(BUYER, BUYER_MANAGER, 'MANAGER', 5);
  await seedMember(BUYER, BUYER_SELLER, 'SELLER', 6);
  await seedMember(OTHER_BUYER, OTHER_BUYER_OWNER, 'OWNER', 7);
  await prisma.product.create({
    data: { id: PRODUCT, organizationId: SUPPLIER, name: 'Rice', unit: 'sack', price: 3000n },
  });
  await prisma.product.create({
    data: {
      id: OTHER_PRODUCT,
      organizationId: OTHER_SUPPLIER,
      name: 'Oil',
      unit: 'l',
      price: 900n,
    },
  });
  const personRels = [
    [REL_A1, SUPPLIER, CUSTOMER_A, OWNER],
    [REL_A2, OTHER_SUPPLIER, CUSTOMER_A, OTHER_OWNER],
    [REL_B, SUPPLIER, CUSTOMER_B, OWNER],
  ] as const;
  for (const [id, supplier, customer, creator] of personRels) {
    await prisma.customerRelationship.create({
      data: {
        id,
        supplierOrganizationId: supplier,
        customerPersonId: customer,
        createdById: creator,
        status: 'ACTIVE',
      },
    });
  }
  for (const [id, customerOrg, creator] of [
    [REL_BUYER, BUYER, BUYER_OWNER],
    [REL_OTHER_BUYER, OTHER_BUYER, OTHER_BUYER_OWNER],
  ] as const) {
    await prisma.customerRelationship.create({
      data: {
        id,
        supplierOrganizationId: SUPPLIER,
        customerOrganizationId: customerOrg,
        createdById: creator,
        status: 'ACTIVE',
      },
    });
  }
  await seedOrder(1, REL_A1, 'PENDING');
  await seedOrder(2, REL_A1, 'CONFIRMED');
  await seedOrder(3, REL_A2, 'CONFIRMED', OTHER_PRODUCT);
  await seedOrder(4, REL_B, 'CONFIRMED');
  await seedOrder(5, REL_A1, 'CONFIRMED');
  await seedOrder(6, REL_BUYER, 'PENDING');
  await seedOrder(7, REL_BUYER, 'CONFIRMED');
  await seedOrder(8, REL_OTHER_BUYER, 'CONFIRMED');
});

describe('ORD-021 customer lists and opens their orders', () => {
  it('lists the 4 orders of a person at two suppliers in the customer view (AC-1)', async () => {
    const response = await listOwn();

    expect(response.status).toBe(200);
    const page = bodyOf<Page>(response);
    expect(page.items.map((item) => item.id)).toEqual([5, 3, 2, 1].map(orderId));
    expect(page.next_cursor).toBeNull();
    expect(page.items[0]).toMatchObject({ customer_relationship_id: REL_A1, total_amount: 2700 });
    expect(page.items[0]?.lines).toHaveLength(1);
    expect(page.items[0]?.lines[0]).toMatchObject({
      label_applied: 'Rice (sack)',
      reference_price: 3000,
      unit_price_applied: 2700,
      amount: 2700,
    });
  });

  it('opens an own order and answers 404 for another person order (AC-2)', async () => {
    const own = await openOwn(orderId(2));

    expect(own.status).toBe(200);
    expect(bodyOf<Item>(own).id).toBe(orderId(2));
    expect(bodyOf<Item>(own).lines).toHaveLength(1);

    const foreign = await openOwn(orderId(4));
    expect(foreign.status).toBe(404);
    expect(bodyOf<ErrorBody>(foreign).error.code).toBe('NOT_FOUND');
    expect((await openOwn(orderId(9))).status).toBe(404);
  });

  it('rejects a malformed order id with 400', async () => {
    const response = await openOwn('not-a-uuid');

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('lists the purchases of the business to a MANAGER and refuses a SELLER (AC-3)', async () => {
    const page = bodyOf<Page>(await listPurchases());

    expect(page.items.map((item) => item.id)).toEqual([7, 6].map(orderId));
    expect(bodyOf<Page>(await listPurchases('', BUYER_OWNER)).items).toHaveLength(2);

    const refused = await listPurchases('', BUYER_SELLER);
    expect(refused.status).toBe(403);
    expect(bodyOf<ErrorBody>(refused).error.code).toBe('FORBIDDEN');
    expect((await openPurchase(orderId(6), BUYER_SELLER)).status).toBe(403);
  });

  it('opens one purchase and answers 404 for an order of another business (AC-3)', async () => {
    const own = await openPurchase(orderId(6));
    expect(own.status).toBe(200);
    expect(bodyOf<Item>(own).id).toBe(orderId(6));

    expect((await openPurchase(orderId(8))).status).toBe(404);
    expect((await openPurchase(orderId(1))).status).toBe(404);
  });

  it('answers 404 to a non-member of the business', async () => {
    const response = await listPurchases('', OTHER_BUYER_OWNER, BUYER);

    expect(response.status).toBe(404);
  });

  it('keeps purchases out of the person list and the person orders out of purchases', async () => {
    const own = bodyOf<Page>(await listOwn('', BUYER_MANAGER));
    expect(own.items).toEqual([]);
    expect((await openOwn(orderId(6), BUYER_MANAGER)).status).toBe(404);
    expect((await openPurchase(orderId(2))).status).toBe(404);
  });

  it('filters by status and by relationship (AC-4)', async () => {
    const pending = bodyOf<Page>(await listOwn('?status=PENDING'));
    expect(pending.items.map((item) => item.id)).toEqual([orderId(1)]);

    const rel = bodyOf<Page>(await listOwn(`?supplier_relationship_id=${REL_A2}`));
    expect(rel.items.map((item) => item.id)).toEqual([orderId(3)]);

    const both = bodyOf<Page>(await listOwn(`?status=PENDING&supplier_relationship_id=${REL_A2}`));
    expect(both.items).toEqual([]);

    const purchases = bodyOf<Page>(await listPurchases('?status=PENDING'));
    expect(purchases.items.map((item) => item.id)).toEqual([orderId(6)]);
  });

  it('pages 2 and 2 with the cursor, and the purchases 1 and 1 (AC-4)', async () => {
    const sizes: number[] = [];
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 4; i += 1) {
      const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
      const page = bodyOf<Page>(await listOwn(query));
      sizes.push(page.items.length);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.next_cursor;
      if (!cursor) break;
    }

    expect(sizes).toEqual([2, 2]);
    expect(seen).toEqual([5, 3, 2, 1].map(orderId));

    const purchases = bodyOf<Page>(await listPurchases('?limit=1'));
    expect(purchases.items).toHaveLength(1);
    const next = bodyOf<Page>(await listPurchases(`?limit=1&cursor=${purchases.next_cursor}`));
    expect(next.items.map((item) => item.id)).toEqual([orderId(6)]);
    expect(next.next_cursor).toBeNull();
  });

  it('rejects an unknown field, a bad status, a bad id and a bad cursor with 400', async () => {
    for (const query of [
      '?foo=1',
      '?status=NOPE',
      '?cursor=%%%',
      '?supplier_relationship_id=x',
      '?customer_relationship_id=' + REL_A1,
      '?limit=101',
    ]) {
      const response = await listOwn(query);
      expect(response.status, query).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('never lists a deleted order or a deleted line', async () => {
    await prisma.order.update({ where: { id: orderId(5) }, data: { deletedAt: REG } });
    await prisma.$transaction(async (tx) => {
      await tx.orderLine.update({ where: { id: lineId(2) }, data: { deletedAt: REG } });
      await tx.orderLine.create({
        data: {
          id: '0199c021-0000-7000-8000-0000000004f0',
          orderId: orderId(2),
          productId: PRODUCT,
          labelApplied: 'Rice (sack)',
          quantity: '1',
          referencePrice: 3000n,
          unitPriceApplied: 2700n,
          amount: 2700n,
          priceSetById: SELLER,
          priceSetAt: REG,
        },
      });
    });

    const page = bodyOf<Page>(await listOwn());

    expect(page.items.map((item) => item.id)).toEqual([3, 2, 1].map(orderId));
    expect(page.items[1]?.lines.map((line) => line.id)).toEqual([
      '0199c021-0000-7000-8000-0000000004f0',
    ]);
    expect((await openOwn(orderId(5))).status).toBe(404);
  });

  it('shows nothing of person B to person A, as a list, a filter or an id (AB-1)', async () => {
    const list = bodyOf<Page>(await listOwn('', CUSTOMER_A));
    expect(list.items.map((item) => item.id)).not.toContain(orderId(4));

    const asB = bodyOf<Page>(await listOwn('', CUSTOMER_B));
    expect(asB.items.map((item) => item.id)).toEqual([orderId(4)]);

    const filtered = bodyOf<Page>(await listOwn(`?supplier_relationship_id=${REL_B}`));
    expect(filtered.items).toEqual([]);
    expect((await openOwn(orderId(4))).status).toBe(404);
  });

  it('hides the supplier-side fields from the customer (AB-2)', async () => {
    const hidden = [
      'entered_by_id',
      'delivered_by_id',
      'cancelled_by_id',
      'sync_issue',
      'price_set_by_id',
      'price_set_at',
    ];
    const bodies = [
      bodyOf<Page>(await listOwn()).items,
      [bodyOf<Item>(await openOwn(orderId(2)))],
      bodyOf<Page>(await listPurchases()).items,
      [bodyOf<Item>(await openPurchase(orderId(6)))],
    ].flat();

    expect(bodies.length).toBeGreaterThan(0);
    for (const item of bodies) {
      for (const field of hidden) {
        expect(item, field).not.toHaveProperty(field);
        for (const line of item.lines) expect(line, field).not.toHaveProperty(field);
      }
    }
  });

  it('refuses an unauthenticated request with 401', async () => {
    const { default: request } = await import('supertest');

    expect((await request(app).get('/api/v1/orders')).status).toBe(401);
    expect((await request(app).get(`/api/v1/orders/${orderId(1)}`)).status).toBe(401);
  });
});
