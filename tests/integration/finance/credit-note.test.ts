import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f4-0000-7000-8000-000000000011';
const MANAGER = '0199c0f4-0000-7000-8000-000000000012';
const SELLER = '0199c0f4-0000-7000-8000-000000000013';
const CUSTOMER = '0199c0f4-0000-7000-8000-000000000015';
const OTHER_OWNER = '0199c0f4-0000-7000-8000-000000000016';

const SUPPLIER = '0199c0f4-0000-7000-8000-0000000000b1';
const OTHER_ORG = '0199c0f4-0000-7000-8000-0000000000b2';

const REL = '0199c0f4-0000-7000-8000-0000000000f1';
const OTHER_REL = '0199c0f4-0000-7000-8000-0000000000f2';
const COUNTER_REL = '0199c0f4-0000-7000-8000-0000000000f3';
const SELF_REL = '0199c0f4-0000-7000-8000-0000000000f4';
const ORG_REL = '0199c0f4-0000-7000-8000-0000000000f5';

const REG = new Date('2026-01-01T00:00:00.000Z');

const gestureId = (n: number) => `0199c0f4-0000-7000-8000-0000000007${String(n).padStart(2, '0')}`;

type CreditNoteBody = {
  id: string;
  kind: string;
  amount: number;
  mode: string | null;
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
  role: 'OWNER' | 'MANAGER' | 'SELLER',
  n: number,
  amountHeld = 0n
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c0f4-0000-7000-8000-0000000005${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
      amountHeld,
    },
  });
}

function creditNote(
  personId: string,
  body: Record<string, unknown>,
  relationshipId = REL,
  organizationId = SUPPLIER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/customers/${relationshipId}/credit-notes`)
    .send(body);
}

function note(n: number, amount = 5000, extra: Record<string, unknown> = {}) {
  return { id: gestureId(n), amount, note: "retour d'un sac", ...extra };
}

async function balanceOf(id = REL): Promise<bigint> {
  return (await prisma.customerRelationship.findUniqueOrThrow({ where: { id } })).balance;
}

async function heldBy(personId: string): Promise<bigint> {
  return (
    await prisma.collaboration.findFirstOrThrow({
      where: { personId, organizationId: SUPPLIER },
    })
  ).amountHeld;
}

/** Asserts that no entry exists and that the balance and held money did not move. */
async function nothingStored() {
  expect(await prisma.ledgerEntry.count()).toBe(0);
  expect(await balanceOf()).toBe(30000n);
  expect(await heldBy(MANAGER)).toBe(30000n);
  expect(await heldBy(SELLER)).toBe(30000n);
}

/**
 * Supplier with an owner, a manager and a seller each holding 30000; REL is a registered
 * customer with balance 30000, COUNTER_REL a counter, SELF_REL the manager's own record, ORG_REL
 * a business the manager manages; OTHER_REL belongs to another business.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600087001');
  await seedPerson(MANAGER, '+237600087002');
  await seedPerson(SELLER, '+237600087003');
  await seedPerson(CUSTOMER, '+237600087005');
  await seedPerson(OTHER_OWNER, '+237600087006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1, 30000n);
  await seedMember(SUPPLIER, MANAGER, 'MANAGER', 2, 30000n);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3, 30000n);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await seedMember(OTHER_ORG, MANAGER, 'MANAGER', 6);
  const base = { supplierOrganizationId: SUPPLIER, createdById: OWNER, status: 'ACTIVE' as const };
  await prisma.customerRelationship.create({
    data: { ...base, id: REL, customerPersonId: CUSTOMER, balance: 30000n },
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
});

describe('FIN-006 manager grants a credit note', () => {
  it('lowers the balance and moves no held money (AC-1, C-23)', async () => {
    const response = await creditNote(MANAGER, note(1));

    expect(response.status).toBe(201);
    const body = bodyOf<CreditNoteBody>(response);
    expect(body).toMatchObject({
      id: gestureId(1),
      kind: 'CREDIT_NOTE',
      amount: 5000,
      mode: null,
      balance: 25000,
    });
    expect(Object.keys(body).sort()).toEqual(
      ['amount', 'balance', 'id', 'kind', 'mode', 'occurred_at'].sort()
    );
    expect(await balanceOf()).toBe(25000n);
    expect(await heldBy(MANAGER)).toBe(30000n);
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: gestureId(1) } });
    expect(entry).toMatchObject({
      customerRelationshipId: REL,
      kind: 'CREDIT_NOTE',
      amount: 5000n,
      balanceEffect: -5000n,
      mode: null,
      note: "retour d'un sac",
      recordedById: MANAGER,
    });
  });

  it('lets the owner grant a credit note on their manager as a customer (v5.0.0-8.2.1)', async () => {
    const response = await creditNote(OWNER, note(2), SELF_REL);

    expect(response.status).toBe(201);
    expect(await balanceOf(SELF_REL)).toBe(-5000n);
  });

  it('refuses a missing, empty or too long note and unknown fields (AC-2, v5.0.0-15.3.3)', async () => {
    const bodies: Record<string, unknown>[] = [
      { id: gestureId(3), amount: 5000 },
      note(4, 5000, { note: '' }),
      note(5, 5000, { note: '   ' }),
      note(6, 5000, { note: 'x'.repeat(2001) }),
      note(7, 0),
      note(8, 1.5),
      note(9, 5000, { mode: 'CASH' }),
      note(10, 5000, { kind: 'PAYMENT' }),
    ];
    for (const body of bodies) {
      const response = await creditNote(MANAGER, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    await nothingStored();
  });

  it('refuses a SELLER caller with FORBIDDEN, balance unchanged (AC-2, AB-1, WSTG-ATHZ-03)', async () => {
    const response = await creditNote(SELLER, note(11));

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    await nothingStored();
  });

  it("refuses the manager's own record and a business they manage with OWN_RECORD (AC-2)", async () => {
    for (const [n, rel] of [
      [12, SELF_REL],
      [13, ORG_REL],
    ] as const) {
      const response = await creditNote(MANAGER, note(n), rel);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
    }
    await nothingStored();
  });

  it('refuses a counter with COUNTER_ONLY_RETURNS (AC-2)', async () => {
    const response = await creditNote(MANAGER, note(14), COUNTER_REL);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('COUNTER_ONLY_RETURNS');
    await nothingStored();
  });

  it('refuses a CLOSED or SUSPENDED organization with ORGANIZATION_NOT_ACTIVE (Context)', async () => {
    for (const [n, status] of [
      [15, 'CLOSED'],
      [16, 'SUSPENDED'],
    ] as const) {
      await prisma.organization.update({ where: { id: SUPPLIER }, data: { status } });
      const response = await creditNote(MANAGER, note(n));
      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
    }
    await nothingStored();
  });

  it('answers the first result for a retried id: one entry, balance lowered once (AC-3, CWE-362)', async () => {
    const first = await creditNote(MANAGER, note(17));
    const second = await creditNote(MANAGER, note(17));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.ledgerEntry.count()).toBe(1);
    expect(await balanceOf()).toBe(25000n);
  });

  it("answers 404 for another business's customer, storing nothing (v5.0.0-8.2.2)", async () => {
    const foreign = await creditNote(MANAGER, note(18), OTHER_REL);

    expect(foreign.status).toBe(404);
    expect(bodyOf<ErrorBody>(foreign).error.code).toBe('NOT_FOUND');
    await nothingStored();
    expect(await balanceOf(OTHER_REL)).toBe(0n);
  });
});
