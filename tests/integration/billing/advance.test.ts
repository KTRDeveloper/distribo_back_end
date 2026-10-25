import type { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { advanceSubscription } from '../../../src/modules/billing/advance.service';
import { recomputeRights } from '../../../src/modules/billing/rights.service';
import { readPlanFields } from '../../../src/modules/organization/organization.repository';

const ORG_ID = '0199c028-0000-7000-8000-000000000001';
const OWNER_ID = '0199c028-0000-7000-8000-000000000011';
const NOW = new Date('2026-10-15T12:00:00.000Z');
const DAY = 86_400_000;
const ZERO = { ended: 0, started: 0, planChanged: false };

function days(offset: number): Date {
  return new Date(NOW.getTime() + offset * DAY);
}

async function period(
  status: 'ACTIVE' | 'SCHEDULED' | 'ENDED',
  startsAt: Date,
  endsAt: Date,
  plan: 'ESSENTIAL' | 'PRO' = 'ESSENTIAL',
  organizationId = ORG_ID,
): Promise<string> {
  const row = await prisma.subscription.create({ data: {
    id: uuidv7(), organizationId, plan, origin: 'CONVERSION', price: 0n,
    status, startsAt, endsAt, endReason: status === 'ENDED' ? 'EXPIRED' : null,
  } });
  return row.id;
}

async function seedRights(at: Date): Promise<void> {
  await prisma.$transaction((tx) => recomputeRights(tx, ORG_ID, at));
}

async function advance(organizationId = ORG_ID) {
  return prisma.$transaction((tx) => advanceSubscription(tx, organizationId, NOW));
}

async function rights() {
  return prisma.$transaction((tx) => readPlanFields(tx, ORG_ID));
}

async function events() {
  return prisma.$queryRaw<Array<{
    kind: string; actor: string; subscription_id: string | null;
    details: Record<string, unknown>; occurred_at: Date;
  }>>`
    SELECT kind, actor, subscription_id, details, occurred_at FROM subscription_events
    WHERE organization_id = ${ORG_ID}::uuid ORDER BY occurred_at, id
  `;
}

async function snapshot() {
  const [organization] = await prisma.$queryRaw<Array<{ row: Prisma.JsonObject }>>`
    SELECT to_jsonb(o) AS row FROM organizations o WHERE id = ${ORG_ID}::uuid
  `;
  return {
    organization,
    periods: await prisma.subscription.findMany({ where: { organizationId: ORG_ID }, orderBy: { id: 'asc' } }),
    events: await events(),
    seats: await prisma.$queryRaw`
      SELECT to_jsonb(c) AS row FROM collaborations c
      WHERE organization_id = ${ORG_ID}::uuid ORDER BY id
    `,
  };
}

async function seats(count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    const personId = uuidv7();
    await prisma.person.create({ data: {
      id: personId, phoneNumber: `+2250700028${String(index).padStart(3, '0')}`,
      fullName: 'Fixture Seller', registeredAt: days(-100), phoneVerifiedAt: days(-100),
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    } });
    await prisma.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status)
      VALUES (${uuidv7()}::uuid, ${personId}::uuid, ${ORG_ID}::uuid, 'SELLER', 'ACTIVE')
    `;
  }
}

beforeEach(async () => {
  await prisma.person.create({ data: {
    id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700028011',
    phoneVerifiedAt: days(-100), registeredAt: days(-100), preferredLanguage: 'FR',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
  } });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
    `;
    await tx.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status)
      VALUES (${uuidv7()}::uuid, ${OWNER_ID}::uuid, ${ORG_ID}::uuid, 'OWNER', 'ACTIVE')
    `;
  });
});

describe('advanceSubscription', () => {
  it('runs out, preserving the end and journaling natural expiry and grace', async () => {
    const id = await period('ACTIVE', days(-33), days(-3));
    await seedRights(days(-4));
    expect(await advance()).toEqual({ ended: 1, started: 0, planChanged: true });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'ENDED', endReason: 'EXPIRED', endsAt: days(-3),
    });
    expect(await rights()).toMatchObject({ plan: 'ESSENTIAL', graceEndsAt: days(4) });
    expect(await events()).toEqual([
      expect.objectContaining({ kind: 'FORFAIT_ENDED', actor: 'SYSTEM', subscription_id: id,
        details: { period_id: id, reason: 'EXPIRED' }, occurred_at: NOW }),
      expect.objectContaining({ kind: 'PLAN_CHANGED', actor: 'SYSTEM',
        details: { from: 'ESSENTIAL', to: 'ESSENTIAL', grace_ends_at: days(4).toISOString() }, occurred_at: NOW }),
    ]);
  });

  it('takes over without a plan event for the same plan', async () => {
    const end = new Date(NOW.getTime() - 3_600_000);
    const first = await period('ACTIVE', days(-30), end);
    const next = await period('SCHEDULED', end, days(30));
    await seedRights(days(-1));
    expect(await advance()).toEqual({ ended: 1, started: 1, planChanged: false });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: first } })).toMatchObject({ status: 'ENDED', endReason: 'EXPIRED' });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: next } })).toMatchObject({ status: 'ACTIVE' });
    expect(await rights()).toMatchObject({ plan: 'ESSENTIAL', graceEndsAt: null });
    expect((await events()).map((event) => event.kind)).toEqual(['FORFAIT_ENDED']);
  });

  it('activates a lower plan and pauses three of eight non-owner seats', async () => {
    await period('ACTIVE', days(-32), days(-2), 'PRO');
    const next = await period('SCHEDULED', days(-2), days(88));
    await seedRights(days(-3));
    await seats(8);
    expect(await advance()).toEqual({ ended: 1, started: 1, planChanged: true });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: next } })).toMatchObject({ status: 'ACTIVE' });
    expect(await rights()).toMatchObject({ plan: 'ESSENTIAL', graceEndsAt: null });
    const journal = await events();
    expect(journal.filter((event) => event.kind === 'PAUSED')).toHaveLength(3);
    expect(journal.filter((event) => event.kind === 'PLAN_CHANGED')).toEqual([
      expect.objectContaining({ actor: 'SYSTEM', details: { from: 'PRO', to: 'ESSENTIAL', grace_ends_at: null } }),
    ]);
  });

  it('ends whole missed periods without briefly activating them', async () => {
    const first = await period('ACTIVE', days(-70), days(-40));
    const second = await period('SCHEDULED', days(-40), days(-20));
    const third = await period('SCHEDULED', days(-20), days(70));
    await seedRights(days(-41));
    expect(await advance()).toEqual({ ended: 2, started: 1, planChanged: false });
    for (const id of [first, second]) {
      expect(await prisma.subscription.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'ENDED', endReason: 'EXPIRED' });
    }
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: third } })).toMatchObject({ status: 'ACTIVE' });
    expect((await events()).filter((event) => event.kind === 'FORFAIT_ENDED')).toHaveLength(2);
  });

  it('drops to FREE after grace and pauses two of four non-owner seats', async () => {
    await period('ENDED', days(-38), days(-8));
    await seedRights(days(-7));
    await seats(4);
    expect(await advance()).toEqual({ ended: 0, started: 0, planChanged: true });
    expect(await rights()).toMatchObject({ plan: 'FREE', graceEndsAt: null });
    const journal = await events();
    expect(journal.filter((event) => event.kind === 'PAUSED')).toHaveLength(2);
    expect(journal.filter((event) => event.kind === 'PLAN_CHANGED')).toEqual([
      expect.objectContaining({ actor: 'SYSTEM', details: { from: 'ESSENTIAL', to: 'FREE', grace_ends_at: null } }),
    ]);
  });

  it.each(['running', 'future', 'deleted'] as const)('changes nothing for a %s business', async (state) => {
    if (state === 'running') await period('ACTIVE', days(-5), days(25));
    if (state === 'future') await period('SCHEDULED', days(1), days(31));
    await seedRights(NOW);
    if (state === 'deleted') {
      await period('ACTIVE', days(-33), days(-3));
      await prisma.$executeRaw`UPDATE organizations SET deleted_at = ${days(-1)} WHERE id = ${ORG_ID}::uuid`;
    }
    const before = await snapshot();
    expect(await advance()).toEqual(ZERO);
    expect(await snapshot()).toEqual(before);
  });

  it('serializes two parallel runs into one set of events and one active period', async () => {
    await period('ACTIVE', days(-32), days(-2));
    await period('SCHEDULED', days(-2), days(28));
    await seedRights(days(-3));
    const results = await Promise.all([advance(), advance()]);
    expect(results).toContainEqual({ ended: 1, started: 1, planChanged: false });
    expect(results).toContainEqual(ZERO);
    expect(await prisma.subscription.count({ where: { organizationId: ORG_ID, status: 'ACTIVE' } })).toBe(1);
    expect((await events()).map((event) => event.kind)).toEqual(['FORFAIT_ENDED']);
  });

  it('writes nothing for an unknown business and leaves another tenant untouched', async () => {
    await period('ACTIVE', days(-33), days(-3));
    await seedRights(days(-4));
    const before = await snapshot();
    expect(await advance(uuidv7())).toEqual(ZERO);
    expect(await snapshot()).toEqual(before);
  });

  it('rolls back periods, rights, limits and events with the caller transaction', async () => {
    await period('ACTIVE', days(-32), days(-2), 'PRO');
    await period('SCHEDULED', days(-2), days(28));
    await seedRights(days(-3));
    await seats(8);
    const before = await snapshot();
    await expect(prisma.$transaction(async (tx) => {
      await advanceSubscription(tx, ORG_ID, NOW);
      throw new Error('caller rollback');
    })).rejects.toThrow('caller rollback');
    expect(await snapshot()).toEqual(before);
  });

  it('expires and starts at the exact boundary and is idempotent on repeat', async () => {
    await period('ACTIVE', days(-30), NOW);
    await period('SCHEDULED', NOW, days(30));
    await seedRights(days(-1));
    expect(await advance()).toEqual({ ended: 1, started: 1, planChanged: false });
    const before = await snapshot();
    expect(await advance()).toEqual(ZERO);
    expect(await snapshot()).toEqual(before);
  });
});
