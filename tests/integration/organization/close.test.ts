import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c016-0000-7000-8000-000000000001';
const MANAGER = '0199c016-0000-7000-8000-000000000002';
const SELLER = '0199c016-0000-7000-8000-000000000003';
const INVITED_PERSON = '0199c016-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c016-0000-7000-8000-000000000006';
const REVOKED_PERSON = '0199c016-0000-7000-8000-000000000007';

const ORG_A = '0199c016-0000-7000-8000-0000000000a1';
const ORG_B = '0199c016-0000-7000-8000-0000000000b1';

const OWNER_ROW = '0199c016-0000-7000-8000-0000000000a9';
const MANAGER_ROW = '0199c016-0000-7000-8000-0000000000a2';
const SELLER_ROW = '0199c016-0000-7000-8000-0000000000a3';
const INVITED_ROW = '0199c016-0000-7000-8000-0000000000a5';
const REVOKED_ROW = '0199c016-0000-7000-8000-0000000000a7';
const OTHER_OWNER_ROW = '0199c016-0000-7000-8000-0000000000b9';

const SUB_A = '0199c016-0000-7000-8000-0000000000d1';
const SUB_B = '0199c016-0000-7000-8000-0000000000d2';

const GESTURE = '0199c016-0000-7000-8000-0000000000c1';

const REG = new Date('2026-01-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

async function seedPerson(id: string, phone: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      ...(registered
        ? { phoneVerifiedAt: REG, passwordHash: 'test-password-hash', registeredAt: REG }
        : {}),
    },
  });
}

async function seedCollaboration(
  id: string,
  personId: string,
  organizationId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  status: 'ACTIVE' | 'INVITED' | 'REVOKED',
  isPublicContact = false
) {
  await prisma.collaboration.create({
    data: {
      id,
      personId,
      organizationId,
      role,
      status,
      isPublicContact,
      acceptedAt: status === 'ACTIVE' ? REG : null,
    },
  });
}

