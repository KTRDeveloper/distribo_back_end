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
const GUEST = '0199c0f4-0000-7000-8000-000000000007';

const SUPPLIER = '0199c0f4-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c0f4-0000-7000-8000-0000000000a2';

const REL = '0199c0f4-0000-7000-8000-0000000000e1';
const OTHER_REL = '0199c0f4-0000-7000-8000-0000000000e2';
const COUNTER_REL = '0199c0f4-0000-7000-8000-0000000000e3';
const SELF_REL = '0199c0f4-0000-7000-8000-0000000000e4';
const PENDING_REL = '0199c0f4-0000-7000-8000-0000000000e5';
const ORG_REL = '0199c0f4-0000-7000-8000-0000000000e6';
const GUEST_REL = '0199c0f4-0000-7000-8000-0000000000e7';

const REG = new Date('2026-01-01T00:00:00.000Z');
const PENDING_CHECK = 'customer_relationships_pending_iff_supplier_person_check';

const gestureId = (n: number) => `0199c0f4-0000-7000-8000-0000000006${String(n).padStart(2, '0')}`;

type RefundBody = {
  id: string;
  kind: string;
  amount: number;
  mode: string;
  occurred_at: string;
  balance: number;
};

async function seedPerson(id: string, phone: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: registered ? REG : null,
      passwordHash: registered ? 'test-password-hash' : null,
      registeredAt: registered ? REG : null,
    },
  });
}

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  n: number,
  amountHeld = 0n
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c0f4-0000-7000-8000-0000000004${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
      amountHeld,
    },
  });
}

