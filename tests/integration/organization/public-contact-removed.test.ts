import type { Collaboration } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c031-0000-7000-8000-000000000001';
const MANAGER = '0199c031-0000-7000-8000-000000000002';
const SELLER = '0199c031-0000-7000-8000-000000000003';
const DRIVER = '0199c031-0000-7000-8000-000000000004';
const CREATOR = '0199c031-0000-7000-8000-000000000005';

const ORG_A = '0199c031-0000-7000-8000-0000000000a1';

const OWNER_ROW = '0199c031-0000-7000-8000-0000000000a9';
const MANAGER_ROW = '0199c031-0000-7000-8000-0000000000a2';
const SELLER_ROW = '0199c031-0000-7000-8000-0000000000a3';
const DRIVER_ROW = '0199c031-0000-7000-8000-0000000000a4';

const REG = new Date('2026-01-01T00:00:00.000Z');

type TeamPage = { items: Array<Record<string, unknown>>; next_cursor: string | null };

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

async function seedCollaboration(
  id: string,
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER'
) {
  await prisma.collaboration.create({
    data: {
      id,
      personId,
      organizationId: ORG_A,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

function patchMe(personId: string, body: unknown = { is_public_contact: true }) {
  return createAuthenticatedRequest(app, personId)
    .patch(`/api/v1/organizations/${ORG_A}/collaborators/me`)
    .send(body as object);
}

async function collaborations(): Promise<Collaboration[]> {
  const rows = await prisma.collaboration.findMany({
    where: { organizationId: ORG_A },
    orderBy: { id: 'asc' },
  });
  return rows;
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600031001');
  await seedPerson(MANAGER, '+237600031002');
  await seedPerson(SELLER, '+237600031003');
  await seedPerson(DRIVER, '+237600031004');
  await seedPerson(CREATOR, '+237600031005');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await seedCollaboration(OWNER_ROW, OWNER, 'OWNER');
  await seedCollaboration(MANAGER_ROW, MANAGER, 'MANAGER');
  await seedCollaboration(SELLER_ROW, SELLER, 'SELLER');
  await seedCollaboration(DRIVER_ROW, DRIVER, 'DRIVER');
});

describe('collaborators/me is gone (ORG-031)', () => {
  it('AC-1 the OWNER gets 400 VALIDATION_ERROR and no row changes', async () => {
    const before = await collaborations();

    const response = await patchMe(OWNER);

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await collaborations()).toEqual(before);
  });

  it('AC-1 a MANAGER gets 403 FORBIDDEN and no row changes', async () => {
    const before = await collaborations();

    const response = await patchMe(MANAGER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await collaborations()).toEqual(before);
  });

  it('AC-2 a new business has an OWNER collaboration without the removed flag', async () => {
    const id = newId();
    const response = await createAuthenticatedRequest(app, CREATOR)
      .post('/api/v1/organizations')
      .send({ id, name: 'Chez Mama' });

    expect(response.status).toBe(201);
    const owner = await prisma.collaboration.findFirstOrThrow({
      where: { organizationId: id, role: 'OWNER' },
    });
    expect(owner).toMatchObject({ personId: CREATOR, role: 'OWNER', status: 'ACTIVE' });
    expect(owner).not.toHaveProperty('isPublicContact');
  });

  it('AC-3 no team item carries an is_public_contact key', async () => {
    const response = await createAuthenticatedRequest(app, OWNER).get(
      `/api/v1/organizations/${ORG_A}/collaborators`
    );

    expect(response.status).toBe(200);
    const page = bodyOf<TeamPage>(response);
    expect(page.items).toHaveLength(4);
    for (const item of page.items) expect(item).not.toHaveProperty('is_public_contact');
  });

  it('AC-4 revoking an ACTIVE collaborator still works without the flag', async () => {
    const response = await createAuthenticatedRequest(app, OWNER).delete(
      `/api/v1/organizations/${ORG_A}/collaborators/${SELLER_ROW}`
    );

    expect(response.status).toBe(204);
    const row = await prisma.collaboration.findUniqueOrThrow({ where: { id: SELLER_ROW } });
    expect(row.status).toBe('REVOKED');
  });

  it.each([
    ['MANAGER', MANAGER],
    ['SELLER', SELLER],
    ['DRIVER', DRIVER],
  ])('AB-1 a %s cannot publish their own number: 403, rows unchanged', async (_role, personId) => {
    const before = await collaborations();
    const response = await patchMe(personId);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await collaborations()).toEqual(before);
  });
});
