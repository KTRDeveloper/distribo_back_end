import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { recordExpenseInTx } from '../../../src/modules/finance/held-money.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f5-0000-7000-8000-000000000021';
const MANAGER = '0199c0f5-0000-7000-8000-000000000022';
const MANAGER_2 = '0199c0f5-0000-7000-8000-000000000023';
const SELLER = '0199c0f5-0000-7000-8000-000000000024';
const DRIVER = '0199c0f5-0000-7000-8000-000000000025';
const FOREIGN = '0199c0f5-0000-7000-8000-000000000026';

const ORG = '0199c0f5-0000-7000-8000-0000000000c1';
const OTHER_ORG = '0199c0f5-0000-7000-8000-0000000000c2';

const EXPENSE = '0199c0f5-0000-7000-8000-0000000008a1';
const FOREIGN_EXPENSE = '0199c0f5-0000-7000-8000-0000000008a2';

const REG = new Date('2026-01-01T00:00:00.000Z');

const gestureId = (n: number) => `0199c0f5-0000-7000-8000-0000000009${String(n).padStart(2, '0')}`;

type CancelledBody = {
  id: string;
  paid_by_id: string;
  amount: number;
  recorded_by_id: string;
  cancelled_at: string | null;
  cancelled_by_id: string | null;
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
      id: `0199c0f5-0000-7000-8000-0000000006${n}f`,
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
      amountHeld,
    },
  });
}

