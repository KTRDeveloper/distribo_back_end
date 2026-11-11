import { describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { deliverOrder } from '../../../src/modules/delivery/delivery.service.js';
import { bodyOf } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup.js';

const OWNER = '0199d019-0000-7000-8000-000000000001';
const SELLER = '0199d019-0000-7000-8000-000000000003';
const DRIVER = '0199d019-0000-7000-8000-000000000004';
const CUSTOMER = '0199d019-0000-7000-8000-000000000006';
const CUSTOMER_OWNER = '0199d019-0000-7000-8000-000000000007';

const SUPPLIER = '0199d019-0000-7000-8000-0000000000a1';
const CUSTOMER_ORG = '0199d019-0000-7000-8000-0000000000a2';
const PRODUCT = '0199d019-0000-7000-8000-0000000000b1';
const REL = '0199d019-0000-7000-8000-0000000000e1';
const COUNTER = '0199d019-0000-7000-8000-0000000000e2';

const REG = new Date('2026-01-01T00:00:00.000Z');

const orderId = (n: number) => `0199d019-0000-7000-8000-0000000001${n}0`;
const lineId = (n: number) => `0199d019-0000-7000-8000-0000000002${n}0`;
const deliveryId = (n: number) => `0199d019-0000-7000-8000-0000000003${n}0`;
const gestureId = (n: number) => `0199d019-0000-7000-8000-0000000005${n}0`;
const saleId = (n: number) => `0199d019-0000-7000-8000-0000000006${n}0`;
const paymentId = (n: number) => `0199d019-0000-7000-8000-0000000007${n}0`;

async function seedPerson(id: string, phone: string, fullName: string | null) {
  await prisma.person.create({
    data: {
      id,
      fullName,
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      // A person without a full name is a guest: only a registered person must have one.
      ...(fullName === null ? {} : { passwordHash: 'test-password-hash', registeredAt: REG }),
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
      id: `0199d019-0000-7000-8000-0000000004${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

/** An order of 3 sacks at 10 000 (total 30 000) on `relationship`. */
async function seedOrder(
  n: number,
  status: 'CONFIRMED' | 'IN_DELIVERY' | 'CANCELLED',
  relationship = REL
) {
  await prisma.order.create({
    data: {
      id: orderId(n),
      customerRelationshipId: relationship,
      enteredById: SELLER,
      placedByParty: 'SUPPLIER',
      status,
      ...(status === 'CANCELLED'
        ? {
            cancelledByParty: 'SUPPLIER' as const,
            cancelledById: OWNER,
            cancelledAt: REG,
            cancellationReason: 'Out of stock',
          }
        : {}),
      deliveryAddressApplied: `Street ${n}`,
      deliveryCost: 0n,
      totalAmount: 30000n,
      createdAt: new Date(Date.UTC(2026, 5, n)),
      lines: {
        create: {
          id: lineId(n),
          productVariantId: PRODUCT,
          labelApplied: 'Rice (sack)',
          quantity: '3',
          referencePrice: 10000n,
          unitPriceApplied: 10000n,
          amount: 30000n,
        },
      },
    },
  });
  if (status === 'IN_DELIVERY') {
    await prisma.delivery.create({
      data: {
        id: deliveryId(n),
        orderId: orderId(n),
        assignedToId: DRIVER,
        departedAt: new Date(Date.UTC(2026, 6, 1, 8)),
      },
    });
  }
}

/**
 * Supplier "Supplier Name" with an owner, a seller and a driver; a customer person without a
 * full name, labelled "Mama du marché"; a business customer "Customer Business" with a balance
 * of 40 000 (relationship REL); a counter.
 */
async function seedBase(customer: 'ORG' | 'PERSON_NAMED' | 'PERSON_UNNAMED' = 'ORG') {
  await seedPerson(OWNER, '+237600091001', 'Owner');
  await seedPerson(SELLER, '+237600091003', 'Seller');
  await seedPerson(DRIVER, '+237600091004', 'Driver');
  await seedPerson(CUSTOMER, '+237600091006', customer === 'PERSON_NAMED' ? 'Awa Kone' : null);
  await seedPerson(CUSTOMER_OWNER, '+237600091007', 'Customer Owner');
  await prisma.organization.create({
    data: { id: SUPPLIER, name: 'Supplier Name', status: 'ACTIVE' },
  });
  await prisma.organization.create({
    data: { id: CUSTOMER_ORG, name: 'Customer Business', status: 'ACTIVE' },
  });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
  await seedMember(CUSTOMER_ORG, CUSTOMER_OWNER, 'OWNER', 7);
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
      ...(customer === 'ORG'
        ? { customerOrganizationId: CUSTOMER_ORG }
        : { customerPersonId: CUSTOMER, customerLabel: 'Mama du marché' }),
      createdById: OWNER,
      status: 'ACTIVE',
      balance: 40000n,
      creditLimit: 200000n,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: COUNTER,
      supplierOrganizationId: SUPPLIER,
      customerLabel: 'Counter',
      createdById: OWNER,
      status: 'ACTIVE',
      balance: 5000n,
      creditLimit: 0n,
    },
  });
}

function deliver(personId: string, order: number, body: Record<string, unknown>) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${SUPPLIER}/orders/${orderId(order)}/deliver`)
    .send(body);
}

function paidBody(n: number, collected: number, extra: Record<string, unknown> = {}) {
  return {
    id: gestureId(n),
    collected_amount: collected,
    ...(collected > 0 ? { mode: 'CASH', payment_entry_id: paymentId(n) } : {}),
    sale_entry_id: saleId(n),
    ...extra,
  };
}

const receiptOf = async (order: number) => {
  const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId(order) } });
  return {
    supplierNameApplied: row.supplierNameApplied,
    customerNameApplied: row.customerNameApplied,
    collectedApplied: row.collectedApplied,
    balanceAfterApplied: row.balanceAfterApplied,
  };
};

