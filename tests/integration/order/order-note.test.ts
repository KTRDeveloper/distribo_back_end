import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c013-0000-7000-8000-000000000001';
const SELLER = '0199c013-0000-7000-8000-000000000003';
const DRIVER = '0199c013-0000-7000-8000-000000000004';
const CUSTOMER = '0199c013-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c013-0000-7000-8000-000000000006';

const SUPPLIER = '0199c013-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c013-0000-7000-8000-0000000000a2';
const PRODUCT_A = '0199c013-0000-7000-8000-0000000000b1';
const PRODUCT_B = '0199c013-0000-7000-8000-0000000000b2';
const PRODUCT_OFF = '0199c013-0000-7000-8000-0000000000b3';
const OTHER_PRODUCT = '0199c013-0000-7000-8000-0000000000b4';
const REL = '0199c013-0000-7000-8000-0000000000e1';
const COUNTER_REL = '0199c013-0000-7000-8000-0000000000e2';
const ENDED_REL = '0199c013-0000-7000-8000-0000000000e3';
const OTHER_REL = '0199c013-0000-7000-8000-0000000000e4';
const ORDER_ID = '0199c013-0000-7000-8000-0000000000c1';
const LINE_1 = '0199c013-0000-7000-8000-0000000000d1';

const REG = new Date('2026-01-01T00:00:00.000Z');

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
      preferredLanguage: 'EN',
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
      id: `0199c013-0000-7000-8000-0000000001${n}0`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

type NoteBody = { id: string; status: string; supplier_note: string | null };

function setNote(body: unknown, orderId = ORDER_ID, personId = SELLER, organizationId = SUPPLIER) {
  return createAuthenticatedRequest(app, personId)
    .patch(`/api/v1/organizations/${organizationId}/orders/${orderId}/note`)
    .send(body as object);
}

async function seedOrder(status: 'PENDING' | 'CONFIRMED' | 'DELIVERED' | 'CANCELLED') {
  await prisma.order.create({
    data: {
      id: ORDER_ID,
      customerRelationshipId: REL,
      enteredById: SELLER,
      placedByParty: status === 'PENDING' ? 'CUSTOMER' : 'SUPPLIER',
      status,
      deliveryCost: 500n,
      totalAmount: 30500n,
      ...(status === 'CANCELLED'
        ? {
            cancelledAt: REG,
            cancelledByParty: 'SUPPLIER',
            cancelledById: SELLER,
            cancellationReason: 'No stock',
          }
        : {}),
      ...(status === 'DELIVERED' ? { deliveredAt: REG, deliveredById: DRIVER } : {}),
      lines: {
        create: {
          id: LINE_1,
          productId: PRODUCT_A,
          labelApplied: 'Rice (sack)',
          quantity: '10',
          referencePrice: 3000n,
          unitPriceApplied: 3000n,
          amount: 30000n,
          ...(status === 'DELIVERED' ? { deliveredQuantity: '10' } : {}),
        },
      },
    },
  });
}

async function storedNote() {
  return (await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } })).supplierNote;
}

