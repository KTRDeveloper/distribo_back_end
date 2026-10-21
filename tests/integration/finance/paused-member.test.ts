import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f6-0000-7000-8000-000000000011';
const MEMBER = '0199c0f6-0000-7000-8000-000000000012';
const FOREIGN = '0199c0f6-0000-7000-8000-000000000013';
const FOREIGN_OWNER = '0199c0f6-0000-7000-8000-000000000014';
const ORG = '0199c0f6-0000-7000-8000-000000000021';
const OTHER_ORG = '0199c0f6-0000-7000-8000-000000000022';
const OWNER_COLLAB = '0199c0f6-0000-7000-8000-000000000031';
const MEMBER_COLLAB = '0199c0f6-0000-7000-8000-000000000032';
const FOREIGN_COLLAB = '0199c0f6-0000-7000-8000-000000000033';
const GESTURE = '0199c0f6-0000-7000-8000-000000000041';
const REG = new Date('2026-01-01T00:00:00.000Z');

type Operation = 'handovers' | 'expenses';

/** Sends an owner's gesture without deriving tenant scope from the named member. */
function record(operation: Operation, memberId = MEMBER) {
  return createAuthenticatedRequest(app, OWNER)
    .post(`/api/v1/organizations/${ORG}/${operation}`)
    .send({
      id: GESTURE,
      amount: 4000,
      ...(operation === 'handovers' ? { from_person_id: memberId } : { paid_by_id: memberId }),
    });
}

/** Reads held money independently of the HTTP response. */
async function heldBy(id: string): Promise<bigint> {
  return (await prisma.collaboration.findUniqueOrThrow({ where: { id } })).amountHeld;
}

/** Verifies rejected operations leave rows, notices and all held balances untouched. */
async function nothingStored() {
  expect(await prisma.handover.count()).toBe(0);
  expect(await prisma.expense.count()).toBe(0);
  expect(await prisma.notification.count()).toBe(0);
  expect(await heldBy(OWNER_COLLAB)).toBe(0n);
  expect(await heldBy(MEMBER_COLLAB)).toBe(10000n);
  expect(await heldBy(FOREIGN_COLLAB)).toBe(10000n);
}

beforeEach(async () => {
  await prisma.person.createMany({
    data: [OWNER, MEMBER, FOREIGN, FOREIGN_OWNER].map((id, index) => ({
      id,
      fullName: 'Fixture Person',
      phoneNumber: `+23760009100${index + 1}`,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    })),
  });
  await prisma.organization.createMany({
    data: [
      { id: ORG, name: 'Fixture Business', status: 'ACTIVE' },
      { id: OTHER_ORG, name: 'Other Fixture Business', status: 'ACTIVE' },
    ],
  });
  await prisma.collaboration.createMany({
    data: [
      {
        id: OWNER_COLLAB,
        personId: OWNER,
        organizationId: ORG,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
      {
        id: MEMBER_COLLAB,
        personId: MEMBER,
        organizationId: ORG,
        role: 'DRIVER',
        status: 'PAUSED',
        acceptedAt: REG,
        amountHeld: 10000n,
      },
      {
        id: '0199c0f6-0000-7000-8000-000000000034',
        personId: FOREIGN_OWNER,
        organizationId: OTHER_ORG,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
      {
        id: FOREIGN_COLLAB,
        personId: FOREIGN,
        organizationId: OTHER_ORG,
        role: 'DRIVER',
        status: 'PAUSED',
        acceptedAt: REG,
        amountHeld: 10000n,
      },
    ],
  });
});

describe('FIN-021 paused members retain accountable held money', () => {
  it.each([
    ['ACTIVE', 201],
    ['PAUSED', 201],
    ['REVOKED', 201],
    ['INVITED', 404],
  ] as const)('handover from a %s member answers %i (AC-1)', async (status, expected) => {
    await prisma.collaboration.update({
      where: { id: MEMBER_COLLAB },
      data: { status, acceptedAt: status === 'INVITED' ? null : REG },
    });

    const response = await record('handovers');

    expect(response.status).toBe(expected);
    if (expected === 404) {
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      await nothingStored();
    } else {
      expect(await prisma.handover.count()).toBe(1);
    }
  });

  it('moves 4000 from the paused member to the owner and notifies the member (AC-2)', async () => {
    const response = await record('handovers');

    expect(response.status).toBe(201);
    expect(await heldBy(MEMBER_COLLAB)).toBe(6000n);
    expect(await heldBy(OWNER_COLLAB)).toBe(4000n);
    expect(await prisma.notification.findMany()).toMatchObject([
      {
        recipientId: MEMBER,
        organizationId: ORG,
        sourceEvent: 'handover.recorded',
        relatedEntityId: GESTURE,
      },
    ]);
  });

  it.each([
    ['PAUSED', 201],
    ['INVITED', 404],
  ] as const)('expense paid by a %s member answers %i (AC-3)', async (status, expected) => {
    await prisma.collaboration.update({
      where: { id: MEMBER_COLLAB },
      data: { status, acceptedAt: status === 'INVITED' ? null : REG },
    });

    const response = await record('expenses');

    expect(response.status).toBe(expected);
    if (expected === 404) {
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      await nothingStored();
    } else {
      expect(await prisma.expense.count()).toBe(1);
      expect(await heldBy(MEMBER_COLLAB)).toBe(6000n);
      expect(await heldBy(OWNER_COLLAB)).toBe(0n);
    }
  });

  it.each(['handovers', 'expenses'] as const)(
    'refuses %s naming a paused member of another business without effects (AB-1, tenant scope)',
    async (operation) => {
      const response = await record(operation, FOREIGN);

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      await nothingStored();
    }
  );

  it.each(['handovers', 'expenses'] as const)(
    'repeats %s for a paused member without moving money twice (ACC)',
    async (operation) => {
      const first = await record(operation);
      const second = await record(operation);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(await heldBy(MEMBER_COLLAB)).toBe(6000n);
      expect(await heldBy(OWNER_COLLAB)).toBe(operation === 'handovers' ? 4000n : 0n);
      expect(await prisma.handover.count()).toBe(operation === 'handovers' ? 1 : 0);
      expect(await prisma.expense.count()).toBe(operation === 'expenses' ? 1 : 0);
      expect(await prisma.notification.count()).toBe(operation === 'handovers' ? 1 : 0);
    }
  );
});
