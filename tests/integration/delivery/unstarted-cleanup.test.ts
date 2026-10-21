import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0e0-0000-7000-8000-000000000001';
const SELLER = '0199c0e0-0000-7000-8000-000000000002';
const DRIVER = '0199c0e0-0000-7000-8000-000000000003';
const CUSTOMER = '0199c0e0-0000-7000-8000-000000000004';

const SUPPLIER = '0199c0e0-0000-7000-8000-0000000000a1';
const PRODUCT = '0199c0e0-0000-7000-8000-0000000000b1';
const REL = '0199c0e0-0000-7000-8000-0000000000e1';

const REG = new Date('2026-01-01T00:00:00.000Z');
const DEPARTED = new Date('2026-07-01T08:00:00.000Z');

const orderId = (n: number) => `0199c0e0-0000-7000-8000-0000000001${n}0`;
const lineId = (n: number) => `0199c0e0-0000-7000-8000-0000000002${n}0`;
const deliveryId = (n: number) => `0199c0e0-0000-7000-8000-000000003${String(n).padStart(2, '0')}0`;
const gestureId = (n: number) => `0199c0e0-0000-7000-8000-0000000005${n}0`;
const paymentId = (n: number) => `0199c0e0-0000-7000-8000-0000000007${n}0`;
const saleId = (n: number) => `0199c0e0-0000-7000-8000-0000000006${n}0`;

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

async function seedMember(personId: string, role: 'OWNER' | 'SELLER' | 'DRIVER', n: number) {
  await prisma.collaboration.create({
    data: {
      id: `0199c0e0-0000-7000-8000-0000000004${n}f`,
      personId,
      organizationId: SUPPLIER,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

/** A CONFIRMED order of 3 sacks at 10 000 (total 30 000) on the supplier's relationship. */
async function seedOrder(n: number, status: 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED') {
  await prisma.order.create({
    data: {
      id: orderId(n),
      customerRelationshipId: REL,
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
          productId: PRODUCT,
          labelApplied: 'Rice (sack)',
          quantity: '3',
          referencePrice: 10000n,
          unitPriceApplied: 10000n,
          amount: 30000n,
        },
      },
    },
  });
}

async function seedDelivery(
  n: number,
  order: number,
  data: { departedAt?: Date; failedAt?: Date; failureReason?: string } = {}
) {
  await prisma.delivery.create({
    data: { id: deliveryId(n), orderId: orderId(order), assignedToId: DRIVER, ...data },
  });
}

async function deletedAtOf(n: number) {
  return (await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId(n) } })).deletedAt;
}

function supplierCancel(order: number, personId = SELLER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${SUPPLIER}/orders/${orderId(order)}/cancel`)
    .send({ id: gestureId(order), reason: 'Out of stock' });
}

function customerCancel(order: number) {
  return createAuthenticatedRequest(app, CUSTOMER)
    .post(`/api/v1/orders/${orderId(order)}/cancel`)
    .send({ id: gestureId(order) });
}

function shopDeliver(order: number, collected = 30000) {
  return createAuthenticatedRequest(app, SELLER)
    .post(`/api/v1/organizations/${SUPPLIER}/orders/${orderId(order)}/deliver`)
    .send({
      id: gestureId(order),
      collected_amount: collected,
      ...(collected > 0 ? { mode: 'CASH', payment_entry_id: paymentId(order) } : {}),
      sale_entry_id: saleId(order),
    });
}

describe('DLV-010 unstarted deliveries are dropped with their order', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600110001');
    await seedPerson(SELLER, '+237600110002');
    await seedPerson(DRIVER, '+237600110003');
    await seedPerson(CUSTOMER, '+237600110004');
    await prisma.organization.create({
      data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' },
    });
    await seedMember(OWNER, 'OWNER', 1);
    await seedMember(SELLER, 'SELLER', 2);
    await seedMember(DRIVER, 'DRIVER', 3);
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
      },
    });
  });

  it('removes the unstarted delivery when the supplier cancels (AC-1, C-22)', async () => {
    await seedOrder(1);
    await seedDelivery(1, 1);

    const response = await supplierCancel(1);

    expect(response.status).toBe(200);
    expect(await deletedAtOf(1)).not.toBeNull();
  });

  it('removes the unstarted delivery when the customer cancels (AC-1, C-22)', async () => {
    await seedOrder(2);
    await seedDelivery(2, 2);

    const response = await customerCancel(2);

    expect(response.status).toBe(200);
    expect(await deletedAtOf(2)).not.toBeNull();
  });

  it('removes the unstarted delivery when a SELLER delivers in the shop (AC-2, C-22)', async () => {
    await seedOrder(3);
    await seedDelivery(3, 3);

    const response = await shopDeliver(3);

    expect(response.status).toBe(200);
    expect(await deletedAtOf(3)).not.toBeNull();
  });

  it('keeps a departed delivery and a failed one, drops only the unstarted one (AC-3)', async () => {
    await seedOrder(4);
    await seedDelivery(4, 4, { departedAt: DEPARTED, failedAt: DEPARTED, failureReason: 'Closed' });
    await seedDelivery(5, 4);
    await seedOrder(5);
    await seedDelivery(6, 5, { departedAt: DEPARTED });

    expect((await supplierCancel(4)).status).toBe(200);
    expect((await supplierCancel(5)).status).toBe(200);

    expect(await deletedAtOf(4)).toBeNull();
    expect(await deletedAtOf(5)).not.toBeNull();
    expect(await deletedAtOf(6)).toBeNull();
  });

  it('keeps a failed delivery when the order is delivered in the shop (AC-3)', async () => {
    await seedOrder(6);
    await seedDelivery(7, 6, { departedAt: DEPARTED, failedAt: DEPARTED, failureReason: 'Closed' });
    await seedDelivery(8, 6);

    expect((await shopDeliver(6)).status).toBe(200);

    expect(await deletedAtOf(7)).toBeNull();
    expect(await deletedAtOf(8)).not.toBeNull();
  });

  it('leaves the delivery untouched when the status change is refused (AC-4, CWE-362)', async () => {
    await seedOrder(7, 'CANCELLED');
    await seedDelivery(9, 7);

    const response = await supplierCancel(7);

    expect(response.status).toBe(409);
    expect(await deletedAtOf(9)).toBeNull();
  });

  it('leaves the delivery untouched when a shop delivery is refused (AC-4, CWE-362)', async () => {
    await seedOrder(8);
    await seedDelivery(10, 8);

    const response = await shopDeliver(8, 0);

    expect(response.status).toBe(409);
    expect(await deletedAtOf(10)).toBeNull();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId(8) } })).status).toBe(
      'CONFIRMED'
    );
  });

  it('does not touch the deliveries of another order (C-22)', async () => {
    await seedOrder(1);
    await seedOrder(2);
    await seedDelivery(1, 1);
    await seedDelivery(2, 2);

    expect((await supplierCancel(1)).status).toBe(200);

    expect(await deletedAtOf(1)).not.toBeNull();
    expect(await deletedAtOf(2)).toBeNull();
  });
});
