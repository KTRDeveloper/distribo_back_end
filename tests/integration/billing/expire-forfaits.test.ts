import { afterEach, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup.js';
import { logger } from '../../../src/lib/logger.js';
import * as advance from '../../../src/modules/billing/advance.service.js';
import * as repository from '../../../src/modules/billing/subscription.repository.js';
import { insertOrganizationWithOwner } from '../../../src/modules/organization/organization.repository.js';
import { advanceDueBusinesses } from '../../../src/modules/billing/expire.service.js';
import { runExpireForfaitsJob } from '../../../src/jobs/expire-forfaits.js';

vi.mock('../../../src/modules/billing/subscription.repository.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../src/modules/billing/subscription.repository.js')
  >()),
  ADVANCE_PAGE: 2,
}));

const now = new Date('2026-10-26T12:00:00Z');
const day = 86_400_000;
const at = (days: number) => new Date(now.getTime() + days * day);

afterEach(() => vi.restoreAllMocks());

async function business() {
  const owner = await prisma.person.create({
    data: {
      id: uuidv7(),
      fullName: 'Test owner',
      registeredAt: at(-60),
      releasedPhoneNumber: '+12025550100',
      passwordHash: 'fake-test-hash',
    },
  });
  return insertOrganizationWithOwner(
    owner.id,
    { id: uuidv7(), name: 'Test business' },
    {
      paymentCode: uuidv7().replaceAll('-', '').slice(-8).toUpperCase(),
      maxCollaborators: 2,
      maxProducts: 30,
    }
  );
}

async function period(
  organizationId: string,
  status: 'ACTIVE' | 'SCHEDULED' | 'ENDED',
  startsAt = at(-30),
  endsAt = now
) {
  return prisma.subscription.create({
    data: {
      id: uuidv7(),
      organizationId,
      plan: 'ESSENTIAL',
      origin: 'GIFT',
      price: 0n,
      status,
      startsAt,
      endsAt,
      endReason: status === 'ENDED' ? 'EXPIRED' : null,
    },
  });
}

async function paidFields(organizationId: string, planEndsAt = now) {
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      plan: 'ESSENTIAL',
      planEndsAt,
    },
  });
}

async function snapshot() {
  return {
    organizations: await prisma.organization.findMany({ orderBy: { id: 'asc' } }),
    subscriptions: await prisma.subscription.findMany({ orderBy: { id: 'asc' } }),
    events: await prisma.subscriptionEvent.findMany({ orderBy: { id: 'asc' } }),
    seats: await prisma.collaboration.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
  };
}

