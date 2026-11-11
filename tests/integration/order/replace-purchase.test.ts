import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const SUPPLIER_OWNER = '0199c044-0000-7000-8000-000000000001';
const MANAGER = '0199c044-0000-7000-8000-000000000002';
const SELLER = '0199c044-0000-7000-8000-000000000003';
const OTHER_MANAGER = '0199c044-0000-7000-8000-000000000004';
const BUSINESS_OWNER = '0199c044-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c044-0000-7000-8000-000000000006';
const SUPPLIER = '0199c044-0000-7000-8000-0000000000a1';
const BUSINESS = '0199c044-0000-7000-8000-0000000000a2';
const OTHER_BUSINESS = '0199c044-0000-7000-8000-0000000000a3';
const PRODUCT_A = '0199c044-0000-7000-8000-0000000000b1';
const REL = '0199c044-0000-7000-8000-0000000000e1';
const OTHER_REL = '0199c044-0000-7000-8000-0000000000e2';
const P1 = '0199c044-0000-7000-8000-0000000000c1';
const P2 = '0199c044-0000-7000-8000-0000000000c2';
const OTHER_P = '0199c044-0000-7000-8000-0000000000c3';
const LINE_1 = '0199c044-0000-7000-8000-0000000000d1';
const LINE_2 = '0199c044-0000-7000-8000-0000000000d2';
const LINE_3 = '0199c044-0000-7000-8000-0000000000d3';
const REG = new Date('2026-01-01T00:00:00.000Z');

/** Server total of the replacement line: 2 x 3000. */
const TOTAL = 6000;

type Replaced = {
  order: { id: string; status: string; total_amount: number; placed_by_party: string };
  replaced_order_id: string;
};

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
      preferredLanguage: 'FR',
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
      id: `0199c044-0000-7000-8000-0000000001${n}0`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedPurchase(id: string, relationshipId: string, lineId: string, by: string) {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      placedByParty: 'CUSTOMER',
      enteredById: by,
      totalAmount: 3000n,
      status: 'PENDING',
      lines: {
        create: [
          {
            id: lineId,
            productVariantId: PRODUCT_A,
            labelApplied: 'Rice (sack)',
            quantity: '1',
            referencePrice: 3000n,
            unitPriceApplied: 3000n,
            amount: 3000n,
          },
        ],
      },
    },
  });
}

const body = () => ({
  id: P2,
  lines: [{ id: LINE_3, product_variant_id: PRODUCT_A, quantity: '2' }],
  expected_total: TOTAL,
});

const replacePurchase = (
  orderId = P1,
  payload: unknown = body(),
  personId = MANAGER,
  organizationId = BUSINESS
) =>
  createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/purchases/${orderId}/replace`)
    .send(payload as object);

async function snapshot() {
  return {
    orders: await prisma.order.findMany({ orderBy: { id: 'asc' } }),
    lines: await prisma.orderLine.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
  };
}

beforeEach(async () => {
  await seedPerson(SUPPLIER_OWNER, '+237600044001');
  await seedPerson(MANAGER, '+237600044002');
  await seedPerson(SELLER, '+237600044003');
  await seedPerson(OTHER_MANAGER, '+237600044004');
  await seedPerson(BUSINESS_OWNER, '+237600044005');
  await seedPerson(OTHER_OWNER, '+237600044006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: BUSINESS, name: 'Business', status: 'ACTIVE' } });
  await prisma.organization.create({
    data: { id: OTHER_BUSINESS, name: 'Other', status: 'ACTIVE' },
  });
  await seedMember(SUPPLIER, SUPPLIER_OWNER, 'OWNER', 1);
  await seedMember(BUSINESS, BUSINESS_OWNER, 'OWNER', 5);
  await seedMember(BUSINESS, MANAGER, 'MANAGER', 2);
  await seedMember(BUSINESS, SELLER, 'SELLER', 3);
  await seedMember(OTHER_BUSINESS, OTHER_OWNER, 'OWNER', 6);
  await seedMember(OTHER_BUSINESS, OTHER_MANAGER, 'MANAGER', 4);
  await seedProduct(prisma, {
    id: PRODUCT_A,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 3000n,
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerOrganizationId: BUSINESS,
      createdById: MANAGER,
      status: 'ACTIVE',
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: OTHER_REL,
      supplierOrganizationId: SUPPLIER,
      customerOrganizationId: OTHER_BUSINESS,
      createdById: OTHER_MANAGER,
      status: 'ACTIVE',
    },
  });
  await seedPurchase(P1, REL, LINE_1, MANAGER);
  await seedPurchase(OTHER_P, OTHER_REL, LINE_2, OTHER_MANAGER);
});

describe('ORD-044 a business changes a pending purchase', () => {
  it('AC-1 replaces P1 by P2 and links them (C-58)', async () => {
    const res = await replacePurchase();
    expect(res.status).toBe(201);
    const view = bodyOf<Replaced>(res);
    expect(view.order).toMatchObject({
      id: P2,
      status: 'PENDING',
      placed_by_party: 'CUSTOMER',
      total_amount: TOTAL,
    });
    expect(view.replaced_order_id).toBe(P1);

    const p1 = await prisma.order.findUniqueOrThrow({ where: { id: P1 } });
    const p2 = await prisma.order.findUniqueOrThrow({ where: { id: P2 } });
    expect(p1.status).toBe('CANCELLED');
    expect(p1.cancelledByParty).toBe('CUSTOMER');
    expect(p1.deletedAt).not.toBeNull();
    expect(p1.replacedByOrderId).toBe(P2);
    expect(p2.customerRelationshipId).toBe(REL);
  });

  it('AC-2 a repeat with the same id returns the first 201 and creates one new version', async () => {
    const first = await replacePurchase();
    const again = await replacePurchase();
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(await prisma.order.count({ where: { id: P2 } })).toBe(1);
    expect(await prisma.order.count()).toBe(3);
  });

  it('AB-1 answers 403 FORBIDDEN for a member without the ordering ability and changes nothing', async () => {
    const before = await snapshot();
    const res = await replacePurchase(P1, body(), SELLER);
    expect(res.status).toBe(403);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('FORBIDDEN');
    expect(await snapshot()).toEqual(before);
  });

  it('AB-2 answers 404 NOT_FOUND for a purchase of another business and changes nothing', async () => {
    const before = await snapshot();
    const res = await replacePurchase(OTHER_P);
    expect(res.status).toBe(404);
    expect(bodyOf<ErrorBody>(res).error.code).toBe('NOT_FOUND');
    expect(await snapshot()).toEqual(before);
  });

  it('answers 404 to a non-member of the path business and changes nothing', async () => {
    const before = await snapshot();
    const res = await replacePurchase(P1, body(), OTHER_MANAGER);
    expect(res.status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });
});