async function seedBase() {
  await seedPerson(OWNER, '+237600013001');
  await seedPerson(SELLER, '+237600013003');
  await seedPerson(DRIVER, '+237600013004');
  await seedPerson(CUSTOMER, '+237600013005');
  await seedPerson(OTHER_OWNER, '+237600013006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await seedProduct(prisma, {
    id: PRODUCT_A,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: PRODUCT_B,
    organizationId: SUPPLIER,
    name: 'Salt',
    unit: 'kg',
    price: 500n,
    minOrderQuantity: '5',
  });
  await seedProduct(prisma, {
    id: PRODUCT_OFF,
    organizationId: SUPPLIER,
    name: 'Old',
    unit: 'kg',
    price: 100n,
    status: 'INACTIVE',
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
      deliveryAddress: 'Rue 1',
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: COUNTER_REL,
      supplierOrganizationId: SUPPLIER,
      customerLabel: 'Comptoir',
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 0n,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: ENDED_REL,
      supplierOrganizationId: SUPPLIER,
      customerLabel: 'Old customer',
      customerPersonId: OTHER_OWNER,
      createdById: OWNER,
      status: 'ENDED',
      endedByParty: 'SUPPLIER',
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
}

describe('ORD-015 seller writes a note on an order at any time', () => {
  beforeEach(seedBase);

  it.each(['PENDING', 'CONFIRMED', 'DELIVERED', 'CANCELLED'] as const)(
    'stores the note on a %s order (AC-1)',
    async (status) => {
      await seedOrder(status);

      const response = await setNote({ supplier_note: 'Truck delayed' });

      expect(response.status).toBe(200);
      const body = bodyOf<NoteBody>(response);
      expect(body.supplier_note).toBe('Truck delayed');
      expect(body.status).toBe(status);
      expect(await storedNote()).toBe('Truck delayed');
    }
  );

  it('lets the OWNER write the note too (v5.0.0-8.2.1)', async () => {
    await seedOrder('DELIVERED');

    const response = await setNote({ supplier_note: 'From the owner' }, ORDER_ID, OWNER);

    expect(response.status).toBe(200);
    expect(await storedNote()).toBe('From the owner');
  });

  it('clears the note with null and refuses 2001 characters (AC-2)', async () => {
    await seedOrder('CONFIRMED');
    expect((await setNote({ supplier_note: 'Hello' })).status).toBe(200);

    const cleared = await setNote({ supplier_note: null });
    expect(cleared.status).toBe(200);
    expect(bodyOf<NoteBody>(cleared).supplier_note).toBeNull();
    expect(await storedNote()).toBeNull();

    const max = await setNote({ supplier_note: 'x'.repeat(2000) });
    expect(max.status).toBe(200);

    const tooLong = await setNote({ supplier_note: 'y'.repeat(2001) });
    expect(tooLong.status).toBe(400);
    expect(bodyOf<ErrorBody>(tooLong).error.code).toBe('VALIDATION_ERROR');
    expect(await storedNote()).toBe('x'.repeat(2000));
  });

  it('refuses any other key, a missing note or a non-string note with 400, changing nothing (AC-3, CWE-915)', async () => {
    await seedOrder('CONFIRMED');

    for (const body of [
      { supplier_note: 'Hi', status: 'DELIVERED' },
      { supplier_note: 'Hi', total_amount: 1 },
      { supplier_note: 'Hi', customer_note: 'Hack' },
      { customer_note: 'Hack' },
      {},
      { supplier_note: 12 },
    ]) {
      const response = await setNote(body);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }

    const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER_ID } });
    expect(order.supplierNote).toBeNull();
    expect(order.customerNote).toBeNull();
    expect(order.status).toBe('CONFIRMED');
    expect(order.totalAmount).toBe(30500n);
  });

  it('refuses a DRIVER with 403 (AC-4)', async () => {
    await seedOrder('CONFIRMED');

    const response = await setNote({ supplier_note: 'Nope' }, ORDER_ID, DRIVER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await storedNote()).toBeNull();
  });

  it("answers 404 for another business's order and for an unknown order (AB-1, WSTG-ATHZ-04)", async () => {
    await seedOrder('CONFIRMED');

    const asOther = await setNote({ supplier_note: 'Spy' }, ORDER_ID, OTHER_OWNER, OTHER_ORG);
    expect(asOther.status).toBe(404);
    expect(bodyOf<ErrorBody>(asOther).error.code).toBe('NOT_FOUND');

    const wrongPath = await setNote({ supplier_note: 'Spy' }, ORDER_ID, OTHER_OWNER, SUPPLIER);
    expect(wrongPath.status).toBe(404);

    const unknown = await setNote({ supplier_note: 'Spy' }, '0199c013-0000-7000-8000-0000000000cf');
    expect(unknown.status).toBe(404);
    expect(await storedNote()).toBeNull();
  });
});