const balanceOf = async (id = REL) =>
  (await prisma.customerRelationship.findUniqueOrThrow({ where: { id } })).balance;

describe('DLV-019 a delivery writes its receipt once', () => {
  it('online: four values; the balance equals the one read afterwards (AC-1)', async () => {
    await seedBase();
    await seedOrder(1, 'IN_DELIVERY');

    const response = await deliver(DRIVER, 1, paidBody(1, 25000));

    expect(response.status).toBe(200);
    expect(await receiptOf(1)).toEqual({
      supplierNameApplied: 'Supplier Name',
      customerNameApplied: 'Customer Business',
      collectedApplied: 25000n,
      balanceAfterApplied: 45000n,
    });
    expect(await balanceOf()).toBe(45000n);
  });

  it.each([
    ['PERSON_NAMED', 'Awa Kone'],
    ['PERSON_UNNAMED', null],
  ] as const)('names: customer %s gives %s, never customer_label (AC-2)', async (kind, name) => {
    await seedBase(kind);
    await seedOrder(1, 'IN_DELIVERY');

    await deliver(DRIVER, 1, paidBody(1, 30000));

    expect((await receiptOf(1)).customerNameApplied).toBe(name);
  });

  it('counter: null name, collected = total, balance of the counter (AC-3)', async () => {
    await seedBase();

    const response = await createAuthenticatedRequest(app, SELLER)
      .post(`/api/v1/organizations/${SUPPLIER}/counters/${COUNTER}/sales`)
      .send({
        id: gestureId(2),
        sale_entry_id: saleId(2),
        payment_entry_id: paymentId(2),
        lines: [{ id: lineId(2), product_variant_id: PRODUCT, quantity: '1.2' }],
        collected_amount: 12000,
        mode: 'CASH',
      });

    expect(response.status).toBe(201);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: gestureId(2) } });
    expect(row).toMatchObject({
      supplierNameApplied: 'Supplier Name',
      customerNameApplied: null,
      collectedApplied: 12000n,
      balanceAfterApplied: 5000n,
    });
    expect(await balanceOf(COUNTER)).toBe(5000n);
  });

  it('sync: a CONFIRMED and a CANCELLED order both get the fields (AC-4)', async () => {
    await seedBase();
    await seedOrder(3, 'CONFIRMED');
    await seedOrder(5, 'CANCELLED');
    const actor = { personId: SELLER, organizationId: SUPPLIER, role: 'SELLER' } as const;

    await deliverOrder(actor, orderId(3), paidBody(3, 0), {
      viaSync: true,
      payments: [{ id: paymentId(3), amount: 10000n, mode: 'CASH' }],
    });
    await deliverOrder(actor, orderId(5), paidBody(5, 0), {
      viaSync: true,
      payments: [{ id: paymentId(5), amount: 30000n, mode: 'CASH' }],
    });

    expect(await receiptOf(3)).toEqual({
      supplierNameApplied: 'Supplier Name',
      customerNameApplied: 'Customer Business',
      collectedApplied: 10000n,
      balanceAfterApplied: 60000n,
    });
    expect(await receiptOf(5)).toEqual({
      supplierNameApplied: 'Supplier Name',
      customerNameApplied: 'Customer Business',
      collectedApplied: 30000n,
      balanceAfterApplied: 60000n,
    });
    expect(await balanceOf()).toBe(60000n);
  });

  it('once: a repeat after a rename keeps the first values, online and through sync (AC-5)', async () => {
    await seedBase();
    await seedOrder(1, 'IN_DELIVERY');
    await seedOrder(3, 'CONFIRMED');
    const actor = { personId: SELLER, organizationId: SUPPLIER, role: 'SELLER' } as const;
    const syncInput = paidBody(3, 0);
    const syncOptions = {
      viaSync: true,
      payments: [{ id: paymentId(3), amount: 10000n, mode: 'CASH' as const }],
    };
    await deliver(DRIVER, 1, paidBody(1, 25000));
    await deliverOrder(actor, orderId(3), syncInput, syncOptions);
    const firstOnline = await receiptOf(1);
    const firstSync = await receiptOf(3);

    await prisma.organization.update({ where: { id: SUPPLIER }, data: { name: 'Renamed' } });
    await prisma.organization.update({ where: { id: CUSTOMER_ORG }, data: { name: 'Renamed C' } });
    const repeat = await deliver(DRIVER, 1, paidBody(1, 25000));
    await deliverOrder(actor, orderId(3), syncInput, syncOptions);

    expect(repeat.status).toBe(200);
    expect(await receiptOf(1)).toEqual(firstOnline);
    expect(await receiptOf(3)).toEqual(firstSync);
    expect(firstOnline.supplierNameApplied).toBe('Supplier Name');
  });

  it.each([
    ['collected_applied', 25000],
    ['supplier_name_applied', 'Fake'],
    ['customer_name_applied', 'Fake'],
    ['balance_after_applied', 1],
  ])('phone receipt: %s in the deliver body is refused (AB-1)', async (field, value) => {
    await seedBase();
    await seedOrder(1, 'IN_DELIVERY');

    const response = await deliver(DRIVER, 1, paidBody(1, 25000, { [field]: value }));

    expect(response.status).toBe(400);
    expect(bodyOf<{ error: { code: string } }>(response).error.code).toBe('VALIDATION_ERROR');
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: orderId(1) } });
    expect(stored.status).toBe('IN_DELIVERY');
    expect(await receiptOf(1)).toEqual({
      supplierNameApplied: null,
      customerNameApplied: null,
      collectedApplied: null,
      balanceAfterApplied: null,
    });
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });
});
