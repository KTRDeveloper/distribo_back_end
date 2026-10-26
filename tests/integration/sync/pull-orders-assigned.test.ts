import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const OWNER = '0199e040-0000-7000-8000-000000000001';
const MANAGER = '0199e040-0000-7000-8000-000000000002';
const SELLER = '0199e040-0000-7000-8000-000000000003';
const DRIVER_A = '0199e040-0000-7000-8000-000000000004';
const DRIVER_B = '0199e040-0000-7000-8000-000000000005';
const CUSTOMER = '0199e040-0000-7000-8000-000000000006';
const ORG = '0199e040-0000-7000-8000-0000000000a1';
const REL = '0199e040-0000-7000-8000-0000000000c1';
const PRODUCT = '0199e040-0000-7000-8000-0000000000d1';
const ORDER = '0199e040-0000-7000-8000-000000000201';
const LINE = '0199e040-0000-7000-8000-000000000291';
const DELIVERY_B = '0199e040-0000-7000-8000-000000000301';
const DELIVERY_A = '0199e040-0000-7000-8000-000000000302';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/pull${query}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const idsOf = (rows: Rows) => rows.map((r) => r['id'] as string).sort();
const arrived = (changes: Changes) => idsOf([...changes.created, ...changes.updated]);

async function seedPerson(id: string, phone: string, name: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: name,
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${name.toLowerCase().replace(/\W/g, '')}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
}