function close(orgId: string, body: Record<string, unknown> = { id: GESTURE }, personId = OWNER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/close`)
    .send(body);
}

async function scopeVersionOf(personId: string) {
  return (await prisma.person.findUniqueOrThrow({ where: { id: personId } })).scopeVersion;
}

function rowOf(id: string) {
  return prisma.collaboration.findUniqueOrThrow({ where: { id } });
}

function statusOf(orgId: string) {
  return prisma.organization.findUniqueOrThrow({ where: { id: orgId } }).then((org) => org.status);
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600160001');
  await seedPerson(MANAGER, '+237600160002');
  await seedPerson(SELLER, '+237600160003');
  await seedPerson(INVITED_PERSON, '+237600160005', false);
  await seedPerson(OTHER_OWNER, '+237600160006');
  await seedPerson(REVOKED_PERSON, '+237600160007');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B' } });
  await seedCollaboration(OWNER_ROW, OWNER, ORG_A, 'OWNER', 'ACTIVE', true);
  await seedCollaboration(MANAGER_ROW, MANAGER, ORG_A, 'MANAGER', 'ACTIVE', true);
  await seedCollaboration(SELLER_ROW, SELLER, ORG_A, 'SELLER', 'ACTIVE');
  await seedCollaboration(INVITED_ROW, INVITED_PERSON, ORG_A, 'SELLER', 'INVITED');
  await seedCollaboration(REVOKED_ROW, REVOKED_PERSON, ORG_A, 'SELLER', 'REVOKED');
  await seedCollaboration(OTHER_OWNER_ROW, OTHER_OWNER, ORG_B, 'OWNER', 'ACTIVE', true);
  await prisma.subscription.create({
    data: {
      id: SUB_A,
      organizationId: ORG_A,
      plan: 'BASIC',
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - DAY_MS),
      endsAt: new Date(Date.now() + 30 * DAY_MS),
    },
  });
  await prisma.subscription.create({
    data: {
      id: SUB_B,
      organizationId: ORG_B,
      plan: 'BASIC',
      status: 'ACTIVE',
      startsAt: new Date(Date.now() - DAY_MS),
      endsAt: null,
    },
  });
});

describe('POST /api/v1/organizations/:organizationId/close', () => {
  it('AC-1 close: 200 and the status is CLOSED', async () => {
    const response = await close(ORG_A);

    expect(response.status).toBe(200);
    expect(bodyOf<{ status: string }>(response)).toEqual({ status: 'CLOSED' });
    expect(await statusOf(ORG_A)).toBe('CLOSED');
  });

  it('AC-2 every non-owner collaboration is REVOKED with the flag false', async () => {
    await close(ORG_A);

    for (const id of [MANAGER_ROW, SELLER_ROW, INVITED_ROW]) {
      const row = await rowOf(id);
      expect(row.status).toBe('REVOKED');
      expect(row.isPublicContact).toBe(false);
    }
    expect((await rowOf(REVOKED_ROW)).status).toBe('REVOKED');
  });

  it('AC-2 ACTIVE ones get scope_version +1 and one organization.closed notification', async () => {
    const managerBefore = await scopeVersionOf(MANAGER);
    const sellerBefore = await scopeVersionOf(SELLER);
    const invitedBefore = await scopeVersionOf(INVITED_PERSON);

    await close(ORG_A);

    expect(await scopeVersionOf(MANAGER)).toBe(managerBefore + 1);
    expect(await scopeVersionOf(SELLER)).toBe(sellerBefore + 1);
    expect(await scopeVersionOf(INVITED_PERSON)).toBe(invitedBefore);
    const notes = await prisma.notification.findMany({ orderBy: { recipientId: 'asc' } });
    expect(notes.map((n) => n.recipientId)).toEqual([MANAGER, SELLER]);
    for (const note of notes) {
      expect(note).toMatchObject({
        sourceEvent: 'organization.closed',
        organizationId: ORG_A,
        readStatus: 'UNREAD',
      });
    }
  });

  it('AC-2 the ACTIVE subscription is EXPIRED with ends_at = now; another business is untouched', async () => {
    const before = Date.now();

    await close(ORG_A);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: SUB_A } });
    expect(sub.status).toBe('EXPIRED');
    expect(sub.endsAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(sub.endsAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: SUB_B } })).status).toBe(
      'ACTIVE'
    );
    expect(await statusOf(ORG_B)).toBe('ACTIVE');
    expect((await rowOf(OTHER_OWNER_ROW)).status).toBe('ACTIVE');
  });

  it('AC-1 closes an organization that has no subscription', async () => {
    await prisma.subscription.delete({ where: { id: SUB_A } });

    const response = await close(ORG_A);

    expect(response.status).toBe(200);
    expect(await statusOf(ORG_A)).toBe('CLOSED');
  });

  it('AC-3 the owner collaboration stays ACTIVE and the organization stays readable', async () => {
    const ownerBefore = await scopeVersionOf(OWNER);

    await close(ORG_A);

    const owner = await rowOf(OWNER_ROW);
    expect(owner.status).toBe('ACTIVE');
    expect(owner.role).toBe('OWNER');
    expect(owner.isPublicContact).toBe(true);
    expect(await scopeVersionOf(OWNER)).toBe(ownerBefore);
    const read = await createAuthenticatedRequest(app, OWNER).get(`/api/v1/organizations/${ORG_A}`);
    expect(read.status).toBe(200);
    expect(bodyOf<{ status: string }>(read).status).toBe('CLOSED');
  });

  it('AC-4 refusals: SUSPENDED and CLOSED answer 409 ORGANIZATION_NOT_ACTIVE and change nothing', async () => {
    for (const [index, status] of (['SUSPENDED', 'CLOSED'] as const).entries()) {
      await prisma.organization.update({ where: { id: ORG_A }, data: { status } });

      const response = await close(ORG_A, { id: `0199c016-0000-7000-8000-0000000000e${index}` });

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
      expect(await statusOf(ORG_A)).toBe(status);
      expect((await rowOf(MANAGER_ROW)).status).toBe('ACTIVE');
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: SUB_A } })).status).toBe(
        'ACTIVE'
      );
      expect(await prisma.notification.count()).toBe(0);
      await prisma.organization.update({ where: { id: ORG_A }, data: { status: 'ACTIVE' } });
    }
  });

  it('AC-5 atomic: a failure on the subscription step leaves everything unchanged', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_org016_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced failure';
      END; $$`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_org016_fail BEFORE UPDATE ON subscriptions
      FOR EACH ROW EXECUTE FUNCTION test_org016_fail()`);
    const managerBefore = await scopeVersionOf(MANAGER);

    try {
      const response = await close(ORG_A);
      expect(response.status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_org016_fail ON subscriptions');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_org016_fail()');
    }

    expect(await statusOf(ORG_A)).toBe('ACTIVE');
    expect((await rowOf(MANAGER_ROW)).status).toBe('ACTIVE');
    expect((await rowOf(MANAGER_ROW)).isPublicContact).toBe(true);
    expect((await rowOf(INVITED_ROW)).status).toBe('INVITED');
    expect(await scopeVersionOf(MANAGER)).toBe(managerBefore);
    expect(await prisma.notification.count()).toBe(0);
  });

  it.each([
    ['a missing gesture id', {}],
    ['a malformed gesture id', { id: 'nope' }],
    ['an unknown field', { id: GESTURE, status: 'ACTIVE' }],
  ])('%s: 400 VALIDATION_ERROR and nothing changes', async (_label, body) => {
    const response = await close(ORG_A, body);

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await statusOf(ORG_A)).toBe('ACTIVE');
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post(`/api/v1/organizations/${ORG_A}/close`)
      .send({ id: GESTURE });
    expect(response.status).toBe(401);
  });
});

describe('security', () => {
  it('AB-1 a MANAGER gets 403 and the status is unchanged', async () => {
    const response = await close(ORG_A, { id: GESTURE }, MANAGER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await statusOf(ORG_A)).toBe('ACTIVE');
    expect((await rowOf(MANAGER_ROW)).status).toBe('ACTIVE');
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AB-2 a member of A closing B gets 404 and B is unchanged', async () => {
    const response = await close(ORG_B, { id: GESTURE }, OWNER);

    expect(response.status).toBe(404);
    expect(await statusOf(ORG_B)).toBe('ACTIVE');
    expect(await statusOf(ORG_A)).toBe('ACTIVE');
    expect((await rowOf(OTHER_OWNER_ROW)).status).toBe('ACTIVE');
  });
});
