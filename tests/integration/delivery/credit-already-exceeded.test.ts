import { describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { deliverOrder } from '../../../src/modules/delivery/delivery.service.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup.js';

const DRIVER = '0199d017-0000-7000-8000-000000000004';
const OWNER = '0199d017-0000-7000-8000-000000000001';
const CUSTOMER = '0199d017-0000-7000-8000-000000000006';
const SUPPLIER = '0199d017-0000-7000-8000-0000000000a1';
const PRODUCT = '0199d017-0000-7000-8000-0000000000b1';
const REL = '0199d017-0000-7000-8000-0000000000e1';
const ORDER = '0199d017-0000-7000-8000-000000000110';
const LINE = '0199d017-0000-7000-8000-000000000210';
const DELIVERY = '0199d017-0000-7000-8000-000000000310';
const GESTURE = '0199d017-0000-7000-8000-000000000510';
const SALE = '0199d017-0000-7000-8000-000000000610';
const PAYMENT = '0199d017-0000-7000-8000-000000000710';

const REG = new Date('2026-01-01T00:00:00.000Z');

type DeliverBody = { order: { status: string } };

/** A driver, a customer with the given balance and limit, and an IN_DELIVERY order of `total` francs. */
async function seed(balance: bigint, limit: bigint | null, total: bigint) {
  for (const [id, phone] of [
    [OWNER, '+237600117001'],
    [DRIVER, '+237600117004'],
    [CUSTOMER, '+237600117006'],
  ]) {
    await prisma.person.create({
      data: {
        id: id,
        fullName: 'Fixture Person',
        phoneNumber: phone,
        phoneVerifiedAt: REG,
        passwordHash: 'test-password-hash',
        registeredAt: REG,
      },
    });
  }
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  for (const [n, personId, role] of [
    ['1', OWNER, 'OWNER'],
    ['4', DRIVER, 'DRIVER'],
  ] as const) {
    await prisma.collaboration.create({
      data: {
        id: `0199d017-0000-7000-8000-0000000004${n}f`,
        personId,
        organizationId: SUPPLIER,
        role,
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  }
  await seedProduct(prisma, {
    id: PRODUCT,
    organizationId: SUPPLIER,
    name: 'Rice',
    unit: 'sack',
    price: 10000n,
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
      balance,
      creditLimit: limit,
    },
  });
  await prisma.order.create({
    data: {
      id: ORDER,
      customerRelationshipId: REL,
      enteredById: DRIVER,
      placedByParty: 'SUPPLIER',
      status: 'IN_DELIVERY',
      deliveryAddressApplied: 'Street 1',
      deliveryCost: 0n,
      totalAmount: total,
      lines: {
        create: {
          id: LINE,
          productVariantId: PRODUCT,
          labelApplied: 'Rice (sack)',
          quantity: String(total / 10000n),
          referencePrice: 10000n,
          unitPriceApplied: 10000n,
          amount: total,
        },
      },
    },
  });
  await prisma.delivery.create({
    data: {
      id: DELIVERY,
      orderId: ORDER,
      assignedToId: DRIVER,
      departedAt: new Date(Date.UTC(2026, 6, 1, 8)),
    },
  });
}

function body(collected: number) {
  return {
    id: GESTURE,
    collected_amount: collected,
    ...(collected > 0 ? { mode: 'CASH', payment_entry_id: PAYMENT } : {}),
    sale_entry_id: SALE,
  };
}

function deliver(collected: number) {
  return createAuthenticatedRequest(app, DRIVER)
    .post(`/api/v1/organizations/${SUPPLIER}/orders/${ORDER}/deliver`)
    .send(body(collected));
}

async function balanceOf() {
  return (await prisma.customerRelationship.findUniqueOrThrow({ where: { id: REL } })).balance;
}

async function expectNothingWritten() {
  expect((await prisma.order.findUniqueOrThrow({ where: { id: ORDER } })).status).toBe(
    'IN_DELIVERY'
  );
  expect(await prisma.ledgerEntry.count()).toBe(0);
  expect(await prisma.orderLine.count({ where: { deliveredQuantity: { not: null } } })).toBe(0);
}

async function expectRefusal(collected: number, minCollect: number) {
  const response = await deliver(collected);
  expect(response.status).toBe(409);
  const error = bodyOf<ErrorBody>(response).error;
  expect(error.code).toBe('CREDIT_INSUFFICIENT');
  expect(error.details).toEqual({ min_collect: minCollect });
  await expectNothingWritten();
}

describe('DLV-017 a delivery paid in full when the limit is already exceeded', () => {
  it.each([
    [120000n, 100000n, 10000n, 10000, 120000n],
    [90000n, 100000n, 30000n, 20000, 100000n],
    [-20000n, 0n, 30000n, 10000, 0n],
  ])(
    'accepts balance %s, limit %s, total %s, collected %i with the balance ending at %s (AC-1)',
    async (balance, limit, total, collected, finalBalance) => {
      await seed(balance, limit, total);

      const response = await deliver(collected);

      expect(response.status).toBe(200);
      expect(bodyOf<DeliverBody>(response).order.status).toBe('DELIVERED');
      expect(await balanceOf()).toBe(finalBalance);
    }
  );

  it('refuses 9999 collected above the limit and names the minimum (AC-1, AC-2)', async () => {
    await seed(120000n, 100000n, 10000n);

    await expectRefusal(9999, 10000);
  });

  it('keeps the delivery through sync with an overrun of 1 (AC-1)', async () => {
    await seed(120000n, 100000n, 10000n);

    const result = await deliverOrder(
      { personId: DRIVER, organizationId: SUPPLIER, role: 'DRIVER' },
      ORDER,
      { id: GESTURE, collected_amount: 0, sale_entry_id: SALE },
      { viaSync: true, payments: [{ id: PAYMENT, amount: 9999n, mode: 'CASH' }] }
    );

    expect(result.order.status).toBe('DELIVERED');
    expect(result.creditExceededBy).toBe(1);
    expect(await balanceOf()).toBe(120001n);
  });

  it('keeps the minimum of a customer under the limit (AC-3)', async () => {
    await seed(40000n, 50000n, 30000n);

    await expectRefusal(19999, 20000);
  });

  it('refuses an unpaid sale to a customer above the limit (AB-1, WSTG-BUSL-01)', async () => {
    await seed(120000n, 100000n, 10000n);

    await expectRefusal(0, 10000);
  });
});
