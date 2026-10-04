import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c014-0000-7000-8000-000000000001';
const MANAGER = '0199c014-0000-7000-8000-000000000002';
const OTHER_OWNER = '0199c014-0000-7000-8000-000000000005';

const ORG_A = '0199c014-0000-7000-8000-0000000000a1';
const ORG_B = '0199c014-0000-7000-8000-0000000000b1';

const SUB_1 = '0199c014-0000-7000-8000-0000000000c1';
const SUB_2 = '0199c014-0000-7000-8000-0000000000c2';
const SUB_B = '0199c014-0000-7000-8000-0000000000c3';

const REG = new Date('2026-01-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

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

async function seedActive(id: string, organizationId: string, endsAt: Date | null) {
  await prisma.subscription.create({
    data: {
      id,
      organizationId,
      plan: 'BASIC',
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - DAY_MS),
      endsAt,
    },
  });
}

function end(orgId: string, personId = OWNER) {
  return createAuthenticatedRequest(app, personId).delete(
    `/api/v1/organizations/${orgId}/subscription`
  );
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600014001');
  await seedPerson(MANAGER, '+237600014002');
  await seedPerson(OTHER_OWNER, '+237600014005');
  await seedOrg(ORG_A, OWNER);
  await prisma.collaboration.create({
    data: {
      id: '0199c014-0000-7000-8000-0000000000d2',
      personId: MANAGER,
      organizationId: ORG_A,
      role: 'MANAGER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await seedOrg(ORG_B, OTHER_OWNER);
});

describe('DELETE /api/v1/organizations/:organizationId/subscription', () => {
  it('AC-1 end: 204, the row is EXPIRED and ends_at is now', async () => {
    await seedActive(SUB_1, ORG_A, new Date(Date.now() + 10 * DAY_MS));
    const before = Date.now();

    const response = await end(ORG_A);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: SUB_1 } });
    expect(row.status).toBe('EXPIRED');
    expect(row.endsAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.endsAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('AC-1 ends a row that has no end date', async () => {
    await seedActive(SUB_1, ORG_A, null);

    expect((await end(ORG_A)).status).toBe(204);
    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: SUB_1 } });
    expect(row.status).toBe('EXPIRED');
    expect(row.endsAt).not.toBeNull();
  });

  it('AC-2 nothing to end: 404 NOT_FOUND', async () => {
    const response = await end(ORG_A);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('AC-2 a second delete answers 404', async () => {
    await seedActive(SUB_1, ORG_A, new Date(Date.now() + DAY_MS));

    expect((await end(ORG_A)).status).toBe(204);
    expect((await end(ORG_A)).status).toBe(404);
  });

  it('AC-3 history: the ended row stays and a new subscription can be started', async () => {
    await seedActive(SUB_1, ORG_A, new Date(Date.now() + 10 * DAY_MS));
    expect((await end(ORG_A)).status).toBe(204);

    const started = await createAuthenticatedRequest(app, OWNER)
      .post(`/api/v1/organizations/${ORG_A}/subscription`)
      .send({
        id: SUB_2,
        plan: 'FREE',
        ends_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      });

    expect(started.status).toBe(201);
    const rows = await prisma.subscription.findMany({
      where: { organizationId: ORG_A },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      [SUB_1, 'EXPIRED'],
      [SUB_2, 'ACTIVE'],
    ]);
  });

  it('AB-1 a MANAGER gets 403 and the row stays ACTIVE', async () => {
    await seedActive(SUB_1, ORG_A, new Date(Date.now() + 10 * DAY_MS));

    const response = await end(ORG_A, MANAGER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: SUB_1 } });
    expect(row.status).toBe('ACTIVE');
  });

  it('an owner of another organization gets 404 and the row stays ACTIVE', async () => {
    await seedActive(SUB_B, ORG_B, new Date(Date.now() + 10 * DAY_MS));

    const response = await end(ORG_B, OWNER);

    expect(response.status).toBe(404);
    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: SUB_B } });
    expect(row.status).toBe('ACTIVE');
  });

  it('answers 400 for a malformed organization id', async () => {
    expect((await end('not-a-uuid')).status).toBe(400);
  });

  it('answers 401 without a token', async () => {
    const response = await request(app).delete(`/api/v1/organizations/${ORG_A}/subscription`);
    expect(response.status).toBe(401);
  });
});
