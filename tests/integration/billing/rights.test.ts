import type { Prisma, SubscriptionEndReason } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { computeRights, recomputeRights } from '../../../src/modules/billing/rights.service';
import { findLastExpired } from '../../../src/modules/billing/subscription.repository';

const ORG_ID = '0199c013-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199c013-0000-7000-8000-000000000002';
const NOW = new Date('2026-06-15T12:00:00.000Z');
const DAY = 86_400_000;
const date = (days: number) => new Date(NOW.getTime() + days * DAY);
const FREE = {
  plan: 'FREE', planEndsAt: null, graceEndsAt: null, maxCollaborators: 2, maxProducts: 30,
};

async function period(overrides: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) {
  return prisma.subscription.create({
    data: {
      id: uuidv7(), organizationId: ORG_ID, plan: 'ESSENTIAL', price: 0n,
      origin: 'GIFT', status: 'ACTIVE', startsAt: date(-10), endsAt: date(10),
      ...overrides,
    },
  });
}

async function recompute(now = NOW, organizationId = ORG_ID) {
  return prisma.$transaction((tx) => recomputeRights(tx, organizationId, now));
}

beforeEach(async () => {
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${ORG_ID}::uuid, 'Fixture Rights'), (${OTHER_ORG_ID}::uuid, 'Fixture Other Rights')
  `;
});

describe('business rights', () => {
  it('free', async () => {
    expect(await recompute()).toEqual(FREE);
  });

  it('running', async () => {
    await period();
    expect(await recompute()).toEqual({
      plan: 'ESSENTIAL', planEndsAt: date(10), graceEndsAt: null,
      maxCollaborators: 5, maxProducts: null,
    });
  });

  it('chain', async () => {
    await period();
    await period({ status: 'SCHEDULED', startsAt: date(10), endsAt: date(20) });
    await period({
      status: 'SCHEDULED', origin: 'CONVERSION', startsAt: date(20), endsAt: date(25),
    });
    expect((await recompute()).planEndsAt).toEqual(date(25));
  });

  it('lower next', async () => {
    await period({ plan: 'PRO' });
    await period({ status: 'SCHEDULED', startsAt: date(10), endsAt: date(40) });
    expect(await recompute()).toEqual({
      plan: 'PRO', planEndsAt: date(10), graceEndsAt: null,
      maxCollaborators: 10, maxProducts: null,
    });
    expect(await recompute(date(10))).toEqual({
      plan: 'ESSENTIAL', planEndsAt: date(40), graceEndsAt: null,
      maxCollaborators: 5, maxProducts: null,
    });
  });

  it.each([
    ['EXPIRED', 3, 'ESSENTIAL'], ['EXPIRED', 8, 'FREE'],
    ['UPGRADED', 2, 'FREE'], ['CLOSED', 2, 'FREE'], ['REFUNDED', 2, 'FREE'],
  ] as const)('after the end: %s %i days', async (endReason, ago, plan) => {
    await period({
      plan: endReason === 'EXPIRED' ? 'ESSENTIAL' : 'PRO', status: 'ENDED',
      endReason, startsAt: date(-30), endsAt: date(-ago),
    });
    expect(await recompute()).toEqual(plan === 'FREE' ? FREE : {
      plan, planEndsAt: date(-ago), graceEndsAt: date(7 - ago),
      maxCollaborators: 5, maxProducts: null,
    });
  });

  it('five columns', async () => {
    await period();
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: ORG_ID } });
    const rights = await recompute();
    const after = await prisma.organization.findUniqueOrThrow({ where: { id: ORG_ID } });
    expect(after.serverUpdatedAt.getTime()).toBeGreaterThan(before.serverUpdatedAt.getTime());
    expect(after).toEqual({ ...before, ...rights, serverUpdatedAt: after.serverUpdatedAt });
  });

  it('other business', async () => {
    await period({ plan: 'PRO' });
    await recompute();
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: ORG_ID } });
    expect(await recompute(NOW, OTHER_ORG_ID)).toEqual(FREE);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: ORG_ID } })).toEqual(before);
  });

  it('does not borrow another business expiry for grace', async () => {
    await period({ status: 'ENDED', endReason: 'EXPIRED', endsAt: date(-3) });
    expect(await recompute(NOW, OTHER_ORG_ID)).toEqual(FREE);
  });

  it('rolls back the rights with the caller transaction', async () => {
    await period();
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: ORG_ID } });
    await expect(prisma.$transaction(async (tx) => {
      await recomputeRights(tx, ORG_ID, NOW);
      throw new Error('rollback rights');
    })).rejects.toThrow('rollback rights');
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: ORG_ID } })).toEqual(before);
  });

  it('gives grace to a lapsed ACTIVE period', async () => {
    await period({ plan: 'PRO', endsAt: date(-3) });
    expect(await recompute()).toEqual({
      plan: 'PRO', planEndsAt: date(-3), graceEndsAt: date(4),
      maxCollaborators: 10, maxProducts: null,
    });
  });

  it('ends grace at exactly seven elapsed days', async () => {
    await period({ status: 'ENDED', endReason: 'EXPIRED', endsAt: date(-7) });
    expect((await recompute(new Date(NOW.getTime() - 1))).plan).toBe('ESSENTIAL');
    expect(await recompute()).toEqual(FREE);
  });

  it('does not extend a chain across a gap', async () => {
    await period();
    await period({ status: 'SCHEDULED', startsAt: date(11), endsAt: date(40) });
    expect((await recompute()).planEndsAt).toEqual(date(10));
  });

  it('does not grant grace when another period follows', async () => {
    await period({ status: 'ENDED', endReason: 'EXPIRED', endsAt: date(-3) });
    await period({ status: 'SCHEDULED', startsAt: date(1), endsAt: date(31) });
    expect(await recompute()).toEqual(FREE);
  });

  it('does not activate a future-only queue', async () => {
    await period({ status: 'SCHEDULED', startsAt: date(1), endsAt: date(31) });
    expect(await recompute()).toEqual(FREE);
  });

  it.each(['UPGRADED', 'CLOSED', 'REFUNDED'] as const)(
    'does not revive an older expiry after a newer %s ending', async (endReason: SubscriptionEndReason) => {
      await period({ status: 'ENDED', endReason: 'EXPIRED', endsAt: date(-4) });
      await period({
        plan: 'PRO', status: 'ENDED', endReason, startsAt: date(-4), endsAt: date(-2),
      });
      expect(await recompute()).toEqual(FREE);
    },
  );

  it('preserves the existing date-only purchase read', async () => {
    await period({ status: 'ENDED', endReason: 'EXPIRED', endsAt: date(-3) });
    expect(await prisma.$transaction((tx) => findLastExpired(tx, ORG_ID))).toEqual(date(-3));
  });

  it('computes without mutating the queue and applies enterprise limits', () => {
    const queue = [{
      plan: 'ENTERPRISE' as const, status: 'ACTIVE' as const,
      startsAt: date(-10), endsAt: date(10),
    }];
    const before = structuredClone(queue);
    expect(computeRights(queue, null, NOW)).toEqual({
      plan: 'ENTERPRISE', planEndsAt: date(10), graceEndsAt: null,
      maxCollaborators: null, maxProducts: null,
    });
    expect(queue).toEqual(before);
  });
});
