import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f4-0000-7000-8000-000000000001';
const MANAGER = '0199c0f4-0000-7000-8000-000000000002';
const SELLER = '0199c0f4-0000-7000-8000-000000000003';
const DRIVER = '0199c0f4-0000-7000-8000-000000000004';
const CUSTOMER = '0199c0f4-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c0f4-0000-7000-8000-000000000006';
const SUPPLIER_PERSON = '0199c0f4-0000-7000-8000-000000000007';
const CUSTOMER_2 = '0199c0f4-0000-7000-8000-000000000008';

const SUPPLIER = '0199c0f4-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c0f4-0000-7000-8000-0000000000a2';

const REL = '0199c0f4-0000-7000-8000-0000000000e1';
const OTHER_REL = '0199c0f4-0000-7000-8000-0000000000e2';
const COUNTER_REL = '0199c0f4-0000-7000-8000-0000000000e3';
const ENDED_REL = '0199c0f4-0000-7000-8000-0000000000e4';
const PENDING_REL = '0199c0f4-0000-7000-8000-0000000000e5';

const REG = new Date('2026-01-01T00:00:00.000Z');
const PENDING_CHECK = 'customer_relationships_pending_iff_supplier_person_check';

const gestureId = (n: number) => `0199c0f4-0000-7000-8000-0000000005${String(n).padStart(2, '0')}`;

