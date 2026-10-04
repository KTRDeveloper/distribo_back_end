import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { recordExpenseInTx } from '../../../src/modules/finance/held-money.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f5-0000-7000-8000-000000000011';
const MANAGER = '0199c0f5-0000-7000-8000-000000000012';
const SELLER = '0199c0f5-0000-7000-8000-000000000013';
const DRIVER = '0199c0f5-0000-7000-8000-000000000014';
const GONE = '0199c0f5-0000-7000-8000-000000000015';
const FOREIGN = '0199c0f5-0000-7000-8000-000000000016';
const INVITED = '0199c0f5-0000-7000-8000-000000000017';

const ORG = '0199c0f5-0000-7000-8000-0000000000b1';
const OTHER_ORG = '0199c0f5-0000-7000-8000-0000000000b2';

const REG = new Date('2026-01-01T00:00:00.000Z');

const gestureId = (n: number) => `0199c0f5-0000-7000-8000-0000000007${String(n).padStart(2, '0')}`;

type ExpenseBody = {
  id: string;
  paid_by_id: string;
  amount: number;
  category: string | null;
  description: string | null;
  recorded_by_id: string;
  occurred_at: string;
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
  amountHeld = 0n,
  status: 'ACTIVE' | 'REVOKED' | 'INVITED' = 'ACTIVE'
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c0f5-0000-7000-8000-0000000005${n}f`,
      personId,
      organizationId: orgId,
      role,
      status,
      acceptedAt: status === 'INVITED' ? null : REG,
      amountHeld,
    },
  });
}

function expense(personId: string, body: Record<string, unknown>, organizationId = ORG) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/expenses`)
    .send(body);
}

function spend(n: number, extra: Record<string, unknown> = {}) {
  return { id: gestureId(n), paid_by_id: DRIVER, amount: 5000, category: 'Carburant', ...extra };
}

async function heldBy(personId: string, organizationId = ORG): Promise<bigint> {
  return (await prisma.collaboration.findFirstOrThrow({ where: { personId, organizationId } }))
    .amountHeld;
}

/** Asserts that no expense exists and that nobody's held money moved. */
async function nothingStored() {
  expect(await prisma.expense.count()).toBe(0);
  expect(await heldBy(MANAGER)).toBe(20000n);
  expect(await heldBy(DRIVER)).toBe(60000n);
  expect(await heldBy(GONE)).toBe(10000n);
}

