import { describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { RECEIPT_FIELDS } from '../../helpers/receipt-fields.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0d7-0000-7000-8000-000000000001';
const MANAGER = '0199c0d7-0000-7000-8000-000000000002';
const PAUL = '0199c0d7-0000-7000-8000-000000000004';
const MARIE = '0199c0d7-0000-7000-8000-000000000005';
const CUSTOMER = '0199c0d7-0000-7000-8000-000000000006';
const OTHER_OWNER = '0199c0d7-0000-7000-8000-000000000007';

const SUPPLIER = '0199c0d7-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c0d7-0000-7000-8000-0000000000a2';
const REL = '0199c0d7-0000-7000-8000-0000000000e1';
const OTHER_REL = '0199c0d7-0000-7000-8000-0000000000e3';

const REG = new Date('2026-01-01T00:00:00.000Z');

const orderId = (n: number) => `0199c0d7-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;
const entryId = (n: number) => `0199c0d7-0000-7000-8000-0000000003${String(n).padStart(2, '0')}`;

type Unsettled = {
  items: Array<{
    driver_person_id: string;
    orders: Array<{
      order_id: string;
      customer_label: string | null;
      total_amount: number;
      collected_amount: number;
      unpaid_amount: number;
    }>;
  }>;
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
  role: 'OWNER' | 'MANAGER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c0d7-0000-7000-8000-0000000004${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedBase() {
  await seedPerson(OWNER, '+237600089001');
  await seedPerson(MANAGER, '+237600089002');
  await seedPerson(PAUL, '+237600089004');
  await seedPerson(MARIE, '+237600089005');
  await seedPerson(CUSTOMER, '+237600089006');
  await seedPerson(OTHER_OWNER, '+237600089007');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, MANAGER, 'MANAGER', 2);
  await seedMember(SUPPLIER, PAUL, 'DRIVER', 4);
  await seedMember(SUPPLIER, MARIE, 'DRIVER', 5);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 6);
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      customerLabel: 'Chez Mama',
      createdById: OWNER,
      status: 'ACTIVE',
      creditLimit: 1000000n,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: OTHER_REL,
      supplierOrganizationId: OTHER_ORG,
      customerLabel: 'Other counter',
      createdById: OTHER_OWNER,
      status: 'ACTIVE',
      creditLimit: 0n,
    },
  });
}

/** A DELIVERED order of `total` XAF (carried as delivery cost, so it needs no line). */
async function seedDelivered(
  n: number,
  by: string,
  total: number,
  deliveredAt: Date,
  rel: string = REL
) {
  await prisma.order.create({
    data: {
      id: orderId(n),
      customerRelationshipId: rel,
      enteredById: by,
      placedByParty: 'SUPPLIER',
      status: 'DELIVERED',
      ...RECEIPT_FIELDS,
      deliveredAt,
      deliveredById: by,
      deliveryCost: BigInt(total),
      totalAmount: BigInt(total),
      createdAt: REG,
    },
  });
}

async function seedPayment(
  n: number,
  order: number,
  by: string,
  amount: number,
  reverses?: string,
  rel: string = REL
) {
  await prisma.ledgerEntry.create({
    data: {
      id: entryId(n),
      customerRelationshipId: rel,
      orderId: orderId(order),
      kind: 'PAYMENT',
      amount: BigInt(amount),
      mode: 'CASH',
      reversesEntryId: reverses,
      recordedById: by,
      occurredAt: new Date(),
    },
  });
}

function read(personId: string, query = '', organizationId = SUPPLIER) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${organizationId}/exceptions/unsettled-deliveries${query}`
  );
}

const DAY = '2026-03-10';
const NOON = new Date('2026-03-10T11:00:00.000Z');

