import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0d3-0000-7000-8000-000000000001';
const SELLER = '0199c0d3-0000-7000-8000-000000000002';
const DRIVER_1 = '0199c0d3-0000-7000-8000-000000000003';
const DRIVER_2 = '0199c0d3-0000-7000-8000-000000000004';
const CUSTOMER_1 = '0199c0d3-0000-7000-8000-000000000005';
const CUSTOMER_2 = '0199c0d3-0000-7000-8000-000000000006';
const OTHER_OWNER = '0199c0d3-0000-7000-8000-000000000007';

const SUPPLIER = '0199c0d3-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c0d3-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c0d3-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c0d3-0000-7000-8000-0000000000b2';
const REL_1 = '0199c0d3-0000-7000-8000-0000000000e1';
const REL_2 = '0199c0d3-0000-7000-8000-0000000000e2';
const OTHER_REL = '0199c0d3-0000-7000-8000-0000000000e3';

const REG = new Date('2026-01-01T00:00:00.000Z');

const orderId = (n: number) => `0199c0d3-0000-7000-8000-0000000001${n}0`;
const lineId = (n: number) => `0199c0d3-0000-7000-8000-0000000002${n}0`;
const deliveryId = (n: number) => `0199c0d3-0000-7000-8000-0000000003${n}0`;

type Customer = { id: string; customer_name: string | null; available_credit: number | null };
type PoolItem = {
  order_id: string;
  delivery_address: string;
  desired_delivery_date: string | null;
  customer_note: string | null;
  total_amount: number;
  lines: { label: string; quantity: string; unit_price_applied: number; amount: number }[];
  customer: Customer;
};
type MineItem = PoolItem & {
  delivery_id: string;
  departed_at: string | null;
  arrived_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
};
type Page<T> = { items: T[]; next_cursor: string | null };

