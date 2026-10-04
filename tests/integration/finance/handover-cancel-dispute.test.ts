import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { recordHandoverInTx } from '../../../src/modules/finance/held-money.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f5-0000-7000-8000-000000000021';
const MANAGER = '0199c0f5-0000-7000-8000-000000000022';
const MANAGER_2 = '0199c0f5-0000-7000-8000-000000000023';
const SELLER = '0199c0f5-0000-7000-8000-000000000024';
const DRIVER = '0199c0f5-0000-7000-8000-000000000025';
const DRIVER_2 = '0199c0f5-0000-7000-8000-000000000026';
const FOREIGN = '0199c0f5-0000-7000-8000-000000000027';

const ORG = '0199c0f5-0000-7000-8000-0000000000c1';
const OTHER_ORG = '0199c0f5-0000-7000-8000-0000000000c2';

const HANDOVER = '0199c0f5-0000-7000-8000-0000000007a1';
const FOREIGN_HANDOVER = '0199c0f5-0000-7000-8000-0000000007a2';

const REG = new Date('2026-01-01T00:00:00.000Z');

const gestureId = (n: number) => `0199c0f5-0000-7000-8000-0000000009${String(n).padStart(2, '0')}`;

type HandoverBody = {
  id: string;
  from_person_id: string;
  to_person_id: string;
  amount: number;
  occurred_at: string;
};