describe('DLV-011 owner reviews unsettled deliveries of the day', () => {
  it('groups unsettled orders by driver (AC-1)', async () => {
    await seedBase();
    await seedDelivered(1, PAUL, 30000, NOON);
    await seedPayment(1, 1, PAUL, 30000);
    await seedDelivered(2, PAUL, 30000, NOON);
    await seedPayment(2, 2, PAUL, 20000);
    await seedPayment(3, 2, PAUL, 10000);
    await seedDelivered(3, PAUL, 30000, NOON);
    await seedPayment(4, 3, PAUL, 24000);

    const response = await read(OWNER, `?date=${DAY}`);

    expect(response.status).toBe(200);
    expect(bodyOf<Unsettled>(response)).toEqual({
      items: [
        {
          driver_person_id: PAUL,
          orders: [
            {
              order_id: orderId(3),
              customer_label: 'Chez Mama',
              total_amount: 30000,
              collected_amount: 24000,
              unpaid_amount: 6000,
            },
          ],
        },
      ],
    });
  });

  it('reads the day in the Africa/Douala time zone (AC-2)', async () => {
    await seedBase();
    await seedDelivered(1, PAUL, 1000, new Date('2026-03-09T22:59:59.000Z')); // 23:59 on the 9th
    await seedDelivered(2, PAUL, 1000, new Date('2026-03-09T23:00:00.000Z')); // 00:00 on the 10th
    await seedDelivered(3, PAUL, 1000, new Date('2026-03-10T22:30:00.000Z')); // 23:30 on the 10th
    await seedDelivered(4, PAUL, 1000, new Date('2026-03-10T23:10:00.000Z')); // 00:10 on the 11th

    const response = await read(OWNER, `?date=${DAY}`);

    expect(response.status).toBe(200);
    const orders = bodyOf<Unsettled>(response).items[0]?.orders.map((o) => o.order_id);
    expect(orders?.sort()).toEqual([orderId(2), orderId(3)]);
  });

  it('defaults to today in the Douala time zone (AC-2)', async () => {
    await seedBase();
    await seedDelivered(1, PAUL, 5000, new Date());

    const response = await read(OWNER);

    expect(response.status).toBe(200);
    expect(bodyOf<Unsettled>(response).items[0]?.orders).toMatchObject([
      { order_id: orderId(1), unpaid_amount: 5000 },
    ]);
  });

  it.each([
    ['a MANAGER caller', 403, MANAGER, `?date=${DAY}`, 'FORBIDDEN'],
    ['a DRIVER caller', 403, PAUL, `?date=${DAY}`, 'FORBIDDEN'],
    ['date "31/12/2026"', 400, OWNER, '?date=31%2F12%2F2026', 'VALIDATION_ERROR'],
    ['date "2026-02-30"', 400, OWNER, '?date=2026-02-30', 'VALIDATION_ERROR'],
    ['an unknown query field', 400, OWNER, `?date=${DAY}&driver=${PAUL}`, 'VALIDATION_ERROR'],
  ])('answers %s with %i (AC-3)', async (_case, status, caller, query, code) => {
    await seedBase();

    const response = await read(caller, query);

    expect(response.status).toBe(status);
    expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
  });

  it('leaves out the orders delivered by the owner (AC-4)', async () => {
    await seedBase();
    await seedDelivered(1, OWNER, 9000, NOON);
    await seedDelivered(2, MANAGER, 7000, NOON);

    const response = await read(OWNER, `?date=${DAY}`);

    expect(response.status).toBe(200);
    expect(bodyOf<Unsettled>(response).items).toMatchObject([
      { driver_person_id: MANAGER, orders: [{ order_id: orderId(2), unpaid_amount: 7000 }] },
    ]);
  });

  it('lists a delivery on credit with its full total as unpaid (AB-1)', async () => {
    await seedBase();
    await seedDelivered(1, PAUL, 18000, NOON);

    const response = await read(OWNER, `?date=${DAY}`);

    expect(bodyOf<Unsettled>(response).items[0]?.orders).toEqual([
      {
        order_id: orderId(1),
        customer_label: 'Chez Mama',
        total_amount: 18000,
        collected_amount: 0,
        unpaid_amount: 18000,
      },
    ]);
  });

  it('answers 404 to a member of another business and leaks nothing (AB-2)', async () => {
    await seedBase();
    await seedDelivered(1, PAUL, 18000, NOON);

    const response = await read(OTHER_OWNER, `?date=${DAY}`);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it("does not list another business's deliveries", async () => {
    await seedBase();
    await seedDelivered(1, OTHER_OWNER, 18000, NOON, OTHER_REL);
    await seedDelivered(2, PAUL, 4000, NOON);

    const response = await read(OWNER, `?date=${DAY}`);

    expect(bodyOf<Unsettled>(response).items).toMatchObject([
      { driver_person_id: PAUL, orders: [{ order_id: orderId(2) }] },
    ]);
  });

  it('subtracts a reversed payment from the collected amount', async () => {
    await seedBase();
    await seedDelivered(1, PAUL, 30000, NOON);
    await seedPayment(1, 1, PAUL, 30000);
    await seedPayment(2, 1, OWNER, 30000, entryId(1));
    await seedDelivered(2, MARIE, 10000, NOON);
    await seedPayment(3, 2, MARIE, 10000);
    await seedPayment(4, 2, OWNER, 4000, undefined);

    const response = await read(OWNER, `?date=${DAY}`);

    expect(bodyOf<Unsettled>(response).items).toEqual([
      {
        driver_person_id: PAUL,
        orders: [
          {
            order_id: orderId(1),
            customer_label: 'Chez Mama',
            total_amount: 30000,
            collected_amount: 0,
            unpaid_amount: 30000,
          },
        ],
      },
    ]);
  });
});
