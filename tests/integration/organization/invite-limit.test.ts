import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c030-0000-7000-8000-000000000001';
const ORG = '0199c030-0000-7000-8000-0000000000a1';
const REG = new Date('2026-01-01T00:00:00.000Z');

type Status = 'ACTIVE' | 'INVITED' | 'REVOKED' | 'PAUSED';

let counter = 0;

/** Creates a registered person with a unique phone and returns the id. */
async function seedPerson(registered = true): Promise<{ id: string; phone: string }> {
  counter += 1;
  const n = String(counter).padStart(2, '0');
  const id = `0199c030-0000-7000-8000-0000000001${n}`;
  const phone = `+2376000300${n}`;
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: registered ? REG : null,
    },
  });
  return { id, phone };
}

async function seedMember(status: Status): Promise<{ id: string; phone: string }> {
  const person = await seedPerson();
  await prisma.collaboration.create({
    data: {
      id: `0199c030-0000-7000-8000-0000000002${String(counter).padStart(2, '0')}`,
      personId: person.id,
      organizationId: ORG,
      role: 'SELLER',
      status,
      acceptedAt: status === 'ACTIVE' || status === 'PAUSED' ? REG : null,
    },
  });
  return person;
}

async function seedMembers(active: number, invited: number) {
  for (let i = 0; i < active; i += 1) await seedMember('ACTIVE');
  for (let i = 0; i < invited; i += 1) await seedMember('INVITED');
}

let gesture = 0;
function invite(phone: string) {
  gesture += 1;
  return createAuthenticatedRequest(app, OWNER)
    .post(`/api/v1/organizations/${ORG}/collaborators`)
    .send({
      id: `0199c030-0000-7000-8000-0000000003${String(gesture).padStart(2, '0')}`,
      phone_number: phone,
      role: 'SELLER',
    });
}

async function setMax(max: number | null) {
  await prisma.organization.update({ where: { id: ORG }, data: { maxCollaborators: max } });
}

beforeEach(async () => {
  counter = 0;
  gesture = 0;
  await prisma.person.create({
    data: {
      id: OWNER,
      fullName: 'Fixture Owner',
      phoneNumber: '+237600031000',
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: ORG, name: 'Org limit' } });
    await tx.collaboration.create({
      data: {
        id: '0199c030-0000-7000-8000-0000000000a9',
        personId: OWNER,
        organizationId: ORG,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  });
});

const NEW_PHONE = '+237600030900';

async function noTrace(people: number, collaborations: number) {
  expect(await prisma.person.count()).toBe(people);
  expect(await prisma.collaboration.count()).toBe(collaborations);
  expect(await prisma.notification.count()).toBe(0);
}

describe('invitation limit', () => {
  it.each([
    [1, 0, 2, 201],
    [1, 1, 2, 409],
    [2, 0, 2, 409],
    [6, 3, null, 201],
  ] as const)('AC-1 %i ACTIVE, %i INVITED, max %s -> %i', async (active, invited, max, status) => {
    await seedMembers(active, invited);
    await setMax(max);

    const response = await invite(NEW_PHONE);

    expect(response.status).toBe(status);
    if (status === 409) {
      expect(bodyOf<ErrorBody>(response).error.code).toBe('COLLABORATOR_LIMIT_REACHED');
    }
  });

  it('AC-2 REVOKED and PAUSED collaborators leave room', async () => {
    await seedMember('ACTIVE');
    await seedMember('REVOKED');
    await seedMember('PAUSED');
    await setMax(2);

    const response = await invite(NEW_PHONE);

    expect(response.status).toBe(201);
  });

  it('does not count a deleted collaboration', async () => {
    const gone = await seedMember('ACTIVE');
    await prisma.collaboration.updateMany({
      where: { personId: gone.id },
      data: { deletedAt: new Date() },
    });
    await seedMember('ACTIVE');
    await setMax(2);

    expect((await invite(NEW_PHONE)).status).toBe(201);
  });

  it('AC-3 inviting a REVOKED person at the limit answers 409 and the row stays REVOKED', async () => {
    await seedMembers(2, 0);
    const revoked = await seedMember('REVOKED');
    await setMax(2);

    const response = await invite(revoked.phone);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('COLLABORATOR_LIMIT_REACHED');
    const row = await prisma.collaboration.findFirstOrThrow({ where: { personId: revoked.id } });
    expect(row.status).toBe('REVOKED');
  });

  it('inviting a REVOKED person below the limit counts as a new invitation', async () => {
    const revoked = await seedMember('REVOKED');
    await setMax(2);

    const response = await invite(revoked.phone);

    expect(response.status).toBe(201);
    const row = await prisma.collaboration.findFirstOrThrow({ where: { personId: revoked.id } });
    expect(row.status).toBe('INVITED');
  });

  it.each([
    ['at the limit', 1],
    ['below the limit', 5],
  ] as const)('AC-4 a PAUSED person is already a member, %s', async (_label, max) => {
    await seedMember('ACTIVE');
    const paused = await seedMember('PAUSED');
    await setMax(max);

    const response = await invite(paused.phone);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('ALREADY_MEMBER');
  });

  it('AC-5 a refusal leaves no person, collaboration or notification', async () => {
    await seedMembers(2, 0);
    await setMax(2);
    const people = await prisma.person.count();
    const collaborations = await prisma.collaboration.count();

    const response = await invite(NEW_PHONE);

    expect(response.status).toBe(409);
    await noTrace(people, collaborations);
  });

  it('AC-5 a refusal for a registered person leaves no notification', async () => {
    await seedMembers(2, 0);
    await setMax(2);
    const registered = await seedPerson(true);
    const people = await prisma.person.count();
    const collaborations = await prisma.collaboration.count();

    const response = await invite(registered.phone);

    expect(response.status).toBe(409);
    await noTrace(people, collaborations);
  });
});

describe('security', () => {
  it('AB-1 two simultaneous invitations take the last place: one 201, one 409', async () => {
    await seedMember('ACTIVE');
    await setMax(2);

    const responses = await Promise.all([invite('+237600030901'), invite('+237600030902')]);

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const refused = responses.find((r) => r.status === 409);
    expect(bodyOf<ErrorBody>(refused!).error.code).toBe('COLLABORATOR_LIMIT_REACHED');
    expect(
      await prisma.collaboration.count({
        where: {
          organizationId: ORG,
          role: { not: 'OWNER' },
          status: { in: ['ACTIVE', 'INVITED'] },
        },
      })
    ).toBe(2);
  });
});
