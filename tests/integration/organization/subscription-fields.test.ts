import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: vi.fn(() => Promise.resolve({ allowed: true, remaining: 10 })),
}));

import { app } from '../../../src/app.js';
import {
  listTeamSeats,
  setSeatPaused,
  writePlanFields,
  type PlanFields,
} from '../../../src/modules/organization/organization.repository.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const ORG = '0199c035-0000-7000-8000-000000000001';
const OTHER_ORG = '0199c035-0000-7000-8000-000000000002';
const REG = new Date('2026-01-01T00:00:00.000Z');
const END = new Date('2027-01-01T00:00:00.000Z');
const GRACE = new Date('2027-01-15T00:00:00.000Z');

const person = (n: number) => `0199c035-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;
const collab = (n: number) => `0199c035-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`;

type SeatSeed = {
  n: number;
  role?: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER';
  status: 'ACTIVE' | 'INVITED' | 'PAUSED' | 'REVOKED';
  invitedAt?: Date;
  accepted?: boolean;
  deleted?: boolean;
  organizationId?: string;
};

async function seedSeat(seed: SeatSeed) {
  await prisma.collaboration.create({
    data: {
      id: collab(seed.n),
      personId: person(seed.n),
      organizationId: seed.organizationId ?? ORG,
      role: seed.role ?? 'MANAGER',
      status: seed.status,
      invitedAt: seed.invitedAt ?? new Date(`2026-02-0${seed.n}T00:00:00.000Z`),
      acceptedAt: (seed.accepted ?? seed.status !== 'INVITED') ? REG : null,
      deletedAt: seed.deleted ? REG : null,
    },
  });
}

// serverUpdatedAt is stamped by the database on every change, so it is not compared.
const PLAN_COLUMNS = [
  'serverUpdatedAt',
  'plan',
  'planEndsAt',
  'graceEndsAt',
  'maxCollaborators',
  'maxProducts',
];

/** Keeps every organization column except the five plan columns and the sync stamp. */
const withoutPlan = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !PLAN_COLUMNS.includes(key)));

const scopeOf = async (n: number) =>
  (await prisma.person.findUniqueOrThrow({ where: { id: person(n) } })).scopeVersion;

const statusOf = async (n: number) =>
  (await prisma.collaboration.findUniqueOrThrow({ where: { id: collab(n) } })).status;

const pause = (n: number, paused: boolean) =>
  prisma.$transaction((tx) => setSeatPaused(tx, collab(n), paused));

const write = (fields: PlanFields, organizationId = ORG) =>
  prisma.$transaction((tx) => writePlanFields(tx, organizationId, fields));

beforeEach(async () => {
  for (let n = 1; n <= 9; n++) {
    await prisma.person.create({
      data: {
        id: person(n),
        fullName: 'Fixture Person',
        phoneNumber: `+2376000350${n}0`,
        phoneVerifiedAt: REG,
        passwordHash: 'test-password-hash',
        registeredAt: REG,
      },
    });
  }
  await prisma.organization.create({
    data: { id: ORG, name: 'Fixture Business', paymentCode: 'ORGPAY35' },
  });
  await prisma.organization.create({
    data: { id: OTHER_ORG, name: 'Other Business', paymentCode: 'ORGPAY36' },
  });
});

describe('writePlanFields (AC-1, AC-2, C-41)', () => {
  it('writes the five plan columns and nothing else', async () => {
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: ORG } });

    await write({
      plan: 'ESSENTIAL',
      planEndsAt: END,
      graceEndsAt: null,
      maxCollaborators: 5,
      maxProducts: null,
    });

    const after = await prisma.organization.findUniqueOrThrow({ where: { id: ORG } });
    expect(after).toMatchObject({
      plan: 'ESSENTIAL',
      planEndsAt: END,
      graceEndsAt: null,
      maxCollaborators: 5,
      maxProducts: null,
    });
    expect(withoutPlan(after)).toEqual(withoutPlan(before));
  });

  it('does not touch another business', async () => {
    const other = await prisma.organization.findUniqueOrThrow({ where: { id: OTHER_ORG } });
    await write({
      plan: 'PRO',
      planEndsAt: END,
      graceEndsAt: GRACE,
      maxCollaborators: 10,
      maxProducts: 100,
    });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: OTHER_ORG } })).toEqual(
      other
    );
  });

  it.each<[string, PlanFields]>([
    [
      'FREE with an end date',
      { plan: 'FREE', planEndsAt: END, graceEndsAt: null, maxCollaborators: 2, maxProducts: 30 },
    ],
    [
      'PRO without an end date',
      { plan: 'PRO', planEndsAt: null, graceEndsAt: null, maxCollaborators: 10, maxProducts: null },
    ],
    [
      'a grace end not after the plan end',
      { plan: 'PRO', planEndsAt: END, graceEndsAt: END, maxCollaborators: 10, maxProducts: null },
    ],
  ])('throws for %s and leaves the row unchanged', async (_name, fields) => {
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: ORG } });

    await expect(write(fields)).rejects.toThrow();

    expect(await prisma.organization.findUniqueOrThrow({ where: { id: ORG } })).toEqual(before);
  });
});

describe('listTeamSeats (AC-3, ASVS v5.0.0-8.2.1)', () => {
  it('returns ACTIVE, INVITED and PAUSED non-owner seats, oldest invitation first', async () => {
    await seedSeat({ n: 1, role: 'OWNER', status: 'ACTIVE', invitedAt: new Date('2026-01-01') });
    await seedSeat({ n: 2, status: 'PAUSED', invitedAt: new Date('2026-02-03') });
    await seedSeat({ n: 3, status: 'ACTIVE', invitedAt: new Date('2026-02-01') });
    await seedSeat({ n: 4, status: 'INVITED', invitedAt: new Date('2026-02-02') });
    await seedSeat({ n: 5, status: 'REVOKED', invitedAt: new Date('2026-02-04') });
    await seedSeat({ n: 6, status: 'ACTIVE', deleted: true, invitedAt: new Date('2026-02-05') });
    await seedSeat({ n: 7, role: 'OWNER', status: 'ACTIVE', organizationId: OTHER_ORG });
    await seedSeat({ n: 8, status: 'ACTIVE', organizationId: OTHER_ORG });

    const seats = await prisma.$transaction((tx) => listTeamSeats(tx, ORG));

    expect(seats.map((s) => s.id)).toEqual([collab(3), collab(4), collab(2)]);
    expect(seats.map((s) => s.status)).toEqual(['ACTIVE', 'INVITED', 'PAUSED']);
    expect(seats[0]).toEqual({
      id: collab(3),
      personId: person(3),
      role: 'MANAGER',
      status: 'ACTIVE',
      invitedAt: new Date('2026-02-01'),
      acceptedAt: REG,
    });
    expect(seats[1].acceptedAt).toBeNull();
  });

  it('orders equal invitation dates by id', async () => {
    const same = new Date('2026-03-01');
    await seedSeat({ n: 1, role: 'OWNER', status: 'ACTIVE' });
    await seedSeat({ n: 3, status: 'ACTIVE', invitedAt: same });
    await seedSeat({ n: 2, status: 'ACTIVE', invitedAt: same });
    const seats = await prisma.$transaction((tx) => listTeamSeats(tx, ORG));
    expect(seats.map((s) => s.id)).toEqual([collab(2), collab(3)]);
  });
});

describe('setSeatPaused (AC-4, AC-5, AC-6, C-42, CM-03)', () => {
  beforeEach(async () => {
    await seedSeat({ n: 1, role: 'OWNER', status: 'ACTIVE' });
  });

  it('pauses an ACTIVE and an INVITED seat and bumps each scope', async () => {
    await seedSeat({ n: 2, status: 'ACTIVE' });
    await seedSeat({ n: 3, status: 'INVITED' });

    expect(await pause(2, true)).toBe(true);
    expect(await pause(3, true)).toBe(true);

    expect(await statusOf(2)).toBe('PAUSED');
    expect(await statusOf(3)).toBe('PAUSED');
    expect(await scopeOf(2)).toBe(1);
    expect(await scopeOf(3)).toBe(1);
  });

  it.each([
    ['accepted_at set', true, 'ACTIVE'],
    ['accepted_at empty', false, 'INVITED'],
  ] as const)('resumes a PAUSED seat with %s as %s', async (_name, accepted, status) => {
    await seedSeat({ n: 2, status: 'PAUSED', accepted });

    expect(await pause(2, false)).toBe(true);

    expect(await statusOf(2)).toBe(status);
    expect(await scopeOf(2)).toBe(1);
  });

  it('changes nothing for the OWNER', async () => {
    expect(await pause(1, true)).toBe(false);
    expect(await statusOf(1)).toBe('ACTIVE');
    expect(await scopeOf(1)).toBe(0);
  });

  it.each([
    ['a REVOKED seat', { status: 'REVOKED' }],
    ['a deleted seat', { status: 'ACTIVE', deleted: true }],
  ] as const)('changes nothing for %s', async (_name, seed) => {
    await seedSeat({ n: 2, ...seed });
    const before = await prisma.collaboration.findUniqueOrThrow({ where: { id: collab(2) } });

    expect(await pause(2, true)).toBe(false);
    expect(await pause(2, false)).toBe(false);

    expect(await prisma.collaboration.findUniqueOrThrow({ where: { id: collab(2) } })).toEqual(
      before
    );
    expect(await scopeOf(2)).toBe(0);
  });

  it('changes nothing for an ACTIVE seat resumed, or a PAUSED seat paused again', async () => {
    await seedSeat({ n: 2, status: 'ACTIVE' });
    await seedSeat({ n: 3, status: 'PAUSED' });

    expect(await pause(2, false)).toBe(false);
    expect(await pause(3, true)).toBe(false);

    expect(await statusOf(2)).toBe('ACTIVE');
    expect(await statusOf(3)).toBe('PAUSED');
    expect(await scopeOf(2)).toBe(0);
    expect(await scopeOf(3)).toBe(0);
  });

  it('returns false for an unknown collaboration', async () => {
    expect(await prisma.$transaction((tx) => setSeatPaused(tx, newId(), true))).toBe(false);
  });
});

describe('plan fields in the creation body (AB-1, CWE-915)', () => {
  it.each([
    ['plan', 'PRO'],
    ['max_collaborators', 99],
    ['plan_ends_at', '2027-01-01T00:00:00.000Z'],
    ['grace_ends_at', '2027-01-15T00:00:00.000Z'],
    ['max_products', 99],
  ])('answers 400 VALIDATION_ERROR for %s and creates nothing', async (field, value) => {
    const before = await prisma.organization.count();

    const response = await createAuthenticatedRequest(app, person(9))
      .post('/api/v1/organizations')
      .send({ id: newId(), name: 'Forced plan', [field]: value });

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.organization.count()).toBe(before);
  });
});