async function seedCollaboration(suffix: string, personId: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e040-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: ORG,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

describe('GET /api/v1/sync/pull (an order assigned to another driver)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER, '+237600004001', 'Owner A');
    await seedPerson(MANAGER, '+237600004002', 'Manager A');
    await seedPerson(SELLER, '+237600004003', 'Seller A');
    await seedPerson(DRIVER_A, '+237600004004', 'Driver A');
    await seedPerson(DRIVER_B, '+237600004005', 'Driver B');
    await seedPerson(CUSTOMER, '+237600004006', 'Customer');
    await prisma.organization.create({ data: { id: ORG, name: 'Org A', createdAt: LONG_AGO } });
    await seedCollaboration('01', OWNER, 'OWNER');
    await seedCollaboration('02', MANAGER, 'MANAGER');
    await seedCollaboration('03', SELLER, 'SELLER');
    await seedCollaboration('04', DRIVER_A, 'DRIVER');
    await seedCollaboration('05', DRIVER_B, 'DRIVER');
    await prisma.customerRelationship.create({
      data: {
        id: REL,
        createdById: SELLER,
        createdAt: LONG_AGO,
        supplierOrganizationId: ORG,
        customerPersonId: CUSTOMER,
        customerLabel: 'Chez Mama',
        creditLimit: 50000n,
        balance: 0n,
      },
    });
    await prisma.product.create({
      data: { id: PRODUCT, organizationId: ORG, name: 'Eau', unit: 'carton', price: 5000n },
    });
    await prisma.order.create({
      data: {
        id: ORDER,
        customerRelationshipId: REL,
        placedByParty: 'SUPPLIER',
        enteredById: SELLER,
        totalAmount: 10000n,
        status: 'CONFIRMED',
        deliveryAddressApplied: 'Rue 1',
        createdAt: LONG_AGO,
        lines: {
          create: {
            id: LINE,
            productVariantId: PRODUCT,
            labelApplied: 'Eau',
            quantity: 2,
            referencePrice: 5000n,
            unitPriceApplied: 5000n,
            amount: 10000n,
          },
        },
      },
    });
  });

  const assignToB = () =>
    prisma.delivery.create({ data: { id: DELIVERY_B, orderId: ORDER, assignedToId: DRIVER_B } });

  it('assigned elsewhere: absent for driver A, present for B and the team (AC-1, CM-38)', async () => {
    await assignToB();

    const driverA = bodyOf<PullBody>(await pull(DRIVER_A));
    expect(driverA.changes['orders'].created).toEqual([]);
    expect(driverA.changes['order_lines'].created).toEqual([]);

    for (const person of [DRIVER_B, OWNER, MANAGER, SELLER]) {
      const body = bodyOf<PullBody>(await pull(person));
      expect(idsOf(body.changes['orders'].created)).toEqual([ORDER]);
      expect(idsOf(body.changes['order_lines'].created)).toEqual([LINE]);
    }
  });

  it('unassigned: the order stays in the pool of driver A (CM-38)', async () => {
    const body = bodyOf<PullBody>(await pull(DRIVER_A));
    expect(idsOf(body.changes['orders'].created)).toEqual([ORDER]);
    expect(idsOf(body.changes['order_lines'].created)).toEqual([LINE]);
  });

  it.each([
    ['marked failed', { failedAt: new Date(), failureReason: 'client absent' }],
    ['removed (deleted_at set)', { deletedAt: new Date() }],
  ])('assignment ends, %s: the order and its lines arrive (AC-2)', async (_name, ending) => {
    await assignToB();
    const first = bodyOf<PullBody>(await pull(DRIVER_A));
    expect(first.changes['orders'].created).toEqual([]);
    await sleep(20);

    await prisma.delivery.update({ where: { id: DELIVERY_B }, data: ending });

    const body = bodyOf<PullBody>(await pull(DRIVER_A, `?last_pulled_at=${first.timestamp}`));
    expect(arrived(body.changes['orders'])).toEqual([ORDER]);
    expect(arrived(body.changes['order_lines'])).toEqual([LINE]);
    const fresh = bodyOf<PullBody>(await pull(DRIVER_A));
    expect(idsOf(fresh.changes['orders'].created)).toEqual([ORDER]);
  });

  it('reassignment: the order moved from B to A arrives for A (AC-3)', async () => {
    await assignToB();
    const first = bodyOf<PullBody>(await pull(DRIVER_A));
    await sleep(20);

    await prisma.delivery.update({ where: { id: DELIVERY_B }, data: { assignedToId: DRIVER_A } });

    const body = bodyOf<PullBody>(await pull(DRIVER_A, `?last_pulled_at=${first.timestamp}`));
    expect(arrived(body.changes['orders'])).toEqual([ORDER]);
    expect(arrived(body.changes['order_lines'])).toEqual([LINE]);
    expect(arrived(body.changes['deliveries'])).toEqual([DELIVERY_B]);
  });

  it('a new delivery to A while B keeps none: the order arrives for A (AC-3)', async () => {
    await assignToB();
    const first = bodyOf<PullBody>(await pull(DRIVER_A));
    await sleep(20);

    await prisma.delivery.update({ where: { id: DELIVERY_B }, data: { deletedAt: new Date() } });
    await prisma.delivery.create({
      data: { id: DELIVERY_A, orderId: ORDER, assignedToId: DRIVER_A },
    });

    const body = bodyOf<PullBody>(await pull(DRIVER_A, `?last_pulled_at=${first.timestamp}`));
    expect(arrived(body.changes['orders'])).toEqual([ORDER]);
  });

  it('kept on the phone: no deleted id when the order is assigned to someone else (AC-4)', async () => {
    const first = bodyOf<PullBody>(await pull(DRIVER_A));
    expect(idsOf(first.changes['orders'].created)).toEqual([ORDER]);
    await sleep(20);

    await assignToB();

    const body = bodyOf<PullBody>(await pull(DRIVER_A, `?last_pulled_at=${first.timestamp}`));
    expect(body.changes['orders'].deleted).toEqual([]);
    expect(body.changes['order_lines'].deleted).toEqual([]);
  });

  it('a delivery change of a seller-side order does not resend the order (regression guard)', async () => {
    await assignToB();
    const first = bodyOf<PullBody>(await pull(SELLER));
    await sleep(20);

    await prisma.delivery.update({ where: { id: DELIVERY_B }, data: { departedAt: new Date() } });

    const body = bodyOf<PullBody>(await pull(SELLER, `?last_pulled_at=${first.timestamp}`));
    expect(body.changes['orders']).toEqual({ created: [], updated: [], deleted: [] });
  });
});