describe('daily subscription expiry', () => {
  it('selects only expired ACTIVE or due SCHEDULED businesses, including equality', async () => {
    const [a, b, c, d] = await Promise.all([business(), business(), business(), business()]);
    const expired = await period(a.id, 'ACTIVE');
    await paidFields(a.id);
    await period(b.id, 'ACTIVE', at(-10), at(20));
    await paidFields(b.id, at(20));
    const scheduled = await period(c.id, 'SCHEDULED', now, at(30));
    const untouched = await prisma.organization.findMany({ where: { id: { in: [b.id, d.id] } } });
    const future = await period(d.id, 'SCHEDULED', at(1), at(31));

    expect(await repository.listBusinessesToAdvance(now, 500)).toEqual([a.id, c.id].sort());
    expect(await advanceDueBusinesses(now)).toEqual({
      checked: 2,
      ended: 1,
      started: 1,
      planChanged: 2,
    });
    expect(
      await prisma.subscription.findUniqueOrThrow({ where: { id: expired.id } })
    ).toMatchObject({ status: 'ENDED' });
    expect(
      await prisma.subscription.findUniqueOrThrow({ where: { id: scheduled.id } })
    ).toMatchObject({ status: 'ACTIVE' });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: future.id } })).toMatchObject(
      { status: 'SCHEDULED' }
    );
    expect(await prisma.organization.findMany({ where: { id: { in: [b.id, d.id] } } })).toEqual(
      untouched
    );
  });

  it('refreshes elapsed grace and pauses excess active seats', async () => {
    const e = await business();
    await period(e.id, 'ENDED', at(-38), at(-8));
    await paidFields(e.id, at(-8));
    const f = await business();
    for (let index = 0; index < 3; index++) {
      const person = await prisma.person.create({
        data: {
          id: uuidv7(),
          fullName: 'Test member',
          registeredAt: at(-10),
          releasedPhoneNumber: '+12025550101',
          passwordHash: 'fake-test-hash',
        },
      });
      await prisma.collaboration.create({
        data: {
          id: uuidv7(),
          organizationId: f.id,
          personId: person.id,
          role: 'SELLER',
          status: 'ACTIVE',
          acceptedAt: at(-5),
        },
      });
    }

    expect(await advanceDueBusinesses(now)).toMatchObject({ checked: 2, planChanged: 1 });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({
      plan: 'FREE',
      planEndsAt: null,
    });
    expect(
      await prisma.collaboration.count({ where: { organizationId: f.id, status: 'PAUSED' } })
    ).toBe(1);
    expect(
      await prisma.collaboration.count({
        where: { organizationId: f.id, role: 'OWNER', status: 'ACTIVE' },
      })
    ).toBe(1);
  });

  it('advances an id returned by both lists only once', async () => {
    const org = await business();
    await period(org.id, 'ACTIVE');
    await paidFields(org.id);
    const spy = vi.spyOn(advance, 'advanceSubscription');

    expect(await advanceDueBusinesses(now)).toMatchObject({ checked: 1, ended: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(
      await prisma.subscriptionEvent.count({
        where: { organizationId: org.id, kind: 'FORFAIT_ENDED' },
      })
    ).toBe(1);
  });

  it('changes no rows or events on a second run at the same instant', async () => {
    const org = await business();
    await period(org.id, 'ACTIVE');
    await paidFields(org.id);
    await advanceDueBusinesses(now);
    const before = await snapshot();

    expect(await advanceDueBusinesses(now)).toEqual({
      checked: 0,
      ended: 0,
      started: 0,
      planChanged: 0,
    });
    expect(await snapshot()).toEqual(before);
  });

  it('paginates both lists and advances their union in ascending id order', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 6; index++) {
      const org = await business();
      ids.push(org.id);
      if (index % 2 === 0) {
        await period(org.id, 'ACTIVE');
        await paidFields(org.id);
      } else {
        await period(org.id, 'ENDED', at(-38), at(-8));
        await paidFields(org.id, at(-8));
      }
    }
    const spy = vi.spyOn(advance, 'advanceSubscription');
    const list = vi.spyOn(repository, 'listBusinessesToAdvance');

    expect(await advanceDueBusinesses(now)).toMatchObject({ checked: 6, ended: 3 });
    expect(spy.mock.calls.map((call) => call[1])).toEqual(ids.sort());
    expect(list.mock.calls.every((call) => call[1] === 2)).toBe(true);
    expect(await repository.listBusinessesToAdvance(now, 2)).toEqual([]);
  });

  it('continues after a broken business, logs only its id and rejects with the first error', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      const org = await business();
      ids.push(org.id);
      await period(org.id, 'ACTIVE');
      await paidFields(org.id);
    }
    ids.sort();
    const failure = new Error('sensitive database detail');
    const original = advance.advanceSubscription;
    const spy = vi
      .spyOn(advance, 'advanceSubscription')
      .mockImplementation(async (tx, id, instant) => {
        if (id === ids[0]) throw failure;
        if (id === ids[1]) throw new Error('second business failure');
        return original(tx, id, instant);
      });
    const log = vi.spyOn(logger, 'error');

    await expect(advanceDueBusinesses(now)).rejects.toBe(failure);
    expect(spy.mock.calls.map((call) => call[1])).toEqual(ids);
    expect(log.mock.calls.map((call) => call[0])).toEqual(
      ids.slice(0, 2).map((organizationId) => ({
        event: 'expire_forfaits_business_failed',
        organizationId,
      }))
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(failure.message);
    expect(
      await prisma.subscriptionEvent.count({
        where: { organizationId: ids[2], kind: 'FORFAIT_ENDED' },
      })
    ).toBe(1);
  });

  it('rolls back period, rights and journal changes when an advance fails after writing', async () => {
    const org = await business();
    await period(org.id, 'ACTIVE');
    await paidFields(org.id);
    const before = await snapshot();
    const original = advance.advanceSubscription;
    const failure = new Error('failure after writes');
    vi.spyOn(advance, 'advanceSubscription').mockImplementation(async (...args) => {
      await original(...args);
      throw failure;
    });

    await expect(advanceDueBusinesses(now)).rejects.toBe(failure);
    expect(await snapshot()).toEqual(before);
  });

  it('returns zero and logs only report counts on success', async () => {
    const log = vi.spyOn(logger, 'info');
    expect(await runExpireForfaitsJob(now)).toBe(0);
    expect(log).toHaveBeenCalledWith(
      {
        event: 'expire_forfaits_completed',
        checked: 0,
        ended: 0,
        started: 0,
        planChanged: 0,
      },
      expect.any(String)
    );
  });

  it('rejects invalid repository page limits before querying', async () => {
    for (const limit of [0, -1, 501, 1.5, Number.NaN]) {
      await expect(repository.listBusinessesToAdvance(now, limit)).rejects.toThrow(RangeError);
    }
  });
});