/**
 * One business with an owner, a manager (holding 20000), a seller, a driver (holding 60000) and a
 * former driver whose collaboration was revoked (holding 10000); FOREIGN belongs to another
 * business only; INVITED has only an invitation.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600088001');
  await seedPerson(MANAGER, '+237600088002');
  await seedPerson(SELLER, '+237600088003');
  await seedPerson(DRIVER, '+237600088004');
  await seedPerson(GONE, '+237600088005');
  await seedPerson(FOREIGN, '+237600088006');
  await seedPerson(INVITED, '+237600088007');
  await prisma.organization.create({ data: { id: ORG, name: 'Business', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(ORG, OWNER, 'OWNER', 1);
  await seedMember(ORG, MANAGER, 'MANAGER', 2, 20000n);
  await seedMember(ORG, SELLER, 'SELLER', 3);
  await seedMember(ORG, DRIVER, 'DRIVER', 4, 60000n);
  await seedMember(ORG, GONE, 'DRIVER', 5, 10000n, 'REVOKED');
  await seedMember(ORG, INVITED, 'DRIVER', 6, 0n, 'INVITED');
  await seedMember(OTHER_ORG, FOREIGN, 'OWNER', 7, 7000n);
});

describe('FIN-012 manager records an expense', () => {
  it('stores the expense and lowers the payer held money (AC-1, CM-17, C-27)', async () => {
    const response = await expense(MANAGER, spend(1));

    expect(response.status).toBe(201);
    const body = bodyOf<ExpenseBody>(response);
    expect(body).toMatchObject({
      id: gestureId(1),
      paid_by_id: DRIVER,
      amount: 5000,
      category: 'Carburant',
      description: null,
      recorded_by_id: MANAGER,
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        'amount',
        'category',
        'description',
        'id',
        'occurred_at',
        'paid_by_id',
        'recorded_by_id',
      ].sort()
    );
    expect(await heldBy(DRIVER)).toBe(55000n);
    expect(await heldBy(MANAGER)).toBe(20000n);
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: gestureId(1) } });
    expect(row).toMatchObject({
      organizationId: ORG,
      paidById: DRIVER,
      amount: 5000n,
      category: 'Carburant',
      recordedById: MANAGER,
      cancelledAt: null,
    });
  });

  it('lets the owner record an expense (v5.0.0-8.2.1)', async () => {
    const response = await expense(OWNER, spend(2, { description: 'plein du camion' }));

    expect(response.status).toBe(201);
    expect(bodyOf<ExpenseBody>(response)).toMatchObject({
      description: 'plein du camion',
      recorded_by_id: OWNER,
    });
    expect(await heldBy(DRIVER)).toBe(55000n);
  });

  it('takes the caller as payer when paid_by_id is omitted (AC-2)', async () => {
    const response = await expense(MANAGER, { id: gestureId(3), amount: 3000 });

    expect(response.status).toBe(201);
    expect(bodyOf<ExpenseBody>(response).paid_by_id).toBe(MANAGER);
    expect(await heldBy(MANAGER)).toBe(17000n);
    expect(await heldBy(DRIVER)).toBe(60000n);
  });

  it('keeps an occurred_at in the past and accepts a former collaborator as payer (C-27)', async () => {
    const occurredAt = '2026-09-01T10:00:00.000Z';
    const response = await expense(
      MANAGER,
      spend(4, { paid_by_id: GONE, occurred_at: occurredAt })
    );

    expect(response.status).toBe(201);
    expect(bodyOf<ExpenseBody>(response).occurred_at).toBe(occurredAt);
    expect(await heldBy(GONE)).toBe(5000n);
  });

  it('refuses each invalid request and stores nothing (AC-3, v5.0.0-15.3.3)', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const bodies: Record<string, unknown>[] = [
      spend(5, { amount: 0 }),
      spend(6, { amount: 1.5 }),
      spend(7, { amount: -5 }),
      spend(8, { occurred_at: future }),
      spend(9, { occurred_at: 'yesterday' }),
      spend(10, { category: 'x'.repeat(101) }),
      spend(11, { description: 'x'.repeat(2001) }),
      spend(12, { paid_by_id: 'not-a-uuid' }),
      spend(13, { recorded_by_id: OWNER }),
      spend(14, { organization_id: OTHER_ORG }),
      spend(15, { cancelled_at: '2026-01-01T00:00:00.000Z' }),
      { paid_by_id: DRIVER, amount: 5000 },
    ];
    for (const body of bodies) {
      const response = await expense(MANAGER, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    await nothingStored();
  });

  it('answers 404 for a payer who is not a collaborator, storing nothing (AC-3)', async () => {
    const unknown = '0199c0f5-0000-7000-8000-0000000000ee';
    for (const [n, payer] of [
      [16, unknown],
      [17, INVITED],
    ] as const) {
      const response = await expense(MANAGER, spend(n, { paid_by_id: payer }));
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
    await nothingStored();
  });

  it('refuses a CLOSED or SUSPENDED organization with ORGANIZATION_NOT_ACTIVE (AC-3)', async () => {
    for (const [n, status] of [
      [18, 'CLOSED'],
      [19, 'SUSPENDED'],
    ] as const) {
      await prisma.organization.update({ where: { id: ORG }, data: { status } });
      const response = await expense(MANAGER, spend(n));
      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
    }
    await nothingStored();
  });

  it('records the expense once and lowers the money once for a repeated id (AC-4, CWE-362)', async () => {
    const first = await expense(MANAGER, spend(20));
    const second = await expense(MANAGER, spend(20));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.expense.count()).toBe(1);
    expect(await heldBy(DRIVER)).toBe(55000n);
  });

  it('rolls the expense back when the held money cannot be lowered (v5.0.0-2.3.3)', async () => {
    // The payer's collaboration is soft-deleted: the insert is accepted, the held-money update
    // finds nothing, so the whole transaction must leave no expense behind.
    await prisma.collaboration.updateMany({
      where: { personId: GONE, organizationId: ORG },
      data: { deletedAt: new Date() },
    });

    await expect(
      prisma.$transaction((tx) =>
        recordExpenseInTx(tx, {
          id: gestureId(21),
          organizationId: ORG,
          paidById: GONE,
          amount: 5000n,
          recordedById: MANAGER,
          occurredAt: new Date(),
        })
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.expense.count()).toBe(0);
  });

  it('answers 404 for a payer whose collaboration was deleted (AC-3)', async () => {
    await prisma.collaboration.updateMany({
      where: { personId: GONE, organizationId: ORG },
      data: { deletedAt: new Date() },
    });

    const response = await expense(MANAGER, spend(26, { paid_by_id: GONE }));

    expect(response.status).toBe(404);
    expect(await prisma.expense.count()).toBe(0);
  });
});

describe('FIN-012 abuse cases', () => {
  it('refuses a SELLER or DRIVER with FORBIDDEN, storing nothing (AB-1, WSTG-ATHZ-03)', async () => {
    for (const [n, caller] of [
      [22, SELLER],
      [23, DRIVER],
    ] as const) {
      const response = await expense(caller, spend(n));
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    }
    await nothingStored();
  });

  it("answers 404 for a payer of another business's team, storing nothing (AB-2, WSTG-ATHZ-04)", async () => {
    const response = await expense(MANAGER, spend(24, { paid_by_id: FOREIGN }));

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    await nothingStored();
    expect(await heldBy(FOREIGN, OTHER_ORG)).toBe(7000n);
  });

  it("answers 404 for a manager posting to another business's organization (v5.0.0-8.2.2)", async () => {
    const response = await expense(MANAGER, spend(25), OTHER_ORG);

    expect(response.status).toBe(404);
    await nothingStored();
  });
});
