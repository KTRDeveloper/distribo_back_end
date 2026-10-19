import { describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import {
  listOrganizationsEnding,
  listOrganizationsToRefresh,
  readPlanFields,
} from '../../../src/modules/organization/organization.repository';

const NOW = new Date('2026-06-15T00:00:00.000Z');
const PAST = new Date('2026-06-01T00:00:00.000Z');
const FUTURE = new Date('2026-07-15T00:00:00.000Z');
const FUTURE_GRACE = new Date('2026-07-20T00:00:00.000Z');
const PAST_GRACE = new Date('2026-06-10T00:00:00.000Z');

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `0199c045-${prefix}-7000-8000-${String(counter).padStart(12, '0')}`;
}

type Seed = {
  plan?: 'FREE' | 'ESSENTIAL' | 'PRO';
  planEndsAt?: Date | null;
  graceEndsAt?: Date | null;
  maxCollaborators?: number | null;
  maxProducts?: number | null;
  deleted?: boolean;
  seats?: Array<'ACTIVE' | 'INVITED' | 'PAUSED'>;
};

async function seedOrganization(seed: Seed): Promise<string> {
  const id = nextId('0001');
  await prisma.organization.create({
    data: {
      id,
      name: 'Fixture Business',
      plan: seed.plan ?? 'FREE',
      planEndsAt: seed.planEndsAt ?? null,
      graceEndsAt: seed.graceEndsAt ?? null,
      maxCollaborators: seed.maxCollaborators === undefined ? 2 : seed.maxCollaborators,
      maxProducts: seed.maxProducts === undefined ? 30 : seed.maxProducts,
      deletedAt: seed.deleted ? NOW : null,
    },
  });
  const seats = seed.seats ?? [];
  if (seats.length === 0) return id;
  await prisma.$transaction(async (tx) => {
    const members: Array<['OWNER' | 'SELLER', 'ACTIVE' | 'INVITED' | 'PAUSED']> = [
      ['OWNER', 'ACTIVE'],
      ...seats.map((status): ['SELLER', typeof status] => ['SELLER', status]),
    ];
    for (const [role, status] of members) {
      const personId = nextId('0002');
      await tx.person.create({
        data: {
          id: personId,
          fullName: 'Fixture Member',
          phoneNumber: `+22507${String(counter).padStart(8, '0')}`,
          phoneVerifiedAt: NOW,
          passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
          registeredAt: NOW,
          preferredLanguage: 'FR',
        },
      });
      await tx.collaboration.create({
        data: {
          id: nextId('0003'),
          personId,
          organizationId: id,
          role,
          status,
          acceptedAt: status === 'INVITED' ? null : NOW,
        },
      });
    }
  });
  return id;
}

describe('listOrganizationsToRefresh: who (AC-1, C-41, C-42)', () => {
  it.each<[string, Seed, boolean]>([
    ['ESSENTIAL ended, no grace', { plan: 'ESSENTIAL', planEndsAt: PAST }, true],
    [
      'ESSENTIAL in grace until a future date',
      { plan: 'ESSENTIAL', planEndsAt: PAST, graceEndsAt: FUTURE_GRACE },
      false,
    ],
    [
      'ESSENTIAL with grace in the past',
      { plan: 'ESSENTIAL', planEndsAt: PAST, graceEndsAt: PAST_GRACE },
      true,
    ],
    [
      'PRO until a future date, 3 seats, limit 10',
      {
        plan: 'PRO',
        planEndsAt: FUTURE,
        maxCollaborators: 10,
        seats: ['ACTIVE', 'ACTIVE', 'INVITED'],
      },
      false,
    ],
    [
      'limit 2 and 3 seats ACTIVE or INVITED',
      { maxCollaborators: 2, seats: ['ACTIVE', 'ACTIVE', 'INVITED'] },
      true,
    ],
    [
      'limit 2, 1 ACTIVE seat and 2 PAUSED ones',
      { maxCollaborators: 2, seats: ['ACTIVE', 'PAUSED', 'PAUSED'] },
      false,
    ],
    ['FREE, limit 2, 2 seats', { maxCollaborators: 2, seats: ['ACTIVE', 'INVITED'] }, false],
    [
      'a deleted business that would be listed',
      { plan: 'ESSENTIAL', planEndsAt: PAST, deleted: true },
      false,
    ],
    [
      'no limit and many seats',
      { plan: 'PRO', planEndsAt: FUTURE, maxCollaborators: null, seats: ['ACTIVE', 'ACTIVE'] },
      false,
    ],
  ])('%s', async (_label, seed, listed) => {
    const id = await seedOrganization(seed);
    const ids = await listOrganizationsToRefresh(NOW, 100);
    expect(ids.includes(id)).toBe(listed);
  });

  it('lists a plan ending exactly now', async () => {
    const id = await seedOrganization({ plan: 'ESSENTIAL', planEndsAt: NOW });
    expect(await listOrganizationsToRefresh(NOW, 100)).toContain(id);
  });
});