function cancel(personId: string, body: Record<string, unknown>, expenseId = EXPENSE, org = ORG) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${org}/expenses/${expenseId}/cancel`)
    .send(body);
}

async function heldBy(personId: string, organizationId = ORG): Promise<bigint> {
  return (await prisma.collaboration.findFirstOrThrow({ where: { personId, organizationId } }))
    .amountHeld;
}

/** Asserts that the expense is still live and the payer's money is as after the expense. */
async function expenseUntouched() {
  const row = await prisma.expense.findUniqueOrThrow({ where: { id: EXPENSE } });
  expect(row.cancelledAt).toBeNull();
  expect(row.cancelledById).toBeNull();
  expect(await heldBy(DRIVER)).toBe(55000n);
}

/**
 * One business with an owner, two managers, a seller and a driver who paid an expense of 5000
 * (held 60000 before, 55000 after); FOREIGN owns another business with an expense of its own.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600089001');
  await seedPerson(MANAGER, '+237600089002');
  await seedPerson(MANAGER_2, '+237600089003');
  await seedPerson(SELLER, '+237600089004');
  await seedPerson(DRIVER, '+237600089005');
  await seedPerson(FOREIGN, '+237600089006');
  await prisma.organization.create({ data: { id: ORG, name: 'Business', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(ORG, OWNER, 'OWNER', 1);
  await seedMember(ORG, MANAGER, 'MANAGER', 2);
  await seedMember(ORG, MANAGER_2, 'MANAGER', 3);
  await seedMember(ORG, SELLER, 'SELLER', 4);
  await seedMember(ORG, DRIVER, 'DRIVER', 5, 60000n);
  await seedMember(OTHER_ORG, FOREIGN, 'OWNER', 6, 9000n);
  await prisma.$transaction(async (tx) => {
    await recordExpenseInTx(tx, {
      id: EXPENSE,
      organizationId: ORG,
      paidById: DRIVER,
      amount: 5000n,
      recordedById: MANAGER,
      occurredAt: new Date('2026-09-01T10:00:00.000Z'),
    });
    await recordExpenseInTx(tx, {
      id: FOREIGN_EXPENSE,
      organizationId: OTHER_ORG,
      paidById: FOREIGN,
      amount: 2000n,
      recordedById: FOREIGN,
      occurredAt: new Date('2026-09-01T10:00:00.000Z'),
    });
  });
});

describe('FIN-013 manager cancels an expense', () => {
  it('sets the cancellation fields and restores the payer held money (AC-1, C-27)', async () => {
    const response = await cancel(MANAGER_2, { id: gestureId(1) });

    expect(response.status).toBe(200);
    const body = bodyOf<CancelledBody>(response);
    expect(body).toMatchObject({
      id: EXPENSE,
      paid_by_id: DRIVER,
      amount: 5000,
      recorded_by_id: MANAGER,
      cancelled_by_id: MANAGER_2,
    });
    expect(typeof body.cancelled_at).toBe('string');
    expect(Object.keys(body).sort()).toEqual(
      [
        'amount',
        'cancelled_at',
        'cancelled_by_id',
        'category',
        'description',
        'id',
        'occurred_at',
        'paid_by_id',
        'recorded_by_id',
      ].sort()
    );
    expect(await heldBy(DRIVER)).toBe(60000n);
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: EXPENSE } });
    expect(row.cancelledById).toBe(MANAGER_2);
    expect(row.cancelledAt).not.toBeNull();
    expect(row.amount).toBe(5000n);
  });

  it('lets the owner cancel (v5.0.0-8.2.1)', async () => {
    const response = await cancel(OWNER, { id: gestureId(2) });

    expect(response.status).toBe(200);
    expect(bodyOf<CancelledBody>(response).cancelled_by_id).toBe(OWNER);
    expect(await heldBy(DRIVER)).toBe(60000n);
  });

  it('refuses a second cancellation, a foreign expense and a seller (AC-2)', async () => {
    expect((await cancel(MANAGER, { id: gestureId(3) })).status).toBe(200);

    const again = await cancel(MANAGER_2, { id: gestureId(4) });
    expect(again.status).toBe(409);
    expect(bodyOf<ErrorBody>(again).error.code).toBe('ALREADY_CANCELLED');
    expect(await heldBy(DRIVER)).toBe(60000n);

    const foreign = await cancel(MANAGER, { id: gestureId(5) }, FOREIGN_EXPENSE);
    expect(foreign.status).toBe(404);
    expect(bodyOf<ErrorBody>(foreign).error.code).toBe('NOT_FOUND');

    const seller = await cancel(SELLER, { id: gestureId(6) });
    expect(seller.status).toBe(403);
    expect(bodyOf<ErrorBody>(seller).error.code).toBe('FORBIDDEN');
  });

  it('answers 404 for an unknown expense and a foreign organization path (v5.0.0-8.2.2)', async () => {
    const unknown = await cancel(
      MANAGER,
      { id: gestureId(7) },
      '0199c0f5-0000-7000-8000-0000000008ee'
    );
    expect(unknown.status).toBe(404);

    const outside = await cancel(MANAGER, { id: gestureId(8) }, FOREIGN_EXPENSE, OTHER_ORG);
    expect(outside.status).toBe(404);
    await expenseUntouched();
    expect(await heldBy(FOREIGN, OTHER_ORG)).toBe(7000n);
    const foreignRow = await prisma.expense.findUniqueOrThrow({ where: { id: FOREIGN_EXPENSE } });
    expect(foreignRow.cancelledAt).toBeNull();
  });

  it('restores the money once when two managers cancel at once (AC-3, CWE-362)', async () => {
    const [a, b] = await Promise.all([
      cancel(MANAGER, { id: gestureId(9) }),
      cancel(MANAGER_2, { id: gestureId(10) }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(bodyOf<ErrorBody>(loser).error.code).toBe('ALREADY_CANCELLED');
    expect(await heldBy(DRIVER)).toBe(60000n);
  });

  it('returns the first response and restores once for a repeated id (CM-17, ACC idempotency)', async () => {
    const first = await cancel(MANAGER, { id: gestureId(11) });
    const second = await cancel(MANAGER, { id: gestureId(11) });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await heldBy(DRIVER)).toBe(60000n);
  });

  it('rejects a malformed path id, a missing id and unknown body fields (v5.0.0-15.3.3)', async () => {
    const badPath = await cancel(MANAGER, { id: gestureId(12) }, 'not-a-uuid');
    expect(badPath.status).toBe(400);
    expect((await cancel(MANAGER, {})).status).toBe(400);
    expect((await cancel(MANAGER, { id: gestureId(13), cancelled_by_id: OWNER })).status).toBe(400);
    await expenseUntouched();
  });

  it('rolls the cancellation back when the payer money cannot be restored (v5.0.0-2.3.3)', async () => {
    await prisma.collaboration.updateMany({
      where: { personId: DRIVER, organizationId: ORG },
      data: { deletedAt: new Date() },
    });

    const response = await cancel(MANAGER, { id: gestureId(14) });

    expect(response.status).toBe(404);
    const row = await prisma.expense.findUniqueOrThrow({ where: { id: EXPENSE } });
    expect(row.cancelledAt).toBeNull();
    expect(row.cancelledById).toBeNull();
  });
});

describe('FIN-013 abuse cases', () => {
  it('refuses a SELLER or DRIVER with FORBIDDEN, leaving the expense unchanged (AB-1, WSTG-ATHZ-03)', async () => {
    for (const [n, caller] of [
      [15, SELLER],
      [16, DRIVER],
    ] as const) {
      const response = await cancel(caller, { id: gestureId(n) });
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    }
    await expenseUntouched();
  });
});