type PaymentBody = {
  id: string;
  kind: string;
  amount: number;
  mode: string;
  occurred_at: string;
  balance: number;
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
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  n: number
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c0f4-0000-7000-8000-0000000004${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

function pay(
  personId: string,
  body: Record<string, unknown>,
  relationshipId = REL,
  organizationId = SUPPLIER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/customers/${relationshipId}/payments`)
    .send(body);
}

function cash(n: number, amount = 20000, extra: Record<string, unknown> = {}) {
  return { id: gestureId(n), amount, mode: 'CASH', ...extra };
}

async function balanceOf(id = REL): Promise<bigint> {
  return (await prisma.customerRelationship.findUniqueOrThrow({ where: { id } })).balance;
}

async function heldBy(personId = SELLER): Promise<bigint> {
  return (
    await prisma.collaboration.findFirstOrThrow({
      where: { personId, organizationId: SUPPLIER },
    })
  ).amountHeld;
}

/** Asserts that no entry exists and that the balance and the held money did not move. */
async function nothingStored() {
  expect(await prisma.ledgerEntry.count()).toBe(0);
  expect(await balanceOf()).toBe(45000n);
  expect(await heldBy()).toBe(0n);
}

/**
 * Supplier with an owner, a manager, a seller and a driver; REL is a customer with balance 45000,
 * COUNTER_REL a counter, ENDED_REL an ended customer; OTHER_REL belongs to another business.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600085001');
  await seedPerson(MANAGER, '+237600085002');
  await seedPerson(SELLER, '+237600085003');
  await seedPerson(DRIVER, '+237600085004');
  await seedPerson(CUSTOMER, '+237600085005');
  await seedPerson(OTHER_OWNER, '+237600085006');
  await seedPerson(SUPPLIER_PERSON, '+237600085007');
  await seedPerson(CUSTOMER_2, '+237600085008');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, MANAGER, 'MANAGER', 2);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: OWNER,
      status: 'ACTIVE',
      balance: 45000n,
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
  await prisma.customerRelationship.create({
    data: {
      id: COUNTER_REL,
      supplierOrganizationId: SUPPLIER,
      customerLabel: 'Walk-in',
      createdById: OWNER,
      status: 'ACTIVE',
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: ENDED_REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER_2,
      createdById: OWNER,
      status: 'ENDED',
      endedByParty: 'CUSTOMER',
      balance: 1000n,
    },
  });
});

describe('FIN-004 seller records a payment', () => {
  it('lowers the balance and raises the seller held money (AC-1, C-23)', async () => {
    const before = Date.now();
    const response = await pay(SELLER, cash(1));

    expect(response.status).toBe(201);
    const body = bodyOf<PaymentBody>(response);
    expect(body).toMatchObject({
      id: gestureId(1),
      kind: 'PAYMENT',
      amount: 20000,
      mode: 'CASH',
      balance: 25000,
    });
    expect(Object.keys(body).sort()).toEqual(
      ['amount', 'balance', 'id', 'kind', 'mode', 'occurred_at'].sort()
    );
    expect(await balanceOf()).toBe(25000n);
    expect(await heldBy()).toBe(20000n);
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: gestureId(1) } });
    expect(entry).toMatchObject({
      customerRelationshipId: REL,
      kind: 'PAYMENT',
      amount: 20000n,
      balanceEffect: -20000n,
      mode: 'CASH',
      recordedById: SELLER,
      transactionReference: null,
    });
    expect(entry.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(body.occurred_at).getTime()).toBe(entry.occurredAt.getTime());
  });

  it('stores the mobile money reference and counts it in the held money (AC-2)', async () => {
    const response = await pay(
      SELLER,
      cash(2, 10000, { mode: 'MOBILE_MONEY', transaction_reference: 'MM-123', note: 'by phone' })
    );

    expect(response.status).toBe(201);
    expect(bodyOf<PaymentBody>(response).mode).toBe('MOBILE_MONEY');
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: gestureId(2) } });
    expect(entry).toMatchObject({
      mode: 'MOBILE_MONEY',
      transactionReference: 'MM-123',
      note: 'by phone',
    });
    expect(await heldBy()).toBe(10000n);
  });

  it('accepts a payment above the balance: the balance goes negative (AC-3)', async () => {
    const response = await pay(SELLER, cash(3, 50000));

    expect(response.status).toBe(201);
    expect(bodyOf<PaymentBody>(response).balance).toBe(-5000);
    expect(await balanceOf()).toBe(-5000n);
  });

  it('refuses invalid amounts, modes and references, storing nothing (AC-4)', async () => {
    const bodies: Record<string, unknown>[] = [
      cash(4, 0),
      cash(5, 1.5),
      cash(6, -10),
      cash(7, 20000, { mode: 'CARD' }),
      cash(8, 20000, { transaction_reference: 'MM-1' }),
      cash(9, 20000, { mode: 'MOBILE_MONEY', transaction_reference: 'x'.repeat(101) }),
      cash(10, 20000, { note: 'x'.repeat(2001) }),
      { id: gestureId(11), amount: 20000 },
      { id: 'not-a-uuid', amount: 20000, mode: 'CASH' },
    ];
    for (const body of bodies) {
      const response = await pay(SELLER, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    await nothingStored();
  });

  it('refuses a counter with COUNTER_ONLY_RETURNS (AC-4)', async () => {
    const response = await pay(SELLER, cash(12), COUNTER_REL);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('COUNTER_ONLY_RETURNS');
    await nothingStored();
  });

  it('refuses a PENDING relationship with RELATIONSHIP_NOT_ACTIVE (AC-4)', async () => {
    // The database never lets a PENDING row belong to an organization supplier, so the rule is
    // checked by lifting that constraint for this test only.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE customer_relationships DROP CONSTRAINT ${PENDING_CHECK}`
    );
    try {
      await prisma.customerRelationship.create({
        data: {
          id: PENDING_REL,
          supplierOrganizationId: SUPPLIER,
          customerPersonId: OWNER,
          createdById: OWNER,
          status: 'PENDING',
        },
      });
      const response = await pay(SELLER, cash(13), PENDING_REL);

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('RELATIONSHIP_NOT_ACTIVE');
      expect(await prisma.ledgerEntry.count()).toBe(0);
    } finally {
      await prisma.customerRelationship.deleteMany({ where: { id: PENDING_REL } });
      await prisma.$executeRawUnsafe(
        `ALTER TABLE customer_relationships ADD CONSTRAINT ${PENDING_CHECK} CHECK (("status" = 'PENDING') = ("supplier_person_id" IS NOT NULL))`
      );
    }
  });

  it('refuses a SUSPENDED organization with ORGANIZATION_NOT_ACTIVE (AC-4)', async () => {
    await prisma.organization.update({ where: { id: SUPPLIER }, data: { status: 'SUSPENDED' } });

    const response = await pay(SELLER, cash(14));

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
    await nothingStored();
  });

  it('refuses a DRIVER caller with FORBIDDEN, storing nothing (AC-4)', async () => {
    const response = await pay(DRIVER, cash(15));

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    await nothingStored();
  });

  it('accepts a payment of a CLOSED organization (AC-5)', async () => {
    await prisma.organization.update({ where: { id: SUPPLIER }, data: { status: 'CLOSED' } });

    const response = await pay(SELLER, cash(16));

    expect(response.status).toBe(201);
    expect(await balanceOf()).toBe(25000n);
    expect(await heldBy()).toBe(20000n);
  });

  it('accepts a payment on an ENDED relationship and from a MANAGER (v5.0.0-8.2.1)', async () => {
    const ended = await pay(SELLER, cash(17, 400), ENDED_REL);
    expect(ended.status).toBe(201);
    expect(bodyOf<PaymentBody>(ended).balance).toBe(600);

    const manager = await pay(MANAGER, cash(18, 100));
    expect(manager.status).toBe(201);
    expect(await heldBy(MANAGER)).toBe(100n);
  });

  it('answers the first result for a retried id and stores one entry (AB-1, C-38, CWE-362)', async () => {
    const first = await pay(SELLER, cash(19));
    const second = await pay(SELLER, cash(19));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.ledgerEntry.count()).toBe(1);
    expect(await balanceOf()).toBe(25000n);
    expect(await heldBy()).toBe(20000n);
  });

  it('rejects client-set fields (AB-2, CWE-915)', async () => {
    for (const extra of [
      { kind: 'SALE' },
      { balance_effect: 20000 },
      { recorded_by_id: OWNER },
      { occurred_at: '2020-01-01T00:00:00.000Z' },
      { customer_relationship_id: OTHER_REL },
    ]) {
      const response = await pay(SELLER, cash(20, 20000, extra));
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    await nothingStored();
  });

  it("answers 404 for another business's customer and for a non-member (AB-3, WSTG-ATHZ-04)", async () => {
    const inside = await pay(OTHER_OWNER, cash(21), REL, OTHER_ORG);
    expect(inside.status).toBe(404);
    expect(bodyOf<ErrorBody>(inside).error.code).toBe('NOT_FOUND');

    const outside = await pay(SELLER, cash(22), REL, OTHER_ORG);
    expect(outside.status).toBe(404);

    const foreign = await pay(SELLER, cash(23), OTHER_REL);
    expect(foreign.status).toBe(404);
    expect(bodyOf<ErrorBody>(foreign).error.code).toBe('NOT_FOUND');
    await nothingStored();
    expect(await balanceOf(OTHER_REL)).toBe(0n);
  });
});
