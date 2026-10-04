import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { recordHandoverInTx } from '../../../src/modules/finance/held-money.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f5-0000-7000-8000-000000000021';
const MANAGER = '0199c0f5-0000-7000-8000-000000000022';
const SELLER = '0199c0f5-0000-7000-8000-000000000023';
const DRIVER = '0199c0f5-0000-7000-8000-000000000024';
const GONE = '0199c0f5-0000-7000-8000-000000000025';
const FOREIGN = '0199c0f5-0000-7000-8000-000000000026';
const INVITED = '0199c0f5-0000-7000-8000-000000000027';

const ORG = '0199c0f5-0000-7000-8000-0000000000c1';
const OTHER_ORG = '0199c0f5-0000-7000-8000-0000000000c2';

const REG = new Date('2026-01-01T00:00:00.000Z');

const gestureId = (n: number) => `0199c0f5-0000-7000-8000-0000000008${String(n).padStart(2, '0')}`;

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
  amountHeld = 0n,
  status: 'ACTIVE' | 'REVOKED' | 'INVITED' = 'ACTIVE'
) {
  await prisma.collaboration.create({
    data: {
      id: `0199c0f5-0000-7000-8000-0000000006${n}f`,
      personId,
      organizationId: orgId,
      role,
      status,
      acceptedAt: status === 'INVITED' ? null : REG,
      amountHeld,
    },
  });
}

