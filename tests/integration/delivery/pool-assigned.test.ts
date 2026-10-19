import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0e0-0000-7000-8000-000000000001';
const MANAGER = '0199c0e0-0000-7000-8000-000000000002';
const SELLER = '0199c0e0-0000-7000-8000-000000000003';
const DRIVER_A = '0199c0e0-0000-7000-8000-000000000004';
const DRIVER_B = '0199c0e0-0000-7000-8000-000000000005';
const CUSTOMER = '0199c0e0-0000-7000-8000-000000000006';

const SUPPLIER = '0199c0e0-0000-7000-8000-0000000000a1';
const PRODUCT = '0199c0e0-0000-7000-8000-0000000000b1';
const REL = '0199c0e0-0000-7000-8000-0000000000e1';
const ORDER_1 = '0199c0e0-0000-7000-8000-000000000110';
const ORDER_2 = '0199c0e0-0000-7000-8000-000000000120';
const DELIVERY_1 = '0199c0e0-0000-7000-8000-000000000310';
const GESTURE = '0199c0e0-0000-7000-8000-000000000510';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Page = { items: { order_id: string }[]; next_cursor: string | null };

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
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  n: number
) {
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

async function seedOrder(id: string, lineId: string, day: number) {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: REL,
      enteredById: SELLER,
      placedByParty: 'SUPPLIER',
      status: 'CONFIRMED',
      deliveryAddressApplied: 'Street 1',
      deliveryCost: 0n,
      totalAmount: 3000n,
      createdAt: new Date(Date.UTC(2026, 5, day)),
      lines: {
        create: {
          id: lineId,
          productId: PRODUCT,
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

/** Order 1 (the one under test) and order 2 (never assigned) are both in the pool. */
async function seedBase() {
  await seedPerson(OWNER, '+237600085001');
  await seedPerson(MANAGER, '+237600085002');
  await seedPerson(SELLER, '+237600085003');
  await seedPerson(DRIVER_A, '+237600085004');
  await seedPerson(DRIVER_B, '+237600085005');
  await seedPerson(CUSTOMER, '+237600085006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await seedMember(OWNER, 'OWNER', 1);
  await seedMember(MANAGER, 'MANAGER', 2);
  await seedMember(SELLER, 'SELLER', 3);
  await seedMember(DRIVER_A, 'DRIVER', 4);
  await seedMember(DRIVER_B, 'DRIVER', 5);
  await prisma.product.create({
    data: { id: PRODUCT, organizationId: SUPPLIER, name: 'Rice', unit: 'sack', price: 1500n },
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
  await seedOrder(ORDER_1, '0199c0e0-0000-7000-8000-000000000210', 1);
  await seedOrder(ORDER_2, '0199c0e0-0000-7000-8000-000000000220', 2);
}

async function assignTo(driverId: string, extra: { failedAt?: Date; deletedAt?: Date } = {}) {
  await prisma.delivery.create({
    data: {
      id: DELIVERY_1,
      orderId: ORDER_1,
      assignedToId: driverId,
      failedAt: extra.failedAt ?? null,
      failureReason: extra.failedAt ? 'Customer absent' : null,
      deletedAt: extra.deletedAt ?? null,
    },
  });
}

async function poolIds(personId: string): Promise<string[]> {
  const response = await createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${SUPPLIER}/deliveries/to-deliver`
  );
  expect(response.status).toBe(200);
  return bodyOf<Page>(response).items.map((item) => item.order_id);
}

describe('DLV-013 an assigned order leaves the pool of the other drivers', () => {
  beforeEach(seedBase);

  it('hides the order from driver A and keeps it for driver B (AC-1, CM-38)', async () => {
    await assignTo(DRIVER_B);

    expect(await poolIds(DRIVER_A)).toEqual([ORDER_2]);
    expect(await poolIds(DRIVER_B)).toEqual([ORDER_2, ORDER_1]);
  });

  it.each([
    ['the owner', OWNER, true],
    ['a manager', MANAGER, true],
    ['a seller', SELLER, true],
    ['another driver', DRIVER_A, false],
  ])('%s: the assigned order is listed = %s (AC-2, CM-38)', async (_label, viewer, listed) => {
    await assignTo(DRIVER_B);

    expect((await poolIds(viewer)).includes(ORDER_1)).toBe(listed);
  });

  it.each([
    ['failed', { failedAt: new Date('2026-07-01T08:00:00.000Z') }],
    ['removed', { deletedAt: new Date('2026-07-01T08:00:00.000Z') }],
  ])(
    'puts the order back in the pool when the assignment is %s (AC-3, CM-38)',
    async (_s, extra) => {
      await assignTo(DRIVER_B, extra);

      expect(await poolIds(DRIVER_A)).toContain(ORDER_1);
    }
  );

  it('moves the order from driver B to driver A on a manager reassignment (AC-4)', async () => {
    await assignTo(DRIVER_B);
    expect(await poolIds(DRIVER_A)).not.toContain(ORDER_1);

    const response = await createAuthenticatedRequest(app, MANAGER)
      .post(`/api/v1/organizations/${SUPPLIER}/orders/${ORDER_1}/assign`)
      .send({ id: GESTURE, driver_person_id: DRIVER_A });
    expect(response.status).toBe(201);

    expect(await poolIds(DRIVER_A)).toContain(ORDER_1);
    expect(await poolIds(DRIVER_B)).not.toContain(ORDER_1);
  });

  it('still lists, for driver A, an order assigned to A itself', async () => {
    await assignTo(DRIVER_A);

    expect(await poolIds(DRIVER_A)).toContain(ORDER_1);
  });
});
