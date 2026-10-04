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

const SUPPLIER = '0199c0f4-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c0f4-0000-7000-8000-0000000000a2';

const REL = '0199c0f4-0000-7000-8000-0000000000e1';
const OTHER_REL = '0199c0f4-0000-7000-8000-0000000000e2';
const SELF_REL = '0199c0f4-0000-7000-8000-0000000000e4';
const ORG_REL = '0199c0f4-0000-7000-8000-0000000000e6';

const REG = new Date('2026-01-01T00:00:00.000Z');

const entryId = (n: number) => `0199c0f4-0000-7000-8000-0000000007${String(n).padStart(2, '0')}`;
const gestureId = (n: number) => `0199c0f4-0000-7000-8000-0000000008${String(n).padStart(2, '0')}`;

type ReverseBody = {
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

/** Stores an entry the way its gesture would have: the entry, then its cache effects. */
async function seedEntry(
  id: string,
  relationshipId: string,
  recordedById: string,
  kind: 'PAYMENT' | 'REFUND' | 'CREDIT_NOTE',
  amount = 20000n,
  reversesEntryId?: string
) {
  const entry = await prisma.ledgerEntry.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      kind,
      amount,
      mode: kind === 'CREDIT_NOTE' ? null : 'CASH',
      recordedById,
      reversesEntryId: reversesEntryId ?? null,
      occurredAt: new Date('2026-02-01T00:00:00.000Z'),
    },
  });
  await prisma.customerRelationship.update({
    where: { id: relationshipId },
    data: { balance: { increment: entry.balanceEffect } },
  });
  const cash = kind === 'PAYMENT' ? amount : kind === 'REFUND' ? -amount : 0n;
  if (cash !== 0n) {
    await prisma.collaboration.updateMany({
      where: { personId: recordedById, organizationId: SUPPLIER },
      data: { amountHeld: { increment: reversesEntryId ? -cash : cash } },
    });
  }
}

