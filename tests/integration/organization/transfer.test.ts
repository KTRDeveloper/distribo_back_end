import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { abilityFor } from '../../../src/shared/access/ability.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c015-0000-7000-8000-000000000001';
const MANAGER = '0199c015-0000-7000-8000-000000000002';
const SELLER = '0199c015-0000-7000-8000-000000000003';
const INVITED_PERSON = '0199c015-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c015-0000-7000-8000-000000000006';
const REVOKED_PERSON = '0199c015-0000-7000-8000-000000000007';

const ORG_A = '0199c015-0000-7000-8000-0000000000a1';
const ORG_B = '0199c015-0000-7000-8000-0000000000b1';

const OWNER_ROW = '0199c015-0000-7000-8000-0000000000a9';
const MANAGER_ROW = '0199c015-0000-7000-8000-0000000000a2';
const SELLER_ROW = '0199c015-0000-7000-8000-0000000000a3';
const INVITED_ROW = '0199c015-0000-7000-8000-0000000000a5';
const REVOKED_ROW = '0199c015-0000-7000-8000-0000000000a7';
const OTHER_OWNER_ROW = '0199c015-0000-7000-8000-0000000000b9';

const GESTURE = '0199c015-0000-7000-8000-0000000000c1';
const GESTURE_2 = '0199c015-0000-7000-8000-0000000000c2';

const REG = new Date('2026-01-01T00:00:00.000Z');

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
  extra: { amountHeld?: bigint } = {}
) {
  await prisma.collaboration.create({
    data: {
      id,
      personId,
      organizationId,
      role,
      status,
      acceptedAt: status === 'ACTIVE' ? REG : null,
      ...extra,
    },
  });
}