async function seedPerson(id: string, phone: string, fullName = 'Fixture Person') {
  await prisma.person.create({
    data: {
      id,
      fullName,
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

function cancel(personId: string, body: Record<string, unknown>, id = HANDOVER, org = ORG) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${org}/handovers/${id}/cancel`)
    .send(body);
}

function dispute(personId: string, body: Record<string, unknown>, id = HANDOVER, org = ORG) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${org}/handovers/${id}/dispute`)
    .send(body);
}

async function heldBy(personId: string, organizationId = ORG): Promise<bigint> {
  return (await prisma.collaboration.findFirstOrThrow({ where: { personId, organizationId } }))
    .amountHeld;
}

/** Asserts that the handover is live, the caches are as after it and nobody was notified. */
async function nothingChanged() {
  const row = await prisma.handover.findUniqueOrThrow({ where: { id: HANDOVER } });
  expect(row.cancelledAt).toBeNull();
  expect(row.cancelledById).toBeNull();
  expect(await heldBy(DRIVER)).toBe(5000n);
  expect(await heldBy(MANAGER)).toBe(55000n);
  expect(await prisma.notification.count()).toBe(0);
}

/**
 * One business with an owner, two managers, a seller and two drivers; DRIVER handed 55000 to
 * MANAGER (held 60000 -> 5000 and 0 -> 55000); FOREIGN owns another business with a handover.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600089001', 'Owner Fixture');
  await seedPerson(MANAGER, '+237600089002', 'Manager Fixture');
  await seedPerson(MANAGER_2, '+237600089003');
  await seedPerson(SELLER, '+237600089004');
  await seedPerson(DRIVER, '+237600089005', 'Driver Fixture');
  await seedPerson(DRIVER_2, '+237600089006');
  await seedPerson(FOREIGN, '+237600089007');
  await prisma.organization.create({ data: { id: ORG, name: 'Business', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(ORG, OWNER, 'OWNER', 1);
  await seedMember(ORG, MANAGER, 'MANAGER', 2);
  await seedMember(ORG, MANAGER_2, 'MANAGER', 3);
  await seedMember(ORG, SELLER, 'SELLER', 4);
  await seedMember(ORG, DRIVER, 'DRIVER', 5, 60000n);
  await seedMember(ORG, DRIVER_2, 'DRIVER', 6, 3000n);
  await seedMember(OTHER_ORG, FOREIGN, 'OWNER', 7, 9000n);
  await prisma.$transaction(async (tx) => {
    await recordHandoverInTx(tx, {
      id: HANDOVER,
      organizationId: ORG,
      fromPersonId: DRIVER,
      toPersonId: MANAGER,
      amount: 55000n,
      occurredAt: new Date('2026-09-01T10:00:00.000Z'),
    });
    await recordHandoverInTx(tx, {
      id: FOREIGN_HANDOVER,
      organizationId: OTHER_ORG,
      fromPersonId: FOREIGN,
      toPersonId: FOREIGN,
      amount: 2000n,
      occurredAt: new Date('2026-09-01T10:00:00.000Z'),
    });
  });
});

describe('FIN-016 cancel a handover', () => {
  it('sets the cancellation fields and restores both caches (AC-1, C-27)', async () => {
    const response = await cancel(MANAGER_2, { id: gestureId(1) });

    expect(response.status).toBe(200);
    const body = bodyOf<HandoverBody>(response);
    expect(body).toMatchObject({
      id: HANDOVER,
      from_person_id: DRIVER,
      to_person_id: MANAGER,
      amount: 55000,
    });
    expect(Object.keys(body).sort()).toEqual(
      ['amount', 'from_person_id', 'id', 'occurred_at', 'to_person_id'].sort()
    );
    expect(await heldBy(DRIVER)).toBe(60000n);
    expect(await heldBy(MANAGER)).toBe(0n);
    const row = await prisma.handover.findUniqueOrThrow({ where: { id: HANDOVER } });
    expect(row.cancelledById).toBe(MANAGER_2);
    expect(row.cancelledAt).not.toBeNull();
    expect(row.amount).toBe(55000n);
  });

  it('lets the owner cancel (v5.0.0-8.2.1)', async () => {
    const response = await cancel(OWNER, { id: gestureId(2) });

    expect(response.status).toBe(200);
    const row = await prisma.handover.findUniqueOrThrow({ where: { id: HANDOVER } });
    expect(row.cancelledById).toBe(OWNER);
    expect(await heldBy(DRIVER)).toBe(60000n);
    expect(await heldBy(MANAGER)).toBe(0n);
  });

  it('restores only the remitter for the former owner automatic handover (C-27)', async () => {
    const response = await cancel(FOREIGN, { id: gestureId(3) }, FOREIGN_HANDOVER, OTHER_ORG);

    expect(response.status).toBe(200);
    expect(await heldBy(FOREIGN, OTHER_ORG)).toBe(9000n);
  });

  it('refuses a second cancellation (AC-3)', async () => {
    expect((await cancel(MANAGER, { id: gestureId(4) })).status).toBe(200);

    const again = await cancel(MANAGER_2, { id: gestureId(5) });
    expect(again.status).toBe(409);
    expect(bodyOf<ErrorBody>(again).error.code).toBe('ALREADY_CANCELLED');
    expect(await heldBy(DRIVER)).toBe(60000n);
    expect(await heldBy(MANAGER)).toBe(0n);
  });

  it('refuses a SELLER and a DRIVER with FORBIDDEN (AC-3, v5.0.0-8.2.1)', async () => {
    for (const [n, caller] of [
      [6, SELLER],
      [7, DRIVER],
    ] as const) {
      const response = await cancel(caller, { id: gestureId(n) });
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    }
    await nothingChanged();
  });

  it('answers 404 for another business, an unknown id and a foreign path (AC-3, v5.0.0-8.2.2)', async () => {
    const foreign = await cancel(MANAGER, { id: gestureId(8) }, FOREIGN_HANDOVER);
    expect(foreign.status).toBe(404);
    expect(bodyOf<ErrorBody>(foreign).error.code).toBe('NOT_FOUND');

    const unknown = await cancel(
      MANAGER,
      { id: gestureId(9) },
      '0199c0f5-0000-7000-8000-0000000007ee'
    );
    expect(unknown.status).toBe(404);

    const outside = await cancel(MANAGER, { id: gestureId(10) }, HANDOVER, OTHER_ORG);
    expect(outside.status).toBe(404);
    await nothingChanged();
    const foreignRow = await prisma.handover.findUniqueOrThrow({ where: { id: FOREIGN_HANDOVER } });
    expect(foreignRow.cancelledAt).toBeNull();
    expect(await heldBy(FOREIGN, OTHER_ORG)).toBe(7000n);
  });

  it('restores the money once when two managers cancel at once (CWE-362)', async () => {
    const [a, b] = await Promise.all([
      cancel(MANAGER, { id: gestureId(11) }),
      cancel(MANAGER_2, { id: gestureId(12) }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await heldBy(DRIVER)).toBe(60000n);
    expect(await heldBy(MANAGER)).toBe(0n);
  });

  it('returns the first response and restores once for a repeated id (ACC idempotency)', async () => {
    const first = await cancel(MANAGER, { id: gestureId(13) });
    const second = await cancel(MANAGER, { id: gestureId(13) });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await heldBy(DRIVER)).toBe(60000n);
  });

  it('rejects a malformed path id, a missing id and unknown body fields (v5.0.0-15.3.3)', async () => {
    expect((await cancel(MANAGER, { id: gestureId(14) }, 'not-a-uuid')).status).toBe(400);
    expect((await cancel(MANAGER, {})).status).toBe(400);
    expect((await cancel(MANAGER, { id: gestureId(15), cancelled_by_id: OWNER })).status).toBe(400);
    await nothingChanged();
  });

  it('rolls the cancellation back when a held-money cache cannot be restored (v5.0.0-2.3.3)', async () => {
    await prisma.collaboration.updateMany({
      where: { personId: MANAGER, organizationId: ORG },
      data: { deletedAt: new Date() },
    });

    const response = await cancel(OWNER, { id: gestureId(16) });

    expect(response.status).toBe(404);
    const row = await prisma.handover.findUniqueOrThrow({ where: { id: HANDOVER } });
    expect(row.cancelledAt).toBeNull();
    expect(await heldBy(DRIVER)).toBe(5000n);
  });
});

describe('FIN-016 dispute a handover', () => {
  it('notifies the owner and changes no amount (AC-2)', async () => {
    const response = await dispute(DRIVER, { id: gestureId(20), comment: 'I gave 60000' });

    expect(response.status).toBe(200);
    const notes = await prisma.notification.findMany();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      recipientId: OWNER,
      sourceEvent: 'handover.disputed',
      relatedEntityType: 'handover',
      relatedEntityId: HANDOVER,
      readStatus: 'UNREAD',
    });
    expect(notes[0]?.content).toContain('55000');
    expect(notes[0]?.content).toContain('Driver Fixture');
    expect(await heldBy(DRIVER)).toBe(5000n);
    expect(await heldBy(MANAGER)).toBe(55000n);
    const row = await prisma.handover.findUniqueOrThrow({ where: { id: HANDOVER } });
    expect(row.cancelledAt).toBeNull();
    expect(row.amount).toBe(55000n);
  });

  it('accepts a dispute without a comment and refuses a comment over 2000 characters', async () => {
    expect((await dispute(DRIVER, { id: gestureId(21) })).status).toBe(200);
    const tooLong = await dispute(DRIVER, { id: gestureId(22), comment: 'x'.repeat(2001) });
    expect(tooLong.status).toBe(400);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('refuses someone who is not the remitter with 404 (AC-3, v5.0.0-8.2.2)', async () => {
    for (const [n, caller] of [
      [23, DRIVER_2],
      [24, MANAGER],
      [25, OWNER],
      [26, SELLER],
    ] as const) {
      const response = await dispute(caller, { id: gestureId(n) });
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
    await nothingChanged();
  });

  it('answers 404 for another business handover and an unknown id (AC-3)', async () => {
    const foreign = await dispute(DRIVER, { id: gestureId(27) }, FOREIGN_HANDOVER);
    expect(foreign.status).toBe(404);
    const unknown = await dispute(
      DRIVER,
      { id: gestureId(28) },
      '0199c0f5-0000-7000-8000-0000000007ee'
    );
    expect(unknown.status).toBe(404);
    const outside = await dispute(FOREIGN, { id: gestureId(29) }, HANDOVER, OTHER_ORG);
    expect(outside.status).toBe(404);
    await nothingChanged();
  });

  it('creates one notification when the same id is posted twice (AC-4)', async () => {
    const first = await dispute(DRIVER, { id: gestureId(30) });
    const second = await dispute(DRIVER, { id: gestureId(30) });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('rejects unknown body fields and a malformed path id (v5.0.0-15.3.3)', async () => {
    expect((await dispute(DRIVER, { id: gestureId(31), to: OWNER })).status).toBe(400);
    expect((await dispute(DRIVER, { id: gestureId(32) }, 'not-a-uuid')).status).toBe(400);
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe('FIN-016 abuse cases', () => {
  it('shows the remitter dispute to the owner while the noted amount stays (AB-1, CWE-778)', async () => {
    const response = await dispute(DRIVER, { id: gestureId(40) });

    expect(response.status).toBe(200);
    expect(await prisma.notification.count({ where: { recipientId: OWNER } })).toBe(1);
    const row = await prisma.handover.findUniqueOrThrow({ where: { id: HANDOVER } });
    expect(row.amount).toBe(55000n);
    expect(row.cancelledAt).toBeNull();
  });

  it('creates no notification when another collaborator disputes (AB-2, WSTG-ATHZ-04)', async () => {
    const response = await dispute(DRIVER_2, { id: gestureId(41), comment: 'not mine' });

    expect(response.status).toBe(404);
    expect(await prisma.notification.count()).toBe(0);
  });
});
