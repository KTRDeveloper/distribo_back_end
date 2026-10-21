import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { findDriversWithOpenDeliveries } from '../../../src/modules/delivery/delivery.repository';

const ORG_ID = '0199d015-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199d015-0000-7000-8000-000000000002';
const DRIVER_A = '0199d015-0000-7000-8000-000000000011';
const DRIVER_B = '0199d015-0000-7000-8000-000000000012';
const RELATIONSHIP_ID = '0199d015-0000-7000-8000-000000000021';
const OTHER_RELATIONSHIP_ID = '0199d015-0000-7000-8000-000000000022';
const ORDER_ID = '0199d015-0000-7000-8000-000000000031';
const DELIVERY_ID = '0199d015-0000-7000-8000-000000000041';
const DEPARTED_AT = new Date('2026-01-01T10:00:00.000Z');
const ENDED_AT = new Date('2026-01-01T11:00:00.000Z');

beforeEach(async () => {
  await prisma.person.createMany({
    data: [
      {
        id: DRIVER_A,
        fullName: 'Fixture Driver',
        phoneNumber: '+2250700015011',
        phoneVerifiedAt: DEPARTED_AT,
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
        registeredAt: DEPARTED_AT,
        preferredLanguage: 'FR',
      },
      { id: DRIVER_B, phoneNumber: '+2250700015012' },
    ],
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO organizations (id, name)
      VALUES (${ORG_ID}::uuid, 'Fixture Business'),
             (${OTHER_ORG_ID}::uuid, 'Fixture Other Business')
    `;
    await tx.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status)
      VALUES ('0199d015-0000-7000-8000-000000000051'::uuid,
              ${DRIVER_A}::uuid, ${ORG_ID}::uuid, 'OWNER', 'ACTIVE'),
             ('0199d015-0000-7000-8000-000000000052'::uuid,
              ${DRIVER_A}::uuid, ${OTHER_ORG_ID}::uuid, 'OWNER', 'ACTIVE')
    `;
  });
  await prisma.customerRelationship.createMany({
    data: [
      {
        id: RELATIONSHIP_ID,
        supplierOrganizationId: ORG_ID,
        customerPersonId: DRIVER_B,
        createdById: DRIVER_A,
      },
      {
        id: OTHER_RELATIONSHIP_ID,
        supplierOrganizationId: OTHER_ORG_ID,
        customerPersonId: DRIVER_B,
        createdById: DRIVER_A,
      },
    ],
  });
  await prisma.order.create({
    data: {
      id: ORDER_ID,
      customerRelationshipId: RELATIONSHIP_ID,
      enteredById: DRIVER_A,
      placedByParty: 'SUPPLIER',
      status: 'CONFIRMED',
      totalAmount: 0n,
    },
  });
});

async function seedDelivery(overrides: Partial<Prisma.DeliveryUncheckedCreateInput> = {}) {
  return prisma.delivery.create({
    data: {
      id: DELIVERY_ID,
      orderId: ORDER_ID,
      assignedToId: DRIVER_A,
      departedAt: DEPARTED_AT,
      ...overrides,
    },
  });
}

function findDrivers(personIds = [DRIVER_A, DRIVER_B]) {
  return prisma.$transaction((tx) => findDriversWithOpenDeliveries(tx, ORG_ID, personIds));
}

describe('findDriversWithOpenDeliveries', () => {
  it('on the road', async () => {
    await seedDelivery();
    expect(await findDrivers()).toEqual(new Set([DRIVER_A]));
  });

  it.each([
    ['assigned but not departed', { departedAt: null }],
    ['arrived', { arrivedAt: ENDED_AT }],
    ['failed', { failedAt: ENDED_AT, failureReason: 'Fixture failure' }],
    ['deleted', { deletedAt: ENDED_AT }],
  ] satisfies Array<[string, Partial<Prisma.DeliveryUncheckedCreateInput>]>)(
    'not on the road: %s',
    async (_name, overrides) => {
      await seedDelivery(overrides);
      expect(await findDrivers()).toEqual(new Set());
    }
  );

  it('not on the road: of another business\'s order', async () => {
    await prisma.order.update({
      where: { id: ORDER_ID },
      data: { customerRelationshipId: OTHER_RELATIONSHIP_ID },
    });
    await seedDelivery();
    expect(await findDrivers()).toEqual(new Set());
  });

  it('nobody returns an empty set without querying deliveries', async () => {
    await seedDelivery();
    await prisma.$transaction(async (tx) => {
      const noQueries = new Proxy(tx, {
        get() {
          throw new Error('Empty input must not access the transaction');
        },
      });
      expect(await findDriversWithOpenDeliveries(noQueries, ORG_ID, [])).toEqual(new Set());
    });
  });

  it('excludes deliveries of a deleted order', async () => {
    await seedDelivery();
    await prisma.order.update({ where: { id: ORDER_ID }, data: { deletedAt: ENDED_AT } });
    expect(await findDrivers()).toEqual(new Set());
  });

  it('excludes a driver not in the requested people', async () => {
    await seedDelivery();
    expect(await findDrivers([DRIVER_B])).toEqual(new Set());
  });
});