function handover(personId: string, body: Record<string, unknown>, organizationId = ORG) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/handovers`)
    .send(body);
}

function hand(n: number, extra: Record<string, unknown> = {}) {
  return { id: gestureId(n), from_person_id: DRIVER, amount: 55000, ...extra };
}

async function heldBy(personId: string, organizationId = ORG): Promise<bigint> {
  return (await prisma.collaboration.findFirstOrThrow({ where: { personId, organizationId } }))
    .amountHeld;
}

/** Asserts that no handover or notification exists and that nobody's held money moved. */
async function nothingStored() {
  expect(await prisma.handover.count()).toBe(0);
  expect(await prisma.notification.count()).toBe(0);
  expect(await heldBy(MANAGER)).toBe(0n);
  expect(await heldBy(DRIVER)).toBe(60000n);
  expect(await heldBy(OWNER)).toBe(0n);
}

/**
 * One business with an owner and a manager (both holding 0), a seller, a driver (holding 60000)
 * and a former driver (revoked, holding 10000); FOREIGN belongs to another business only; INVITED
 * has only an invitation.
 */
beforeEach(async () => {
  await seedPerson(OWNER, '+237600089001');
  await seedPerson(MANAGER, '+237600089002', 'Manager Fixture');
  await seedPerson(SELLER, '+237600089003');
  await seedPerson(DRIVER, '+237600089004');
  await seedPerson(GONE, '+237600089005');
  await seedPerson(FOREIGN, '+237600089006');
  await seedPerson(INVITED, '+237600089007');
  await prisma.organization.create({ data: { id: ORG, name: 'Business', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other', status: 'ACTIVE' } });
  await seedMember(ORG, OWNER, 'OWNER', 1);
  await seedMember(ORG, MANAGER, 'MANAGER', 2);
  await seedMember(ORG, SELLER, 'SELLER', 3);
  await seedMember(ORG, DRIVER, 'DRIVER', 4, 60000n);
  await seedMember(ORG, GONE, 'DRIVER', 5, 10000n, 'REVOKED');
  await seedMember(ORG, INVITED, 'DRIVER', 6, 0n, 'INVITED');
  await seedMember(OTHER_ORG, FOREIGN, 'OWNER', 7, 7000n);
});

describe('FIN-015 record a handover received', () => {
  it('stores the handover and moves the held money from remitter to receiver (AC-1, CM-17, C-27)', async () => {
    const response = await handover(MANAGER, hand(1));

    expect(response.status).toBe(201);
    const body = bodyOf<HandoverBody>(response);
    expect(body).toMatchObject({
      id: gestureId(1),
      from_person_id: DRIVER,
      to_person_id: MANAGER,
      amount: 55000,
    });
    expect(Object.keys(body).sort()).toEqual(
      ['amount', 'from_person_id', 'id', 'occurred_at', 'to_person_id'].sort()
    );
    expect(await heldBy(DRIVER)).toBe(5000n);
    expect(await heldBy(MANAGER)).toBe(55000n);
    const row = await prisma.handover.findUniqueOrThrow({ where: { id: gestureId(1) } });
    expect(row).toMatchObject({
      organizationId: ORG,
      fromPersonId: DRIVER,
      toPersonId: MANAGER,
      amount: 55000n,
      cancelledAt: null,
    });
  });

  it('lets the owner record a handover and accepts a former collaborator as remitter (C-27)', async () => {
    const occurredAt = '2026-09-01T10:00:00.000Z';
    const response = await handover(
      OWNER,
      hand(2, { from_person_id: GONE, occurred_at: occurredAt })
    );

    expect(response.status).toBe(201);
    expect(bodyOf<HandoverBody>(response)).toMatchObject({
      to_person_id: OWNER,
      occurred_at: occurredAt,
    });
    expect(await heldBy(GONE)).toBe(-45000n);
    expect(await heldBy(OWNER)).toBe(55000n);
  });

  it('tells the remitter the noted amount and what remains (AC-2, AB-2, CWE-778)', async () => {
    await handover(MANAGER, hand(3));

    const rows = await prisma.notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientId: DRIVER,
      sourceEvent: 'handover.recorded',
      readStatus: 'UNREAD',
      organizationId: ORG,
      relatedEntityType: 'handover',
      relatedEntityId: gestureId(3),
    });
    expect(rows[0]?.content).toBe(
      'Manager Fixture a noté avoir reçu 55000 de vous. Il vous reste 5000 à remettre.'
    );
  });

  it('shows the lower noted amount and the larger remainder to the remitter (AB-2)', async () => {
    await handover(MANAGER, hand(4, { amount: 20000 }));

    const row = await prisma.notification.findFirstOrThrow();
    expect(row.content).toContain('20000');
    expect(row.content).toContain('40000');
  });

  it('accepts more than the remitter holds and leaves a negative amount (AC-3)', async () => {
    const response = await handover(MANAGER, hand(5, { amount: 70000 }));

    expect(response.status).toBe(201);
    expect(await heldBy(DRIVER)).toBe(-10000n);
    expect(await heldBy(MANAGER)).toBe(70000n);
    const row = await prisma.notification.findFirstOrThrow();
    expect(row.content).toContain('-10000');
  });

  it('refuses a remitter equal to the caller with VALIDATION_ERROR, storing nothing (AC-4)', async () => {
    const response = await handover(MANAGER, hand(6, { from_person_id: MANAGER }));

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    await nothingStored();
  });

  it('answers 404 for a remitter who is not a collaborator, storing nothing (AC-4)', async () => {
    const unknown = '0199c0f5-0000-7000-8000-0000000000ee';
    for (const [n, remitter] of [
      [7, unknown],
      [8, INVITED],
      [9, FOREIGN],
    ] as const) {
      const response = await handover(MANAGER, hand(n, { from_person_id: remitter }));
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }
    await nothingStored();
    expect(await heldBy(FOREIGN, OTHER_ORG)).toBe(7000n);
  });

  it('refuses each invalid body and stores nothing (AC-4, v5.0.0-15.3.3)', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const bodies: Record<string, unknown>[] = [
      hand(10, { amount: 0 }),
      hand(11, { amount: 1.5 }),
      hand(12, { amount: -5 }),
      hand(13, { occurred_at: future }),
      hand(14, { occurred_at: 'yesterday' }),
      hand(15, { from_person_id: 'not-a-uuid' }),
      hand(16, { to_person_id: OWNER }),
      hand(17, { organization_id: OTHER_ORG }),
      hand(18, { cancelled_at: '2026-01-01T00:00:00.000Z' }),
      { amount: 5000 },
      { id: gestureId(19), amount: 5000 },
    ];
    for (const body of bodies) {
      const response = await handover(MANAGER, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    await nothingStored();
  });

  it('refuses a CLOSED or SUSPENDED organization with ORGANIZATION_NOT_ACTIVE', async () => {
    for (const [n, status] of [
      [20, 'CLOSED'],
      [21, 'SUSPENDED'],
    ] as const) {
      await prisma.organization.update({ where: { id: ORG }, data: { status } });
      const response = await handover(MANAGER, hand(n));
      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
    }
    await nothingStored();
  });

  it('records the handover once and moves the money once for a repeated id (AC-5)', async () => {
    const first = await handover(MANAGER, hand(22));
    const second = await handover(MANAGER, hand(22));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.handover.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(1);
    expect(await heldBy(DRIVER)).toBe(5000n);
    expect(await heldBy(MANAGER)).toBe(55000n);
  });

  it('only lowers the amount when remitter and receiver are the same person (CM-17)', async () => {
    // The database accepts the former owner's automatic handover: remitter and receiver are one.
    await prisma.collaboration.updateMany({
      where: { personId: MANAGER, organizationId: ORG },
      data: { amountHeld: 8000n },
    });
    await prisma.$transaction((tx) =>
      recordHandoverInTx(tx, {
        id: gestureId(24),
        organizationId: ORG,
        fromPersonId: MANAGER,
        toPersonId: MANAGER,
        amount: 3000n,
        occurredAt: new Date(),
      })
    );

    expect(await heldBy(MANAGER)).toBe(5000n);
  });

  it('rolls the handover back when a held-money update finds nothing (v5.0.0-2.3.3)', async () => {
    await prisma.collaboration.updateMany({
      where: { personId: GONE, organizationId: ORG },
      data: { deletedAt: new Date() },
    });

    await expect(
      prisma.$transaction((tx) =>
        recordHandoverInTx(tx, {
          id: gestureId(25),
          organizationId: ORG,
          fromPersonId: GONE,
          toPersonId: MANAGER,
          amount: 5000n,
          occurredAt: new Date(),
        })
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.handover.count()).toBe(0);
    expect(await heldBy(MANAGER)).toBe(0n);
  });
});

describe('FIN-015 abuse cases', () => {
  it('refuses a SELLER or DRIVER with FORBIDDEN, storing nothing (AB-1, AC-4, WSTG-ATHZ-03)', async () => {
    for (const [n, caller] of [
      [26, SELLER],
      [27, DRIVER],
    ] as const) {
      const response = await handover(caller, hand(n, { from_person_id: GONE }));
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    }
    await nothingStored();
  });

  it("answers 404 for a manager posting to another business's organization (v5.0.0-8.2.2)", async () => {
    const response = await handover(MANAGER, hand(28), OTHER_ORG);

    expect(response.status).toBe(404);
    await nothingStored();
  });
});