describe('listOrganizationsToRefresh: pages (AC-2)', () => {
  it('pages 2 by 2 in ascending id order without repeat', async () => {
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      created.push(await seedOrganization({ plan: 'ESSENTIAL', planEndsAt: PAST }));
    }
    const sorted = [...created].sort();
    const first = await listOrganizationsToRefresh(NOW, 2);
    expect(first).toEqual(sorted.slice(0, 2));
    const second = await listOrganizationsToRefresh(NOW, 2, first[1]);
    expect(second).toEqual(sorted.slice(2, 4));
    const third = await listOrganizationsToRefresh(NOW, 2, second[1]);
    expect(third).toEqual(sorted.slice(4));
    expect(await listOrganizationsToRefresh(NOW, 2, third[0])).toEqual([]);
  });

  it.each([0, 501, 1.5, Number.NaN])('refuses the limit %s', async (limit) => {
    await expect(listOrganizationsToRefresh(NOW, limit)).rejects.toThrow();
  });
});

describe('listOrganizationsEnding (AC-3)', () => {
  const FROM = new Date('2026-07-01T00:00:00.000Z');
  const TO = new Date('2026-07-10T00:00:00.000Z');

  it('returns the plans ending in [from, to), ascending, no FREE and no deleted', async () => {
    const before = await seedOrganization({
      plan: 'ESSENTIAL',
      planEndsAt: new Date('2026-06-30T23:59:59.000Z'),
    });
    const atFrom = await seedOrganization({ plan: 'ESSENTIAL', planEndsAt: FROM });
    const inside = await seedOrganization({
      plan: 'PRO',
      planEndsAt: new Date('2026-07-05T00:00:00.000Z'),
    });
    const atTo = await seedOrganization({ plan: 'PRO', planEndsAt: TO });
    await seedOrganization({});
    await seedOrganization({
      plan: 'PRO',
      planEndsAt: new Date('2026-07-05T00:00:00.000Z'),
      deleted: true,
    });

    const ids = await listOrganizationsEnding(FROM, TO, 10);
    expect(ids).toEqual([atFrom, inside].sort());
    expect(ids).not.toContain(before);
    expect(ids).not.toContain(atTo);
  });

  it('pages after the given id', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(await seedOrganization({ plan: 'PRO', planEndsAt: FROM }));
    }
    const sorted = [...ids].sort();
    const first = await listOrganizationsEnding(FROM, TO, 2);
    expect(first).toEqual(sorted.slice(0, 2));
    expect(await listOrganizationsEnding(FROM, TO, 2, first[1])).toEqual(sorted.slice(2));
  });

  it.each([0, 501])('refuses the limit %s', async (limit) => {
    await expect(listOrganizationsEnding(FROM, TO, limit)).rejects.toThrow();
  });
});

describe('readPlanFields (AC-4)', () => {
  it('returns the five fields of a business, null for a deleted and an unknown one', async () => {
    const id = await seedOrganization({
      plan: 'ESSENTIAL',
      planEndsAt: FUTURE,
      graceEndsAt: FUTURE_GRACE,
      maxCollaborators: 5,
      maxProducts: null,
    });
    const deleted = await seedOrganization({ deleted: true });
    const unknown = '0199c045-ffff-7000-8000-000000000000';

    await prisma.$transaction(async (tx) => {
      expect(await readPlanFields(tx, id)).toEqual({
        plan: 'ESSENTIAL',
        planEndsAt: FUTURE,
        graceEndsAt: FUTURE_GRACE,
        maxCollaborators: 5,
        maxProducts: null,
      });
      expect(await readPlanFields(tx, deleted)).toBeNull();
      expect(await readPlanFields(tx, unknown)).toBeNull();
    });
  });
});