function transfer(orgId: string, body: Record<string, unknown>, personId = OWNER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/transfer-ownership`)
    .send(body);
}

async function scopeVersionOf(personId: string) {
  return (await prisma.person.findUniqueOrThrow({ where: { id: personId } })).scopeVersion;
}

function rowOf(id: string) {
  return prisma.collaboration.findUniqueOrThrow({ where: { id } });
}

async function activeOwners(orgId: string) {
  return prisma.collaboration.findMany({
    where: { organizationId: orgId, role: 'OWNER', status: 'ACTIVE' },
  });
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600150001');
  await seedPerson(MANAGER, '+237600150002');
  await seedPerson(SELLER, '+237600150003');
  await seedPerson(INVITED_PERSON, '+237600150005', false);
  await seedPerson(OTHER_OWNER, '+237600150006');
  await seedPerson(REVOKED_PERSON, '+237600150007');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B' } });
  await seedCollaboration(OWNER_ROW, OWNER, ORG_A, 'OWNER', 'ACTIVE');
  await seedCollaboration(MANAGER_ROW, MANAGER, ORG_A, 'MANAGER', 'ACTIVE');
  await seedCollaboration(SELLER_ROW, SELLER, ORG_A, 'SELLER', 'ACTIVE');
  await seedCollaboration(INVITED_ROW, INVITED_PERSON, ORG_A, 'SELLER', 'INVITED');
  await seedCollaboration(REVOKED_ROW, REVOKED_PERSON, ORG_A, 'SELLER', 'REVOKED');
  await seedCollaboration(OTHER_OWNER_ROW, OTHER_OWNER, ORG_B, 'OWNER', 'ACTIVE');
});

describe('POST /api/v1/organizations/:organizationId/transfer-ownership', () => {
  it('AC-1 transfer: the manager is OWNER, the caller is MANAGER, one ACTIVE OWNER', async () => {
    const response = await transfer(ORG_A, { id: GESTURE, collaboration_id: MANAGER_ROW });

    expect(response.status).toBe(200);
    expect(bodyOf<{ new_owner_collaboration_id: string }>(response)).toEqual({
      new_owner_collaboration_id: MANAGER_ROW,
    });
    const newOwner = await rowOf(MANAGER_ROW);
    const former = await rowOf(OWNER_ROW);
    expect(newOwner.role).toBe('OWNER');
    expect(newOwner.status).toBe('ACTIVE');
    expect(former.role).toBe('MANAGER');
    expect(former.status).toBe('ACTIVE');
    const owners = await activeOwners(ORG_A);
    expect(owners).toHaveLength(1);
    expect(owners[0]?.id).toBe(MANAGER_ROW);
  });

  it('AC-2 both scope_version +1 and one unread ownership.received for the new owner', async () => {
    const ownerBefore = await scopeVersionOf(OWNER);
    const managerBefore = await scopeVersionOf(MANAGER);

    const response = await transfer(ORG_A, { id: GESTURE, collaboration_id: MANAGER_ROW });

    expect(response.status).toBe(200);
    expect(await scopeVersionOf(OWNER)).toBe(ownerBefore + 1);
    expect(await scopeVersionOf(MANAGER)).toBe(managerBefore + 1);
    const notes = await prisma.notification.findMany({ where: { recipientId: MANAGER } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      sourceEvent: 'ownership.received',
      organizationId: ORG_A,
      relatedEntityType: 'collaboration',
      relatedEntityId: MANAGER_ROW,
    });
    expect(notes[0]?.readStatus).toBe('UNREAD');
    expect(await prisma.notification.count()).toBe(1);
  });

  describe('AC-3 refusals change nothing', () => {
    async function expectUnchanged() {
      expect((await rowOf(OWNER_ROW)).role).toBe('OWNER');
      expect((await rowOf(MANAGER_ROW)).role).toBe('MANAGER');
      expect((await activeOwners(ORG_A)).map((o) => o.id)).toEqual([OWNER_ROW]);
      expect(await prisma.notification.count()).toBe(0);
    }

    it('the caller as target: 400 VALIDATION_ERROR', async () => {
      const before = await scopeVersionOf(OWNER);

      const response = await transfer(ORG_A, { id: GESTURE, collaboration_id: OWNER_ROW });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await scopeVersionOf(OWNER)).toBe(before);
      await expectUnchanged();
    });

    it.each([
      ['INVITED', INVITED_ROW],
      ['REVOKED', REVOKED_ROW],
      ['in another business', OTHER_OWNER_ROW],
    ])('a target %s: 404 NOT_FOUND', async (_label, target) => {
      const before = await scopeVersionOf(OWNER);

      const response = await transfer(ORG_A, { id: GESTURE, collaboration_id: target });

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await scopeVersionOf(OWNER)).toBe(before);
      expect((await rowOf(target)).role).toBe(target === OTHER_OWNER_ROW ? 'OWNER' : 'SELLER');
      await expectUnchanged();
    });

    it('an unknown target id: 404 NOT_FOUND', async () => {
      const response = await transfer(ORG_A, {
        id: GESTURE,
        collaboration_id: '0199c015-0000-7000-8000-0000000000ff',
      });

      expect(response.status).toBe(404);
      await expectUnchanged();
    });

    it.each([
      ['a missing collaboration_id', { id: GESTURE }],
      ['a malformed collaboration_id', { id: GESTURE, collaboration_id: 'nope' }],
      ['an unknown field', { id: GESTURE, collaboration_id: MANAGER_ROW, role: 'OWNER' }],
      ['a missing gesture id', { collaboration_id: MANAGER_ROW }],
    ])('%s: 400 VALIDATION_ERROR', async (_label, body) => {
      const response = await transfer(ORG_A, body);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      await expectUnchanged();
    });

    it('requires authentication', async () => {
      const { default: request } = await import('supertest');
      const response = await request(app)
        .post(`/api/v1/organizations/${ORG_A}/transfer-ownership`)
        .send({ id: GESTURE, collaboration_id: MANAGER_ROW });
      expect(response.status).toBe(401);
    });
  });

  it('AC-4 atomic: a failing second update leaves the caller OWNER and nobody else', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_org015_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.role = 'OWNER' THEN RAISE EXCEPTION 'forced failure'; END IF;
        RETURN NEW;
      END; $$`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_org015_fail BEFORE UPDATE ON collaborations
      FOR EACH ROW EXECUTE FUNCTION test_org015_fail()`);
    const ownerBefore = await scopeVersionOf(OWNER);
    const managerBefore = await scopeVersionOf(MANAGER);

    try {
      const response = await transfer(ORG_A, { id: GESTURE, collaboration_id: MANAGER_ROW });
      expect(response.status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_org015_fail ON collaborations');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_org015_fail()');
    }

    expect((await rowOf(OWNER_ROW)).role).toBe('OWNER');
    expect((await rowOf(MANAGER_ROW)).role).toBe('MANAGER');
    expect((await activeOwners(ORG_A)).map((o) => o.id)).toEqual([OWNER_ROW]);
    expect(await scopeVersionOf(OWNER)).toBe(ownerBefore);
    expect(await scopeVersionOf(MANAGER)).toBe(managerBefore);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-5 repeat: the second answer equals the first and nothing changes twice', async () => {
    const first = await transfer(ORG_A, { id: GESTURE, collaboration_id: MANAGER_ROW });
    const managerAfterFirst = await scopeVersionOf(MANAGER);
    const second = await transfer(ORG_A, { id: GESTURE, collaboration_id: MANAGER_ROW });

    expect(first.status).toBe(200);
    expect(second.status).toBe(first.status);
    expect(bodyOf(second)).toEqual(bodyOf(first));
    expect(await scopeVersionOf(MANAGER)).toBe(managerAfterFirst);
    expect(await prisma.notification.count()).toBe(1);
    expect((await activeOwners(ORG_A)).map((o) => o.id)).toEqual([MANAGER_ROW]);
  });

  it('a new owner can transfer back with a new gesture id', async () => {
    await transfer(ORG_A, { id: GESTURE, collaboration_id: MANAGER_ROW });

    const back = await transfer(ORG_A, { id: GESTURE_2, collaboration_id: OWNER_ROW }, MANAGER);

    expect(back.status).toBe(200);
    expect((await activeOwners(ORG_A)).map((o) => o.id)).toEqual([OWNER_ROW]);
  });
});

describe('security', () => {
  it('AB-1 a MANAGER posting a transfer to themselves gets 403 and nothing changes', async () => {
    const before = await scopeVersionOf(MANAGER);

    const response = await transfer(ORG_A, { id: GESTURE, collaboration_id: MANAGER_ROW }, MANAGER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect((await rowOf(MANAGER_ROW)).role).toBe('MANAGER');
    expect((await rowOf(OWNER_ROW)).role).toBe('OWNER');
    expect(await scopeVersionOf(MANAGER)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AB-2 the transfer rule needs the network: refused when online is false', () => {
    const offline = abilityFor('OWNER', { onServer: false, online: false, daysSinceSync: 0 });
    const online = abilityFor('OWNER', { onServer: false, online: true, daysSinceSync: 0 });

    expect(offline.can('transfer_ownership', 'Organization')).toBe(false);
    expect(online.can('transfer_ownership', 'Organization')).toBe(true);
  });

  it('an owner of business B transferring in business A gets 404', async () => {
    const response = await transfer(
      ORG_A,
      { id: GESTURE, collaboration_id: MANAGER_ROW },
      OTHER_OWNER
    );

    expect(response.status).toBe(404);
    expect((await rowOf(OWNER_ROW)).role).toBe('OWNER');
  });
});
