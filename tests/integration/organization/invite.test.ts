import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c007-0000-7000-8000-000000000001';
const MANAGER = '0199c007-0000-7000-8000-000000000002';
const SELLER = '0199c007-0000-7000-8000-000000000003';
const DRIVER = '0199c007-0000-7000-8000-000000000004';
const REGISTERED_INVITEE = '0199c007-0000-7000-8000-000000000005';
const OTHER_OWNER = '0199c007-0000-7000-8000-000000000006';

const ORG_A = '0199c007-0000-7000-8000-0000000000a1';
const ORG_B = '0199c007-0000-7000-8000-0000000000b1';

const REG = new Date('2026-01-01T00:00:00.000Z');

const NEW_PHONE = '+237600007100';
const INVITEE_PHONE = '+237600007005';

const GESTURE_1 = '0199c007-0000-7000-8000-0000000000c1';
const GESTURE_2 = '0199c007-0000-7000-8000-0000000000c2';

type Invited = {
  id: string;
  person: { public_name: string | null; phone_number: string | null; registered: boolean };
  role: string;
  status: string;
  invited_at: string;
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

async function seedOrg(
  id: string,
  ownerId: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' = 'ACTIVE'
) {
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({
      data: { id, name: 'Org ' + id.slice(-2), status, maxCollaborators: null },
    });
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

async function seedMember(
  orgId: string,
  personId: string,
  role: 'MANAGER' | 'SELLER' | 'DRIVER',
  status: 'ACTIVE' | 'INVITED' | 'REVOKED'
) {
  await prisma.collaboration.create({
    data: {
      id: orgId.replace(/.$/, '7').replace(/.{2}(?=.{10}$)/, personId.slice(-2)),
      personId,
      organizationId: orgId,
      role,
      status,
      acceptedAt: status === 'ACTIVE' ? REG : null,
    },
  });
}

function invite(orgId: string, body: unknown, personId = OWNER) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${orgId}/collaborators`)
    .send(body as object);
}

const goodBody = (over: Record<string, unknown> = {}) => ({
  id: GESTURE_1,
  phone_number: NEW_PHONE,
  role: 'SELLER',
  ...over,
});

async function collaborationCount(orgId: string) {
  return prisma.collaboration.count({ where: { organizationId: orgId } });
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600007001');
  await seedPerson(MANAGER, '+237600007002');
  await seedPerson(SELLER, '+237600007003');
  await seedPerson(DRIVER, '+237600007004');
  await seedPerson(REGISTERED_INVITEE, INVITEE_PHONE);
  await seedPerson(OTHER_OWNER, '+237600007006');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER', 'ACTIVE');
  await seedMember(ORG_A, SELLER, 'SELLER', 'ACTIVE');
  await seedMember(ORG_A, DRIVER, 'DRIVER', 'ACTIVE');
  await seedOrg(ORG_B, OTHER_OWNER);
});

describe('POST /api/v1/organizations/:organizationId/collaborators', () => {
  it('AC-1 invites a guest by number: 201, guest created, INVITED, not a public contact', async () => {
    const before = await collaborationCount(ORG_A);

    const response = await invite(ORG_A, goodBody());

    expect(response.status).toBe(201);
    const body = bodyOf<Invited>(response);
    expect(Object.keys(body).sort()).toEqual(['id', 'invited_at', 'person', 'role', 'status']);
    expect(body).toMatchObject({
      id: GESTURE_1,
      role: 'SELLER',
      status: 'INVITED',
      person: { public_name: null, phone_number: NEW_PHONE, registered: false },
    });
    expect(Number.isNaN(Date.parse(body.invited_at))).toBe(false);

    const guest = await prisma.person.findFirstOrThrow({ where: { phoneNumber: NEW_PHONE } });
    expect(guest.registeredAt).toBeNull();
    const row = await prisma.collaboration.findFirstOrThrow({
      where: { personId: guest.id, organizationId: ORG_A },
    });
    expect(row).toMatchObject({
      id: GESTURE_1,
      role: 'SELLER',
      status: 'INVITED',
      isPublicContact: false,
      acceptedAt: null,
    });
    expect(await collaborationCount(ORG_A)).toBe(before + 1);
  });

  it('accepts a number typed without the country code', async () => {
    const response = await invite(ORG_A, goodBody({ phone_number: '600007100' }));
    expect(response.status).toBe(201);
    expect(bodyOf<Invited>(response).person.phone_number).toBe(NEW_PHONE);
  });

  it('AC-2 notifies a registered invitee once with collaboration.invited', async () => {
    const response = await invite(ORG_A, goodBody({ phone_number: INVITEE_PHONE, role: 'DRIVER' }));

    expect(response.status).toBe(201);
    expect(bodyOf<Invited>(response).person.registered).toBe(true);
    const rows = await prisma.notification.findMany({ where: { recipientId: REGISTERED_INVITEE } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceEvent: 'collaboration.invited',
      readStatus: 'UNREAD',
      organizationId: ORG_A,
      relatedEntityType: 'collaboration',
      relatedEntityId: GESTURE_1,
    });
  });

  it('does not notify a guest invitee', async () => {
    await invite(ORG_A, goodBody());
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-3 reuses a REVOKED row: INVITED, new role, fresh invited_at, accepted_at emptied', async () => {
    const oldInvite = new Date('2026-02-01T00:00:00.000Z');
    await prisma.collaboration.create({
      data: {
        id: '0199c007-0000-7000-8000-0000000000d1',
        personId: REGISTERED_INVITEE,
        organizationId: ORG_A,
        role: 'SELLER',
        status: 'REVOKED',
        invitedAt: oldInvite,
        acceptedAt: new Date('2026-02-02T00:00:00.000Z'),
      },
    });

    const response = await invite(ORG_A, goodBody({ phone_number: INVITEE_PHONE, role: 'DRIVER' }));

    expect(response.status).toBe(201);
    const body = bodyOf<Invited>(response);
    expect(body).toMatchObject({
      id: '0199c007-0000-7000-8000-0000000000d1',
      role: 'DRIVER',
      status: 'INVITED',
    });
    const rows = await prisma.collaboration.findMany({
      where: { personId: REGISTERED_INVITEE, organizationId: ORG_A },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      role: 'DRIVER',
      status: 'INVITED',
      acceptedAt: null,
      isPublicContact: false,
    });
    expect(rows[0]?.invitedAt.getTime()).toBeGreaterThan(oldInvite.getTime());
  });

  it.each([
    ['ACTIVE', 'ACTIVE'],
    ['INVITED', 'INVITED'],
  ] as const)('AC-4 answers 409 ALREADY_MEMBER for a %s member', async (_label, status) => {
    await seedMember(ORG_A, REGISTERED_INVITEE, 'SELLER', status);
    const before = await collaborationCount(ORG_A);

    const response = await invite(ORG_A, goodBody({ phone_number: INVITEE_PHONE }));

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('ALREADY_MEMBER');
    expect(await collaborationCount(ORG_A)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-4 refuses role OWNER with 400 and stores nothing', async () => {
    const before = await collaborationCount(ORG_A);
    const people = await prisma.person.count();

    const response = await invite(ORG_A, goodBody({ role: 'OWNER' }));

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await collaborationCount(ORG_A)).toBe(before);
    expect(await prisma.person.count()).toBe(people);
  });

  it.each([['+237222123456'], ['not a number'], ['']])(
    'AC-4 refuses the number %j with 400 and stores nothing',
    async (phone) => {
      const people = await prisma.person.count();

      const response = await invite(ORG_A, goodBody({ phone_number: phone }));

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('222123456');
      expect(await prisma.person.count()).toBe(people);
    }
  );

  it.each(['SUSPENDED', 'CLOSED'] as const)(
    'AC-4 answers 409 ORGANIZATION_NOT_ACTIVE for a %s organization',
    async (status) => {
      const org = '0199c007-0000-7000-8000-0000000000e1';
      await seedOrg(org, OWNER, status);
      const people = await prisma.person.count();

      const response = await invite(org, goodBody());

      expect(response.status).toBe(409);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
      expect(await collaborationCount(org)).toBe(1);
      expect(await prisma.person.count()).toBe(people);
    }
  );

  it('AC-5 a repeat of the same body creates one collaboration and returns equal answers', async () => {
    const first = await invite(ORG_A, goodBody());
    const before = await collaborationCount(ORG_A);
    const second = await invite(ORG_A, goodBody());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await collaborationCount(ORG_A)).toBe(before);
    expect(
      await prisma.collaboration.count({ where: { organizationId: ORG_A, status: 'INVITED' } })
    ).toBe(1);
  });

  it('a different gesture id for the same number answers 409 ALREADY_MEMBER', async () => {
    await invite(ORG_A, goodBody());
    const response = await invite(ORG_A, goodBody({ id: GESTURE_2 }));
    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('ALREADY_MEMBER');
  });

  it('requires authentication', async () => {
    const { default: request } = await import('supertest');
    const response = await request(app)
      .post(`/api/v1/organizations/${ORG_A}/collaborators`)
      .send(goodBody());
    expect(response.status).toBe(401);
  });
});

describe('security', () => {
  it.each([
    ['MANAGER', MANAGER],
    ['SELLER', SELLER],
    ['DRIVER', DRIVER],
  ])('AB-1 a %s gets 403 and nothing is stored', async (_label, personId) => {
    const before = await collaborationCount(ORG_A);
    const people = await prisma.person.count();

    const response = await invite(ORG_A, goodBody(), personId);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await collaborationCount(ORG_A)).toBe(before);
    expect(await prisma.person.count()).toBe(people);
  });

  it('AB-2 a member of A posting to business B gets 404 and nothing is stored', async () => {
    const before = await collaborationCount(ORG_B);
    const people = await prisma.person.count();

    const response = await invite(ORG_B, goodBody(), OWNER);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await collaborationCount(ORG_B)).toBe(before);
    expect(await prisma.person.count()).toBe(people);
  });

  it.each([
    ['status', { status: 'ACTIVE' }],
    ['role OWNER', { role: 'OWNER' }],
    ['organization_id', { organization_id: ORG_B }],
    ['is_public_contact', { is_public_contact: true }],
    ['person_id', { person_id: OWNER }],
  ])('AB-3 rejects mass assignment of %s with 400', async (_label, extra) => {
    const before = await collaborationCount(ORG_A);

    const response = await invite(ORG_A, goodBody(extra));

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await collaborationCount(ORG_A)).toBe(before);
  });
});