function refund(
  personId: string,
  body: Record<string, unknown>,
  relationshipId = REL,
  organizationId = SUPPLIER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/customers/${relationshipId}/refunds`)
    .send(body);
}

function cash(n: number, amount = 10000, extra: Record<string, unknown> = {}) {
  return { id: gestureId(n), amount, mode: 'CASH', ...extra };
}

async function balanceOf(id = REL): Promise<bigint> {
  return (await prisma.customerRelationship.findUniqueOrThrow({ where: { id } })).balance;
}

async function heldBy(personId = MANAGER): Promise<bigint> {
  return (
    await prisma.collaboration.findFirstOrThrow({
      where: { personId, organizationId: SUPPLIER },
    })
  ).amountHeld;
}

/** Asserts that no entry or notification exists and that the balance and held money did not move. */
async function nothingStored(heldOf = MANAGER, held = 30000n) {
  expect(await prisma.ledgerEntry.count()).toBe(0);
  expect(await prisma.notification.count()).toBe(0);
  expect(await balanceOf()).toBe(0n);
  expect(await heldBy(heldOf)).toBe(held);
}

/**
 * Supplier with an owner, a manager holding 30000, a seller and a driver; REL is a registered
 * customer with balance 0, COUNTER_REL a counter, SELF_REL the manager's own record, ORG_REL a
 * business the manager manages; OTHER_REL belongs to another business.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600086001');
  await seedPerson(MANAGER, '+237600086002');
  await seedPerson(SELLER, '+237600086003');
  await seedPerson(DRIVER, '+237600086004');
  await seedPerson(CUSTOMER, '+237600086005');
  await seedPerson(OTHER_OWNER, '+237600086006');
  await seedPerson(GUEST, '+237600086007', false);
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1, 30000n);
  await seedMember(SUPPLIER, MANAGER, 'MANAGER', 2, 30000n);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3, 30000n);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4, 30000n);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await seedMember(OTHER_ORG, MANAGER, 'MANAGER', 6);
  const base = { supplierOrganizationId: SUPPLIER, createdById: OWNER, status: 'ACTIVE' as const };
  await prisma.customerRelationship.create({
    data: { ...base, id: REL, customerPersonId: CUSTOMER },
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
    data: { ...base, id: COUNTER_REL, customerLabel: 'Walk-in' },
  });
  await prisma.customerRelationship.create({
    data: { ...base, id: SELF_REL, customerPersonId: MANAGER },
  });
  await prisma.customerRelationship.create({
    data: { ...base, id: ORG_REL, customerOrganizationId: OTHER_ORG },
  });
  await prisma.customerRelationship.create({
    data: { ...base, id: GUEST_REL, customerPersonId: GUEST },
  });
});

describe('FIN-005 manager returns money to a customer', () => {
  it('raises the balance and lowers the manager held money (AC-1, C-23)', async () => {
    const response = await refund(MANAGER, cash(1));

    expect(response.status).toBe(201);
    const body = bodyOf<RefundBody>(response);
    expect(body).toMatchObject({
      id: gestureId(1),
      kind: 'REFUND',
      amount: 10000,
      mode: 'CASH',
      balance: 10000,
    });
    expect(Object.keys(body).sort()).toEqual(
      ['amount', 'balance', 'id', 'kind', 'mode', 'occurred_at'].sort()
    );
    expect(await balanceOf()).toBe(10000n);
    expect(await heldBy()).toBe(20000n);
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: gestureId(1) } });
    expect(entry).toMatchObject({
      customerRelationshipId: REL,
      kind: 'REFUND',
      amount: 10000n,
      balanceEffect: 10000n,
      mode: 'CASH',
      recordedById: MANAGER,
    });
  });

  it('lets the owner refund with a mobile money reference (v5.0.0-8.2.1)', async () => {
    const response = await refund(
      OWNER,
      cash(2, 5000, { mode: 'MOBILE_MONEY', transaction_reference: 'MM-9', note: 'change' })
    );

    expect(response.status).toBe(201);
    expect(await heldBy(OWNER)).toBe(25000n);
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: gestureId(2) } });
    expect(entry).toMatchObject({ mode: 'MOBILE_MONEY', transactionReference: 'MM-9' });
  });

  it('notifies a registered customer once with balance.increased (AC-2)', async () => {
    await refund(MANAGER, cash(3));

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientId: CUSTOMER,
      sourceEvent: 'balance.increased',
      readStatus: 'UNREAD',
      organizationId: SUPPLIER,
    });
  });

  it('notifies nobody for a guest customer but still stores the refund (AC-2)', async () => {
    const response = await refund(MANAGER, cash(4), GUEST_REL);

    expect(response.status).toBe(201);
    expect(await prisma.notification.count()).toBe(0);
    expect(await balanceOf(GUEST_REL)).toBe(10000n);
  });

  it('refuses a SELLER or DRIVER caller with FORBIDDEN, storing nothing (AC-3, AB-2, WSTG-ATHZ-03)', async () => {
    for (const [n, person] of [
      [5, SELLER],
      [6, DRIVER],
    ] as const) {
      const response = await refund(person, cash(n));
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    }
    await nothingStored(SELLER);
    expect(await heldBy(DRIVER)).toBe(30000n);
  });

  it('refuses a counter with COUNTER_ONLY_RETURNS (AC-3)', async () => {
    const response = await refund(MANAGER, cash(7), COUNTER_REL);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('COUNTER_ONLY_RETURNS');
    await nothingStored();
  });

  it("refuses the manager's own record and a business they manage with OWN_RECORD (AC-3)", async () => {
    for (const [n, rel] of [
      [8, SELF_REL],
      [9, ORG_REL],
    ] as const) {
      const response = await refund(MANAGER, cash(n), rel);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
    }
    await nothingStored();
  });

  it('lets the owner refund their manager as a customer (AC-3)', async () => {
    const response = await refund(OWNER, cash(10), SELF_REL);

    expect(response.status).toBe(201);
    expect(await balanceOf(SELF_REL)).toBe(10000n);
  });

  it('refuses amount 0 and a missing mode, storing nothing (AC-3)', async () => {
    const bodies: Record<string, unknown>[] = [
      cash(11, 0),
      cash(12, 1.5),
      cash(13, 10000, { mode: 'CARD' }),
      cash(14, 10000, { transaction_reference: 'MM-1' }),
      cash(15, 10000, { kind: 'PAYMENT' }),
      { id: gestureId(16), amount: 10000 },
    ];
    for (const body of bodies) {
      const response = await refund(MANAGER, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    await nothingStored();
  });

  it('refuses a CLOSED or SUSPENDED organization with ORGANIZATION_NOT_ACTIVE (AC-3)', async () => {
    for (const [n, status] of [
      [17, 'CLOSED'],
      [18, 'SUSPENDED'],
    ] as const) {
      await prisma.organization.update({ where: { id: SUPPLIER }, data: { status } });
      const response = await refund(MANAGER, cash(n));
      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
    }
    await nothingStored();
  });

  it('refuses a PENDING relationship with RELATIONSHIP_NOT_ACTIVE (Context)', async () => {
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
      const response = await refund(MANAGER, cash(19), PENDING_REL);

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

  it('answers the first result for a retried id: one entry, money leaves once (AB-1, CWE-362)', async () => {
    const first = await refund(MANAGER, cash(20));
    const second = await refund(MANAGER, cash(20));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.ledgerEntry.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(1);
    expect(await balanceOf()).toBe(10000n);
    expect(await heldBy()).toBe(20000n);
  });

  it("answers 404 for another business's customer, storing nothing (v5.0.0-8.2.2)", async () => {
    const foreign = await refund(MANAGER, cash(21), OTHER_REL);

    expect(foreign.status).toBe(404);
    expect(bodyOf<ErrorBody>(foreign).error.code).toBe('NOT_FOUND');
    await nothingStored();
    expect(await balanceOf(OTHER_REL)).toBe(0n);
  });
});
