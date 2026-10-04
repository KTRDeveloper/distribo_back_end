import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0f6-0000-7000-8000-000000000031';
const MANAGER = '0199c0f6-0000-7000-8000-000000000032';
const OTHER_OWNER = '0199c0f6-0000-7000-8000-000000000033';

const ORG = '0199c0f6-0000-7000-8000-0000000000a1';
const OTHER_ORG = '0199c0f6-0000-7000-8000-0000000000b1';

const OWNER_ROW = '0199c0f6-0000-7000-8000-0000000000a9';
const MANAGER_ROW = '0199c0f6-0000-7000-8000-0000000000a2';
const OTHER_OWNER_ROW = '0199c0f6-0000-7000-8000-0000000000b9';

const GESTURE = '0199c0f6-0000-7000-8000-0000000000c1';
const GESTURE_2 = '0199c0f6-0000-7000-8000-0000000000c2';

const REG = new Date('2026-01-01T00:00:00.000Z');

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
  id: string,
  personId: string,
  organizationId: string,
  role: 'OWNER' | 'MANAGER',
  amountHeld = 0n
) {
  await prisma.collaboration.create({
    data: { id, personId, organizationId, role, status: 'ACTIVE', acceptedAt: REG, amountHeld },
  });
}

function transfer(personId = OWNER, gesture = GESTURE, target = MANAGER_ROW, org = ORG) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${org}/transfer-ownership`)
    .send({ id: gesture, collaboration_id: target });
}

async function heldBy(personId: string, organizationId = ORG): Promise<bigint> {
  return (await prisma.collaboration.findFirstOrThrow({ where: { personId, organizationId } }))
    .amountHeld;
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600170001');
  await seedPerson(MANAGER, '+237600170002');
  await seedPerson(OTHER_OWNER, '+237600170003');
  await prisma.organization.create({ data: { id: ORG, name: 'Org A' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Org B' } });
  await seedMember(OWNER_ROW, OWNER, ORG, 'OWNER', 3_450_000n);
  await seedMember(MANAGER_ROW, MANAGER, ORG, 'MANAGER', 100_000n);
  await seedMember(OTHER_OWNER_ROW, OTHER_OWNER, OTHER_ORG, 'OWNER', 777n);
});

describe('FIN-017 ownership transfer hands over the former owner money', () => {
  it('AC-1 automatic: a handover from and to the former owner, held falls to 0', async () => {
    const before = Date.now();
    const response = await transfer();

    expect(response.status).toBe(200);
    const rows = await prisma.handover.findMany({ where: { organizationId: ORG } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.fromPersonId).toBe(OWNER);
    expect(row.toPersonId).toBe(OWNER);
    expect(row.amount).toBe(3_450_000n);
    expect(row.cancelledAt).toBeNull();
    expect(row.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(row.occurredAt.getTime()).toBeLessThanOrEqual(Date.now() + 5000);
    expect(await heldBy(OWNER)).toBe(0n);
  });

  it('AC-1 only the fall applies: the new owner and other organizations keep their held money', async () => {
    await transfer();

    expect(await heldBy(MANAGER)).toBe(100_000n);
    expect(await heldBy(OTHER_OWNER, OTHER_ORG)).toBe(777n);
    expect(await prisma.handover.count({ where: { organizationId: OTHER_ORG } })).toBe(0);
  });

  it('AC-2 nothing held: no handover row is written', async () => {
    await prisma.collaboration.update({ where: { id: OWNER_ROW }, data: { amountHeld: 0n } });

    const response = await transfer();

    expect(response.status).toBe(200);
    expect(await prisma.handover.count()).toBe(0);
    expect(await heldBy(OWNER)).toBe(0n);
  });

  it('AC-2 a negative amount held writes no handover and is left as is', async () => {
    await prisma.collaboration.update({ where: { id: OWNER_ROW }, data: { amountHeld: -5000n } });

    const response = await transfer();

    expect(response.status).toBe(200);
    expect(await prisma.handover.count()).toBe(0);
    expect(await heldBy(OWNER)).toBe(-5000n);
  });

  it('AC-3 atomic: a failing handover insert leaves the ownership and the money unchanged', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fin017_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced failure';
      END; $$`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fin017_fail BEFORE INSERT ON handovers
      FOR EACH ROW EXECUTE FUNCTION test_fin017_fail()`);

    try {
      const response = await transfer();
      expect(response.status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fin017_fail ON handovers');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fin017_fail()');
    }

    const owner = await prisma.collaboration.findUniqueOrThrow({ where: { id: OWNER_ROW } });
    const manager = await prisma.collaboration.findUniqueOrThrow({ where: { id: MANAGER_ROW } });
    expect(owner.role).toBe('OWNER');
    expect(owner.amountHeld).toBe(3_450_000n);
    expect(manager.role).toBe('MANAGER');
    expect(await prisma.handover.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AB-1 no cash left: the former owner holds 0 after the transfer, the new owner can transfer back without a handover', async () => {
    await transfer();
    expect(await heldBy(OWNER)).toBe(0n);

    const back = await transfer(MANAGER, GESTURE_2, OWNER_ROW);

    expect(back.status).toBe(200);
    // the former owner restarted at zero, so the second transfer hands over the new owner's 100000
    const rows = await prisma.handover.findMany({
      where: { organizationId: ORG },
      orderBy: { occurredAt: 'asc' },
    });
    expect(rows.map((r) => [r.fromPersonId, r.amount])).toEqual([
      [OWNER, 3_450_000n],
      [MANAGER, 100_000n],
    ]);
    expect(await heldBy(MANAGER)).toBe(0n);
    expect(await heldBy(OWNER)).toBe(0n);
  });

  it('a repeat with the same gesture id writes the handover once', async () => {
    await transfer();
    const second = await transfer();

    expect(second.status).toBe(200);
    expect(await prisma.handover.count()).toBe(1);
    expect(await heldBy(OWNER)).toBe(0n);
  });
});