function reverse(
  personId: string,
  target: string,
  body: Record<string, unknown> = { id: gestureId(1) },
  organizationId = SUPPLIER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/ledger-entries/${target}/reverse`)
    .send(body);
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

/**
 * Supplier with an owner, a manager, a seller and a driver. The seller took a PAYMENT of 20000
 * (entry 1) on REL, so REL owes -20000 and the seller holds 20000. SELF_REL is the manager's own
 * record and ORG_REL a business the manager manages; OTHER_REL belongs to another business.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600087001');
  await seedPerson(MANAGER, '+237600087002');
  await seedPerson(SELLER, '+237600087003');
  await seedPerson(DRIVER, '+237600087004');
  await seedPerson(CUSTOMER, '+237600087005');
  await seedPerson(OTHER_OWNER, '+237600087006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1);
  await seedMember(SUPPLIER, MANAGER, 'MANAGER', 2);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3);
  await seedMember(SUPPLIER, DRIVER, 'DRIVER', 4);
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
    data: { ...base, id: SELF_REL, customerPersonId: MANAGER },
  });
  await prisma.customerRelationship.create({
    data: { ...base, id: ORG_REL, customerOrganizationId: OTHER_ORG },
  });
  await seedEntry(entryId(1), REL, SELLER, 'PAYMENT');
});

describe('FIN-009 manager reverses a ledger entry', () => {
  it('writes a mirror entry: balance +20000, seller held -20000 (AC-1, C-25)', async () => {
    const response = await reverse(MANAGER, entryId(1), { id: gestureId(1), note: 'wrong' });

    expect(response.status).toBe(201);
    const body = bodyOf<ReverseBody>(response);
    expect(body).toMatchObject({
      id: gestureId(1),
      kind: 'PAYMENT',
      amount: 20000,
      mode: 'CASH',
      balance: 0,
    });
    expect(Object.keys(body).sort()).toEqual(
      ['amount', 'balance', 'id', 'kind', 'mode', 'occurred_at'].sort()
    );
    const mirror = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: gestureId(1) } });
    expect(mirror).toMatchObject({
      customerRelationshipId: REL,
      kind: 'PAYMENT',
      amount: 20000n,
      mode: 'CASH',
      reversesEntryId: entryId(1),
      balanceEffect: 20000n,
      recordedById: MANAGER,
      note: 'wrong',
    });
    expect(await balanceOf()).toBe(0n);
    expect(await heldBy(SELLER)).toBe(0n);
    expect(await heldBy(MANAGER)).toBe(0n);
  });

  it('notifies a registered customer when the balance rises, once (Context)', async () => {
    await reverse(MANAGER, entryId(1));

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientId: CUSTOMER,
      sourceEvent: 'balance.increased',
      organizationId: SUPPLIER,
    });
  });

  it('reverses a REFUND: balance down, money held back, nobody notified (AC-1)', async () => {
    await seedEntry(entryId(2), REL, MANAGER, 'REFUND', 5000n);
    const before = await balanceOf();
    const heldBefore = await heldBy(MANAGER);

    const response = await reverse(OWNER, entryId(2), { id: gestureId(2) });

    expect(response.status).toBe(201);
    expect(await balanceOf()).toBe(before - 5000n);
    expect(await heldBy(MANAGER)).toBe(heldBefore + 5000n);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('keeps the original entry unchanged (AC-4)', async () => {
    const before = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId(1) } });

    await reverse(MANAGER, entryId(1));

    const after = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId(1) } });
    expect(after).toEqual(before);
    expect(await prisma.ledgerEntry.count()).toBe(2);
  });

  it('refuses an entry already reversed with ALREADY_REVERSED (AC-2)', async () => {
    await reverse(MANAGER, entryId(1), { id: gestureId(1) });

    const response = await reverse(OWNER, entryId(1), { id: gestureId(2) });

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('ALREADY_REVERSED');
    expect(await prisma.ledgerEntry.count()).toBe(2);
    expect(await balanceOf()).toBe(0n);
  });

  it('refuses a reversal entry with CANNOT_REVERSE_REVERSAL (AC-2)', async () => {
    await reverse(MANAGER, entryId(1), { id: gestureId(1) });

    const response = await reverse(MANAGER, gestureId(1), { id: gestureId(2) });

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('CANNOT_REVERSE_REVERSAL');
    expect(await prisma.ledgerEntry.count()).toBe(2);
  });

  it("answers 404 for another business's entry, storing nothing (AC-2, AB-2, WSTG-ATHZ-04)", async () => {
    await seedEntry(entryId(3), OTHER_REL, OTHER_OWNER, 'PAYMENT', 7000n);
    const heldBefore = await prisma.collaboration.findMany({ orderBy: { id: 'asc' } });

    const foreign = await reverse(MANAGER, entryId(3), { id: gestureId(3) });
    const unknown = await reverse(MANAGER, entryId(99), { id: gestureId(4) });

    for (const response of [foreign, unknown]) {
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
    expect(await prisma.ledgerEntry.count()).toBe(2);
    expect(await balanceOf(OTHER_REL)).toBe(-7000n);
    expect(await prisma.collaboration.findMany({ orderBy: { id: 'asc' } })).toEqual(heldBefore);
  });

  it('refuses a SELLER or DRIVER with FORBIDDEN, writing nothing (AC-2, AB-1, WSTG-ATHZ-03)', async () => {
    for (const [n, person] of [
      [5, SELLER],
      [6, DRIVER],
    ] as const) {
      const response = await reverse(person, entryId(1), { id: gestureId(n) });
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    }
    expect(await prisma.ledgerEntry.count()).toBe(1);
    expect(await balanceOf()).toBe(-20000n);
    expect(await heldBy(SELLER)).toBe(20000n);
  });

  it("refuses the manager's own record with OWN_RECORD; the owner may (AC-2)", async () => {
    await seedEntry(entryId(4), SELF_REL, SELLER, 'PAYMENT', 3000n);
    await seedEntry(entryId(5), ORG_REL, SELLER, 'PAYMENT', 4000n);

    for (const [n, target] of [
      [7, entryId(4)],
      [8, entryId(5)],
    ] as const) {
      const response = await reverse(MANAGER, target, { id: gestureId(n) });
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
    }
    expect(await prisma.ledgerEntry.count()).toBe(3);

    const owner = await reverse(OWNER, entryId(4), { id: gestureId(9) });
    expect(owner.status).toBe(201);
    expect(await balanceOf(SELF_REL)).toBe(0n);
  });

  it('lets only one of two parallel reversals succeed (AC-3, CWE-362)', async () => {
    const [a, b] = await Promise.all([
      reverse(MANAGER, entryId(1), { id: gestureId(10) }),
      reverse(OWNER, entryId(1), { id: gestureId(11) }),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(bodyOf<ErrorBody>(loser).error.code).toBe('ALREADY_REVERSED');
    expect(await prisma.ledgerEntry.count()).toBe(2);
    expect(await balanceOf()).toBe(0n);
    expect(await heldBy(SELLER)).toBe(0n);
  });

  it('answers the first result for a retried id: one reversal (Project rules, CWE-362)', async () => {
    const first = await reverse(MANAGER, entryId(1), { id: gestureId(12) });
    const second = await reverse(MANAGER, entryId(1), { id: gestureId(12) });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.ledgerEntry.count()).toBe(2);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('refuses unknown fields, a bad id and a malformed entry id, writing nothing (v5.0.0-15.3.3)', async () => {
    const bodies: Record<string, unknown>[] = [
      { id: gestureId(13), kind: 'SALE' },
      { id: gestureId(14), amount: 1 },
      { id: 'nope' },
      {},
      { id: gestureId(15), note: 'x'.repeat(5000) },
    ];
    for (const body of bodies) {
      const response = await reverse(MANAGER, entryId(1), body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    const malformed = await reverse(MANAGER, 'not-a-uuid', { id: gestureId(16) });
    expect(malformed.status).toBe(400);
    expect(await prisma.ledgerEntry.count()).toBe(1);
  });
});