async function seedPerson(id: string, phone: string, fullName = 'Fixture Person') {
  await prisma.person.create({
    data: {
      id,
      fullName,
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
      id: `0199c0d3-0000-7000-8000-0000000004${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

type SeedOrder = {
  relationshipId?: string;
  status?: 'PENDING' | 'CONFIRMED' | 'IN_DELIVERY';
  address?: string | null;
  productId?: string;
};

/** Order n is created n days after the first one, so the pool lists the highest n first. */
async function seedOrder(n: number, options: SeedOrder = {}) {
  const status = options.status ?? 'CONFIRMED';
  await prisma.order.create({
    data: {
      id: orderId(n),
      customerRelationshipId: options.relationshipId ?? REL_1,
      enteredById: SELLER,
      placedByParty: status === 'PENDING' ? 'CUSTOMER' : 'SUPPLIER',
      status,
      deliveryAddressApplied: 'address' in options ? options.address : `Street ${n}`,
      customerNote: `note ${n}`,
      deliveryCost: 0n,
      totalAmount: 3000n,
      createdAt: new Date(Date.UTC(2026, 5, n)),
      lines: {
        create: {
          id: lineId(n),
          productId: options.productId ?? PRODUCT,
          labelApplied: 'Rice (sack)',
          quantity: '2',
          referencePrice: 1500n,
          unitPriceApplied: 1500n,
          amount: 3000n,
        },
      },
    },
  });
}

async function seedDelivery(
  n: number,
  orderNumber: number,
  driverId: string,
  state: 'assigned' | 'departed' | 'arrived' | 'failed' = 'assigned'
) {
  const at = new Date(Date.UTC(2026, 6, 1, 8));
  await prisma.delivery.create({
    data: {
      id: deliveryId(n),
      orderId: orderId(orderNumber),
      assignedToId: driverId,
      departedAt: state === 'assigned' ? null : at,
      arrivedAt: state === 'arrived' ? at : null,
      failedAt: state === 'failed' ? at : null,
      failureReason: state === 'failed' ? 'Customer absent' : null,
    },
  });
}

function pool(query = '', personId = DRIVER_1, organizationId = SUPPLIER) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${organizationId}/deliveries/to-deliver${query}`
  );
}

function mine(query = '', personId = DRIVER_1, organizationId = SUPPLIER) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${organizationId}/deliveries/mine${query}`
  );
}

/**
 * Customer 1 (limit 50000, balance 40000, a supplier note) holds orders 1 to 5 and customer 2
 * (no limit) holds order 6. Order 1 and 2 have an address and are CONFIRMED; order 3 has no
 * address; order 4 is PENDING; order 5 is IN_DELIVERY; order 6 is CONFIRMED with an address.
 */
async function seedBase() {
  await seedPerson(OWNER, '+237600083001');
  await seedPerson(SELLER, '+237600083002');
  await seedPerson(DRIVER_1, '+237600083003');
  await seedPerson(DRIVER_2, '+237600083004');
  await seedPerson(CUSTOMER_1, '+237600083005', 'Ama Customer');
  await seedPerson(CUSTOMER_2, '+237600083006', 'Bo Customer');
  await seedPerson(OTHER_OWNER, '+237600083007');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 2);
  await seedMember(SUPPLIER, DRIVER_1, 'DRIVER', 3);
  await seedMember(SUPPLIER, DRIVER_2, 'DRIVER', 4);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await prisma.product.create({
    data: { id: PRODUCT, organizationId: SUPPLIER, name: 'Rice', unit: 'sack', price: 1500n },
  });
  await prisma.product.create({
    data: { id: OTHER_PRODUCT, organizationId: OTHER_ORG, name: 'Oil', unit: 'l', price: 900n },
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL_1,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER_1,
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 50000n,
      balance: 40000n,
      supplierNotes: 'pays late, secret note',
      customerLabel: 'secret label',
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL_2,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER_2,
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: null,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: OTHER_REL,
      supplierOrganizationId: OTHER_ORG,
      customerPersonId: CUSTOMER_1,
      createdById: OTHER_OWNER,
      status: 'ACTIVE',
    },
  });
  await seedOrder(1);
  await seedOrder(2);
  await seedOrder(3, { address: null });
  await seedOrder(4, { status: 'PENDING' });
  await seedOrder(5, { status: 'IN_DELIVERY' });
  await seedOrder(6, { relationshipId: REL_2 });
}

describe('DLV-003 driver sees the orders to deliver', () => {
  beforeEach(seedBase);

  it('lists only the CONFIRMED orders with an address, newest first (AC-1)', async () => {
    await prisma.orderLine.update({ where: { id: lineId(5) }, data: { deliveredQuantity: '2' } });
    await prisma.order.update({
      where: { id: orderId(5) },
      data: { status: 'DELIVERED', deliveredAt: REG, deliveredById: SELLER },
    });

    const response = await pool();

    expect(response.status).toBe(200);
    const page = bodyOf<Page<PoolItem>>(response);
    expect(page.items.map((item) => item.order_id)).toEqual([6, 2, 1].map(orderId));
    expect(page.next_cursor).toBeNull();
    expect(page.items[1]).toMatchObject({
      delivery_address: 'Street 2',
      customer_note: 'note 2',
      total_amount: 3000,
      desired_delivery_date: null,
      lines: [{ label: 'Rice (sack)', quantity: '2', unit_price_applied: 1500, amount: 3000 }],
    });
  });

  it('never lists a deleted order', async () => {
    await prisma.order.update({ where: { id: orderId(2) }, data: { deletedAt: REG } });

    const page = bodyOf<Page<PoolItem>>(await pool());

    expect(page.items.map((item) => item.order_id)).toEqual([6, 1].map(orderId));
  });

  it('shows the available credit and the name, no balance, limit or notes (AC-2)', async () => {
    const page = bodyOf<Page<PoolItem>>(await pool());

    const first = page.items.find((item) => item.order_id === orderId(1));
    expect(first?.customer).toEqual({
      id: REL_1,
      customer_name: 'Ama Customer',
      available_credit: 10000,
    });
    const noCeiling = page.items.find((item) => item.order_id === orderId(6));
    expect(noCeiling?.customer.available_credit).toBeNull();
  });

  it('lists only the caller own deliveries, filtered by status (AC-3)', async () => {
    await prisma.order.update({ where: { id: orderId(1) }, data: { status: 'IN_DELIVERY' } });
    await seedOrder(7, { status: 'IN_DELIVERY' });
    await seedOrder(8, { status: 'IN_DELIVERY' });
    await seedOrder(9, { status: 'IN_DELIVERY' });
    await seedDelivery(1, 1, DRIVER_1, 'departed');
    await seedDelivery(2, 7, DRIVER_1, 'arrived');
    await seedDelivery(3, 8, DRIVER_1, 'failed');
    await seedDelivery(4, 9, DRIVER_2, 'departed');

    const all = bodyOf<Page<MineItem>>(await mine());
    const inProgress = bodyOf<Page<MineItem>>(await mine('?status=in_progress'));
    const done = bodyOf<Page<MineItem>>(await mine('?status=done'));
    const failed = bodyOf<Page<MineItem>>(await mine('?status=failed'));

    expect(all.items.map((item) => item.delivery_id)).toEqual([3, 2, 1].map(deliveryId));
    expect(inProgress.items.map((item) => item.delivery_id)).toEqual([deliveryId(1)]);
    expect(done.items.map((item) => item.delivery_id)).toEqual([deliveryId(2)]);
    expect(failed.items.map((item) => item.delivery_id)).toEqual([deliveryId(3)]);
    expect(failed.items[0]).toMatchObject({
      order_id: orderId(8),
      delivery_address: 'Street 8',
      failure_reason: 'Customer absent',
      arrived_at: null,
    });
    expect(failed.items[0]?.failed_at).not.toBeNull();
    expect(failed.items[0]?.departed_at).not.toBeNull();
    expect(done.items[0]?.arrived_at).not.toBeNull();
    expect(done.items[0]?.lines).toHaveLength(1);
    const other = bodyOf<Page<MineItem>>(await mine('', DRIVER_2));
    expect(other.items.map((item) => item.delivery_id)).toEqual([deliveryId(4)]);
  });

  it('never lists a deleted delivery and keeps another business out of mine', async () => {
    await prisma.order.update({ where: { id: orderId(1) }, data: { status: 'IN_DELIVERY' } });
    await seedDelivery(1, 1, DRIVER_1, 'departed');
    await prisma.delivery.update({ where: { id: deliveryId(1) }, data: { deletedAt: REG } });

    const page = bodyOf<Page<MineItem>>(await mine());

    expect(page.items).toEqual([]);
  });

  it('shows every driver of the organization the same pool (AC-4)', async () => {
    const first = bodyOf<Page<PoolItem>>(await pool('', DRIVER_1));
    const second = bodyOf<Page<PoolItem>>(await pool('', DRIVER_2));

    expect(first.items).toHaveLength(3);
    expect(second).toEqual(first);
  });

  it('is open to every role from DRIVER up', async () => {
    for (const person of [DRIVER_1, SELLER, OWNER]) {
      const response = await pool('', person);
      expect(response.status).toBe(200);
      expect(bodyOf<Page<PoolItem>>(response).items).toHaveLength(3);
    }
  });

  it('pages the pool one by one without repeats (AC-5)', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const query: string = cursor ? `?limit=1&cursor=${cursor}` : '?limit=1';
      const page = bodyOf<Page<PoolItem>>(await pool(query));
      expect(page.items.length).toBeLessThanOrEqual(1);
      seen.push(...page.items.map((item) => item.order_id));
      cursor = page.next_cursor;
      if (!cursor) break;
    }

    expect(seen).toEqual([6, 2, 1].map(orderId));
  });

  it('pages mine without repeats (AC-5)', async () => {
    await prisma.order.update({ where: { id: orderId(1) }, data: { status: 'IN_DELIVERY' } });
    await seedOrder(7, { status: 'IN_DELIVERY' });
    await seedDelivery(1, 1, DRIVER_1, 'arrived');
    await seedDelivery(2, 7, DRIVER_1, 'arrived');
    await seedDelivery(3, 5, DRIVER_1, 'failed');

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const query: string = cursor ? `?limit=1&cursor=${cursor}` : '?limit=1';
      const page = bodyOf<Page<MineItem>>(await mine(query));
      seen.push(...page.items.map((item) => item.delivery_id));
      cursor = page.next_cursor;
      if (!cursor) break;
    }

    expect(seen).toEqual([2, 3, 1].map(deliveryId));
  });

  it('rejects an unknown query field, a bad status, a bad limit and a bad cursor with 400', async () => {
    for (const query of ['?foo=1', '?cursor=%%%', '?limit=0', '?limit=101', '?status=done']) {
      const response = await pool(query);
      expect(response.status, query).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    for (const query of ['?status=NOPE', '?status=DONE', '?foo=1', '?cursor=%%%']) {
      const response = await mine(query);
      expect(response.status, query).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('answers 401 without a token', async () => {
    for (const path of ['to-deliver', 'mine']) {
      const response = await request(app).get(
        `/api/v1/organizations/${SUPPLIER}/deliveries/${path}`
      );
      expect(response.status).toBe(401);
    }
  });

  it('hides the debt, the limit, the notes and the ledger from the driver (AB-1)', async () => {
    await prisma.order.update({ where: { id: orderId(1) }, data: { status: 'IN_DELIVERY' } });
    await seedDelivery(1, 1, DRIVER_1, 'departed');

    const bodies = [
      JSON.stringify(bodyOf<unknown>(await pool())),
      JSON.stringify(bodyOf<unknown>(await mine())),
    ];

    for (const text of bodies) {
      expect(text).not.toMatch(
        /balance|credit_limit|supplier_notes|customer_label|ledger|40000|50000|secret/
      );
    }
    const item = bodyOf<Page<PoolItem>>(await pool()).items[0];
    expect(Object.keys(item?.customer ?? {}).sort()).toEqual([
      'available_credit',
      'customer_name',
      'id',
    ]);
  });

  it('answers 404 when a member of another business asks for this one (AB-2)', async () => {
    for (const route of [pool, mine]) {
      const response = await route('', OTHER_OWNER, SUPPLIER);
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
  });

  it('lists nothing of this business to the other business (AB-2)', async () => {
    await seedOrder(9, { relationshipId: OTHER_REL, productId: OTHER_PRODUCT });

    const own = bodyOf<Page<PoolItem>>(await pool('', OTHER_OWNER, OTHER_ORG));
    const supplier = bodyOf<Page<PoolItem>>(await pool());

    expect(own.items.map((item) => item.order_id)).toEqual([orderId(9)]);
    expect(supplier.items.map((item) => item.order_id)).not.toContain(orderId(9));
  });
});
