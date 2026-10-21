import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c020-0000-7000-8000-000000000001';
const SELLER = '0199c020-0000-7000-8000-000000000003';
const DRIVER = '0199c020-0000-7000-8000-000000000004';
const CUSTOMER = '0199c020-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c020-0000-7000-8000-000000000007';

const SUPPLIER = '0199c020-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c020-0000-7000-8000-0000000000a2';
const PRODUCT = '0199c020-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c020-0000-7000-8000-0000000000b2';
const REL = '0199c020-0000-7000-8000-0000000000e1';
const OTHER_REL = '0199c020-0000-7000-8000-0000000000e3';

const ORDER = '0199c020-0000-7000-8000-000000000110';
const OTHER_ORDER = '0199c020-0000-7000-8000-000000000120';
const GAP_LINE = '0199c020-0000-7000-8000-000000000210';
const PLAIN_LINE = '0199c020-0000-7000-8000-000000000211';
const OTHER_LINE = '0199c020-0000-7000-8000-000000000220';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Line = { id: string; price_set_by_id?: string | null };
type View = {
  id: string;
  status: string;
  total_amount: number;
  supplier_note: string | null;
  lines: Line[];
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
      id: `0199c020-0000-7000-8000-0000000001${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

function open(id: string, personId = SELLER, organizationId = SUPPLIER) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${organizationId}/orders/${id}`
  );
}

/** One order with a gap line (price lowered by the owner) and a plain line, plus another business's order. */
async function seedBase() {
  await seedPerson(OWNER, '+237600020001');
  await seedPerson(SELLER, '+237600020003');
  await seedPerson(DRIVER, '+237600020004');
  await seedPerson(CUSTOMER, '+237600020005');
  await seedPerson(OTHER_OWNER, '+237600020007');
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
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: OTHER_REL,
      supplierOrganizationId: OTHER_ORG,
      customerPersonId: CUSTOMER,
      createdById: OTHER_OWNER,
      status: 'ACTIVE',
    },
  });
  await prisma.order.create({
    data: {
      id: ORDER,
      customerRelationshipId: REL,
      enteredById: SELLER,
      placedByParty: 'SUPPLIER',
      status: 'CONFIRMED',
      deliveryCost: 0n,
      totalAmount: 5000n,
      supplierNote: 'Ring at the gate',
      lines: {
        create: [
          {
            id: GAP_LINE,
            productId: PRODUCT,
            labelApplied: 'Rice (sack)',
            quantity: '1',
            referencePrice: 3000n,
            unitPriceApplied: 2500n,
            amount: 2500n,
            priceSetById: OWNER,
            priceSetAt: REG,
          },
          {
            id: PLAIN_LINE,
            productId: PRODUCT,
            labelApplied: 'Rice (sack)',
            quantity: '1',
            referencePrice: 2500n,
            unitPriceApplied: 2500n,
            amount: 2500n,
          },
        ],
      },
    },
  });
  await prisma.order.create({
    data: {
      id: OTHER_ORDER,
      customerRelationshipId: OTHER_REL,
      enteredById: OTHER_OWNER,
      placedByParty: 'SUPPLIER',
      status: 'CONFIRMED',
      deliveryCost: 0n,
      totalAmount: 900n,
      lines: {
        create: {
          id: OTHER_LINE,
          productId: OTHER_PRODUCT,
          labelApplied: 'Oil (l)',
          quantity: '1',
          referencePrice: 900n,
          unitPriceApplied: 900n,
          amount: 900n,
        },
      },
    },
  });
}

describe('ORD-020 seller opens one order', () => {
  beforeEach(seedBase);

  it('opens an order of the organization with lines, total, note and status (AC-1)', async () => {
    const response = await open(ORDER);

    expect(response.status).toBe(200);
    const view = bodyOf<View>(response);
    expect(view).toMatchObject({
      id: ORDER,
      status: 'CONFIRMED',
      total_amount: 5000,
      supplier_note: 'Ring at the gate',
    });
    expect(view.lines.map((line) => line.id).sort()).toEqual([GAP_LINE, PLAIN_LINE]);
  });

  it('shows the price author to an OWNER and hides it from a SELLER (AC-2)', async () => {
    const ownerView = bodyOf<View>(await open(ORDER, OWNER));
    const gap = ownerView.lines.find((line) => line.id === GAP_LINE);
    expect(gap?.price_set_by_id).toBe(OWNER);

    const sellerView = bodyOf<View>(await open(ORDER, SELLER));
    for (const line of sellerView.lines) expect(line).not.toHaveProperty('price_set_by_id');
  });

  it('never returns a deleted line', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.orderLine.update({ where: { id: PLAIN_LINE }, data: { deletedAt: REG } });
      await tx.orderLine.create({
        data: {
          id: '0199c020-0000-7000-8000-0000000002f0',
          orderId: ORDER,
          productId: PRODUCT,
          labelApplied: 'Rice (sack)',
          quantity: '1',
          referencePrice: 2500n,
          unitPriceApplied: 2500n,
          amount: 2500n,
        },
      });
    });

    const view = bodyOf<View>(await open(ORDER));

    expect(view.lines.map((line) => line.id).sort()).toEqual(
      [GAP_LINE, '0199c020-0000-7000-8000-0000000002f0'].sort()
    );
  });

  it('answers 404 for a deleted order and for an unknown id (AC-3)', async () => {
    await prisma.order.update({ where: { id: ORDER }, data: { deletedAt: REG } });

    for (const id of [ORDER, '0199c020-0000-7000-8000-0000000009ff']) {
      const response = await open(id);
      expect(response.status, id).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
  });

  it('answers 404 for an order of another business (AC-3)', async () => {
    const response = await open(OTHER_ORDER);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('answers 400 for an id that is not a UUID (AC-3)', async () => {
    const response = await open('not-a-uuid');

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a DRIVER with 403 (AC-4)', async () => {
    const response = await open(ORDER, DRIVER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('answers 404 when a member of B asks for an order id of A under A path (AB-1)', async () => {
    const response = await open(ORDER, OTHER_OWNER, SUPPLIER);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('answers 404 when a member of A asks for an order of B under A path (AB-1)', async () => {
    const response = await open(OTHER_ORDER, OWNER, SUPPLIER);

    expect(response.status).toBe(404);
  });
});
