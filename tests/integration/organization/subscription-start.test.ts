import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c013-0000-7000-8000-000000000001';
const MANAGER = '0199c013-0000-7000-8000-000000000002';
const SELLER = '0199c013-0000-7000-8000-000000000003';
const DRIVER = '0199c013-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c013-0000-7000-8000-000000000005';
const OUTSIDER = '0199c013-0000-7000-8000-000000000006';

const ORG_A = '0199c013-0000-7000-8000-0000000000a1';
const ORG_B = '0199c013-0000-7000-8000-0000000000b1';

const SUB_1 = '0199c013-0000-7000-8000-0000000000c1';
const SUB_2 = '0199c013-0000-7000-8000-0000000000c2';
const SUB_OLD = '0199c013-0000-7000-8000-0000000000c3';

const REG = new Date('2026-01-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

type SubscriptionBody = {
  id: string;
  plan: string;
  status: string;
  starts_at: string;
  ends_at: string;
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

async function seedOrg(id: string, ownerId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id, name: 'Org ' + id.slice(-2) } });
    await tx.collaboration.create({
      data: {
        id: id.replace(/.$/, '9'),
        personId: ownerId,
        organizationId: id,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  });
}

async function seedMember(orgId: string, personId: string, role: 'MANAGER' | 'SELLER' | 'DRIVER') {
  await prisma.collaboration.create({
    data: {
      id: orgId.replace(/.$/, '7').replace(/.{2}(?=.{10}$)/, personId.slice(-2)),
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

const future = (days = 30) => new Date(Date.now() + days * DAY_MS).toISOString();

const goodBody = (over: Record<string, unknown> = {}) => ({
  id: SUB_1,
  plan: 'FREE',
  ends_at: future(),
  ...over,
});

function start(orgId: string, body: unknown, personId = OWNER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/subscription`)
    .send(body as object);
}

function read(orgId: string, personId = OWNER) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${orgId}/subscription`
  );
}

async function seedSubscription(
  id: string,
  organizationId: string,
  status: 'ACTIVE' | 'EXPIRED',
  endsAt: Date
) {
  await prisma.subscription.create({
    data: {
      id,
      organizationId,
      plan: 'BASIC',
      status,
      startsAt: new Date(endsAt.getTime() - 30 * DAY_MS),
      endsAt,
    },
  });
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600013001');
  await seedPerson(MANAGER, '+237600013002');
  await seedPerson(SELLER, '+237600013003');
  await seedPerson(DRIVER, '+237600013004');
  await seedPerson(OTHER_OWNER, '+237600013005');
  await seedPerson(OUTSIDER, '+237600013006');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER');
  await seedMember(ORG_A, SELLER, 'SELLER');
  await seedMember(ORG_A, DRIVER, 'DRIVER');
  await seedOrg(ORG_B, OTHER_OWNER);
});

describe('POST /api/v1/organizations/:organizationId/subscription', () => {
  it('AC-1 start: 201 with the closed view and one ACTIVE row', async () => {
    const endsAt = future(30);
    const before = Date.now();

    const response = await start(ORG_A, goodBody({ ends_at: endsAt }));

    expect(response.status).toBe(201);
    const body = bodyOf<SubscriptionBody>(response);
    expect(Object.keys(body).sort()).toEqual(['ends_at', 'id', 'plan', 'starts_at', 'status']);
    expect(body).toMatchObject({ id: SUB_1, plan: 'FREE', status: 'ACTIVE', ends_at: endsAt });
    expect(Date.parse(body.starts_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(body.starts_at)).toBeLessThanOrEqual(Date.now() + 1000);

    const rows = await prisma.subscription.findMany({ where: { organizationId: ORG_A } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: SUB_1, plan: 'FREE', status: 'ACTIVE' });
  });

  it('AC-2 second active: 409 SUBSCRIPTION_EXISTS and nothing added (C-31)', async () => {
    await seedSubscription(SUB_OLD, ORG_A, 'ACTIVE', new Date(Date.now() + 10 * DAY_MS));

    const response = await start(ORG_A, goodBody({ id: SUB_2 }));

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('SUBSCRIPTION_EXISTS');
    expect(await prisma.subscription.count({ where: { organizationId: ORG_A } })).toBe(1);
  });

  it('AC-2 concurrent starts leave exactly one ACTIVE row', async () => {
    const [a, b] = await Promise.all([
      start(ORG_A, goodBody({ id: SUB_1 })),
      start(ORG_A, goodBody({ id: SUB_2 })),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(
      await prisma.subscription.count({ where: { organizationId: ORG_A, status: 'ACTIVE' } })
    ).toBe(1);
  });

  it('AC-3 lapsed: the old row becomes EXPIRED and the new one ACTIVE', async () => {
    await seedSubscription(SUB_OLD, ORG_A, 'ACTIVE', new Date(Date.now() - DAY_MS));

    const response = await start(ORG_A, goodBody({ id: SUB_2 }));

    expect(response.status).toBe(201);
    const old = await prisma.subscription.findUniqueOrThrow({ where: { id: SUB_OLD } });
    const fresh = await prisma.subscription.findUniqueOrThrow({ where: { id: SUB_2 } });
    expect(old.status).toBe('EXPIRED');
    expect(fresh.status).toBe('ACTIVE');
  });

  it('a repeat with the same id returns the first response', async () => {
    const body = goodBody();
    const first = await start(ORG_A, body);
    const second = await start(ORG_A, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.subscription.count({ where: { organizationId: ORG_A } })).toBe(1);
  });

  it.each([
    ['ends_at in the past', { ends_at: new Date(Date.now() - DAY_MS).toISOString() }],
    ['ends_at not a date', { ends_at: 'tomorrow' }],
    ['plan empty', { plan: '' }],
    ['plan of 101 characters', { plan: 'p'.repeat(101) }],
    ['status in the body', { status: 'EXPIRED' }],
    ['starts_at in the body', { starts_at: new Date().toISOString() }],
    ['organization_id in the body', { organization_id: ORG_B }],
  ])('AC-4 validation: %s answers 400 VALIDATION_ERROR', async (_name, over) => {
    const response = await start(ORG_A, goodBody(over));

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('accepts a plan of exactly 100 characters', async () => {
    const response = await start(ORG_A, goodBody({ plan: 'p'.repeat(100) }));
    expect(response.status).toBe(201);
  });

  it('AB-1 a MANAGER, SELLER or DRIVER gets 403 and nothing is stored', async () => {
    for (const personId of [MANAGER, SELLER, DRIVER]) {
      const response = await start(ORG_A, goodBody(), personId);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    }
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('AB-2 a member of A posting to B gets 404 and nothing is stored', async () => {
    const response = await start(ORG_B, goodBody());

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('answers 400 for a malformed organization id', async () => {
    const response = await start('not-a-uuid', goodBody());
    expect(response.status).toBe(400);
  });

  it('answers 401 without a token', async () => {
    const { default: request } = await import('supertest');
    const response = await request(app)
      .post(`/api/v1/organizations/${ORG_A}/subscription`)
      .send(goodBody());
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/organizations/:organizationId/subscription', () => {
  it('AC-5 returns the ACTIVE row to any member, with the closed view', async () => {
    const endsAt = new Date(Date.now() + 10 * DAY_MS);
    await seedSubscription(SUB_1, ORG_A, 'ACTIVE', endsAt);

    for (const personId of [OWNER, MANAGER, SELLER, DRIVER]) {
      const response = await read(ORG_A, personId);
      expect(response.status).toBe(200);
      const body = bodyOf<SubscriptionBody>(response);
      expect(Object.keys(body).sort()).toEqual(
        ['ends_at', 'id', 'plan', 'status', 'starts_at'].sort()
      );
      expect(body).toMatchObject({
        id: SUB_1,
        plan: 'BASIC',
        status: 'ACTIVE',
        ends_at: endsAt.toISOString(),
      });
    }
  });

  it('AC-5 answers 404 when there is none', async () => {
    const response = await read(ORG_A);
    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('answers 404 when only an EXPIRED row exists', async () => {
    await seedSubscription(SUB_OLD, ORG_A, 'EXPIRED', new Date(Date.now() - DAY_MS));
    expect((await read(ORG_A)).status).toBe(404);
  });

  it('answers 404 to a person who is not a member', async () => {
    await seedSubscription(SUB_1, ORG_A, 'ACTIVE', new Date(Date.now() + DAY_MS));
    expect((await read(ORG_A, OUTSIDER)).status).toBe(404);
    expect((await read(ORG_A, OTHER_OWNER)).status).toBe(404);
  });
});
