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

const PENDING_REL = '0199c0f4-0000-7000-8000-0000000000f6';
const PENDING_CHECK = 'customer_relationships_pending_iff_supplier_person_check';

const gestureId = (n: number) => `0199c0f4-0000-7000-8000-0000000007${String(n).padStart(2, '0')}`;

type EntryBody = {
  id: string;
  kind: string;
  amount: number;
  mode: string | null;
  occurred_at: string;
  balance: number;
};

type ReturnBody = { credit_note: EntryBody; refund: EntryBody };

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

function giveReturn(
  personId: string,
  body: Record<string, unknown>,
  relationshipId = REL,
  organizationId = SUPPLIER
) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/customers/${relationshipId}/returns`)
    .send(body);
}

function ret(n: number, amount = 10000, extra: Record<string, unknown> = {}) {
  return {
    id: gestureId(n),
    refund_entry_id: gestureId(n + 50),
    amount,
    mode: 'CASH',
    note: 'sac rendu',
    ...extra,
  };
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
  expect(await balanceOf()).toBe(10000n);
  expect(await heldBy(MANAGER)).toBe(30000n);
  expect(await heldBy(SELLER)).toBe(30000n);
}

/**
 * Supplier with an owner, a manager and a seller each holding 30000; REL is a registered
 * customer with balance 10000, COUNTER_REL a counter, SELF_REL the manager's own record, ORG_REL
 * a business the manager manages; OTHER_REL belongs to another business.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600088001');
  await seedPerson(MANAGER, '+237600088002');
  await seedPerson(SELLER, '+237600088003');
  await seedPerson(CUSTOMER, '+237600088005');
  await seedPerson(OTHER_OWNER, '+237600088006');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(SUPPLIER, OWNER, 'OWNER', 1, 30000n);
  await seedMember(SUPPLIER, MANAGER, 'MANAGER', 2, 30000n);
  await seedMember(SUPPLIER, SELLER, 'SELLER', 3, 30000n);
  await seedMember(OTHER_ORG, OTHER_OWNER, 'OWNER', 5);
  await seedMember(OTHER_ORG, MANAGER, 'MANAGER', 6);
  const base = { supplierOrganizationId: SUPPLIER, createdById: OWNER, status: 'ACTIVE' as const };
  await prisma.customerRelationship.create({
    data: { ...base, id: REL, customerPersonId: CUSTOMER, balance: 10000n },
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

describe('FIN-008 manager records a refunded return', () => {
  it('writes a credit note and a refund, balance same, held down (AC-1, CM-21)', async () => {
    const response = await giveReturn(MANAGER, ret(1));

    expect(response.status).toBe(201);
    const body = bodyOf<ReturnBody>(response);
    expect(Object.keys(body).sort()).toEqual(['credit_note', 'refund']);
    expect(body.credit_note).toMatchObject({
      id: gestureId(1),
      kind: 'CREDIT_NOTE',
      amount: 10000,
      mode: null,
      balance: 0,
    });
    expect(body.refund).toMatchObject({
      id: gestureId(51),
      kind: 'REFUND',
      amount: 10000,
      mode: 'CASH',
      balance: 10000,
    });
    expect(await prisma.ledgerEntry.count()).toBe(2);
    expect(await balanceOf()).toBe(10000n);
    expect(await heldBy(MANAGER)).toBe(20000n);
    const entries = (await prisma.ledgerEntry.findMany()).sort((a, b) =>
      a.kind.localeCompare(b.kind)
    );
    expect(entries.map((e) => [e.kind, e.recordedById, e.amount, e.note])).toEqual([
      ['CREDIT_NOTE', MANAGER, 10000n, 'sac rendu'],
      ['REFUND', MANAGER, 10000n, 'sac rendu'],
    ]);
  });

  it('works on a counter and leaves its balance at 0 (AC-2)', async () => {
    const response = await giveReturn(MANAGER, ret(2), COUNTER_REL);

    expect(response.status).toBe(201);
    expect(await prisma.ledgerEntry.count()).toBe(2);
    expect(await balanceOf(COUNTER_REL)).toBe(0n);
    expect(await heldBy(MANAGER)).toBe(20000n);
  });

  it('stores neither entry when the second fails (AC-3, CWE-362)', async () => {
    // An existing entry already owns the refund's id, so the second insert fails.
    await prisma.ledgerEntry.create({
      data: {
        id: gestureId(53),
        customerRelationshipId: REL,
        kind: 'OPENING_BALANCE',
        amount: 1n,
        recordedById: OWNER,
        note: 'existing',
        occurredAt: REG,
      },
    });

    const response = await giveReturn(MANAGER, ret(3));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.ledgerEntry.count()).toBe(1);
    expect(await prisma.ledgerEntry.findUnique({ where: { id: gestureId(3) } })).toBeNull();
    expect(await balanceOf()).toBe(10000n);
    expect(await heldBy(MANAGER)).toBe(30000n);
  });

  it('refuses a SELLER caller with FORBIDDEN (AC-4)', async () => {
    const response = await giveReturn(SELLER, ret(4));

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    await nothingStored();
  });

  it("refuses the manager's own record and a business they manage with OWN_RECORD (AC-4)", async () => {
    for (const [n, rel] of [
      [5, SELF_REL],
      [6, ORG_REL],
    ] as const) {
      const response = await giveReturn(MANAGER, ret(n), rel);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
    }
    await nothingStored();
  });

  it('refuses amount 0, a missing mode and malformed bodies with VALIDATION_ERROR (AC-4)', async () => {
    const noMode: Record<string, unknown> = ret(7);
    delete noMode.mode;
    const bodies: Record<string, unknown>[] = [
      ret(8, 0),
      noMode,
      ret(9, 10000, { mode: 'CHEQUE' }),
      ret(10, 1.5),
      ret(11, 10000, { note: '' }),
      ret(12, 10000, { refund_entry_id: gestureId(12) }),
      ret(13, 10000, { refund_entry_id: undefined }),
      ret(14, 10000, { kind: 'REFUND' }),
    ];
    for (const body of bodies) {
      const response = await giveReturn(MANAGER, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    await nothingStored();
  });

  it('never stores a lone refund: both entries share the amount (AB-1, CM-21)', async () => {
    expect((await giveReturn(MANAGER, ret(15, 4000))).status).toBe(201);
    expect((await giveReturn(OWNER, ret(16, 2500))).status).toBe(201);

    const entries = await prisma.ledgerEntry.findMany();
    const refunds = entries.filter((e) => e.kind === 'REFUND');
    const notes = entries.filter((e) => e.kind === 'CREDIT_NOTE');
    expect(refunds.map((e) => e.amount).sort()).toEqual(notes.map((e) => e.amount).sort());
    expect(await balanceOf()).toBe(10000n);
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
      const response = await giveReturn(MANAGER, ret(17), PENDING_REL);

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

  it('refuses a CLOSED or SUSPENDED organization with ORGANIZATION_NOT_ACTIVE (Context)', async () => {
    for (const [n, status] of [
      [18, 'CLOSED'],
      [21, 'SUSPENDED'],
    ] as const) {
      await prisma.organization.update({ where: { id: SUPPLIER }, data: { status } });
      const response = await giveReturn(MANAGER, ret(n));
      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
    }
    await nothingStored();
  });

  it('answers the first result for a retried id: two entries, held lowered once (CWE-362)', async () => {
    const first = await giveReturn(MANAGER, ret(19));
    const second = await giveReturn(MANAGER, ret(19));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.ledgerEntry.count()).toBe(2);
    expect(await heldBy(MANAGER)).toBe(20000n);
  });

  it("answers 404 for another business's customer, storing nothing (v5.0.0-8.2.2)", async () => {
    const foreign = await giveReturn(MANAGER, ret(20), OTHER_REL);

    expect(foreign.status).toBe(404);
    expect(bodyOf<ErrorBody>(foreign).error.code).toBe('NOT_FOUND');
    await nothingStored();
  });
});
