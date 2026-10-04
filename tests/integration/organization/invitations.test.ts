import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c008-0000-7000-8000-000000000001';
const INVITEE = '0199c008-0000-7000-8000-000000000002';
const OTHER = '0199c008-0000-7000-8000-000000000003';

const ORG_A = '0199c008-0000-7000-8000-0000000000a1';
const ORG_B = '0199c008-0000-7000-8000-0000000000b1';
const ORG_C = '0199c008-0000-7000-8000-0000000000c1';

const INV_A = '0199c008-0000-7000-8000-0000000000d1';
const INV_B = '0199c008-0000-7000-8000-0000000000d2';
const ACTIVE_C = '0199c008-0000-7000-8000-0000000000d3';
const REVOKED_ID = '0199c008-0000-7000-8000-0000000000d4';
const OTHERS_INV = '0199c008-0000-7000-8000-0000000000d5';
const UNKNOWN = '0199c008-0000-7000-8000-0000000000ff';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Item = {
  id: string;
  organization_id: string;
  organization_name: string;
  role: string;
  invited_at: string;
};
type Page = { items: Item[]; next_cursor: string | null };

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

async function seedOrg(id: string, name: string) {
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id, name } });
    await tx.collaboration.create({
      data: {
        id: id.replace(/.$/, '9'),
        personId: OWNER,
        organizationId: id,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  });
}

async function seedCollab(
  id: string,
  orgId: string,
  personId: string,
  status: 'ACTIVE' | 'INVITED' | 'REVOKED',
  role: 'MANAGER' | 'SELLER' | 'DRIVER' = 'SELLER',
  invitedAt?: Date
) {
  await prisma.collaboration.create({
    data: {
      id,
      personId,
      organizationId: orgId,
      role,
      status,
      invitedAt,
      acceptedAt: status === 'ACTIVE' ? REG : null,
    },
  });
}

const list = (personId = INVITEE, query = '?status=INVITED') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/collaborations${query}`);
const accept = (id: string, personId = INVITEE, body: object = {}) =>
  createAuthenticatedRequest(app, personId).post(`/api/v1/collaborations/${id}/accept`).send(body);
const decline = (id: string, personId = INVITEE) =>
  createAuthenticatedRequest(app, personId).post(`/api/v1/collaborations/${id}/decline`);

async function row(id: string) {
  return prisma.collaboration.findFirstOrThrow({ where: { id } });
}
async function scope(personId: string) {
  return (await prisma.person.findFirstOrThrow({ where: { id: personId } })).scopeVersion;
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600008001');
  await seedPerson(INVITEE, '+237600008002');
  await seedPerson(OTHER, '+237600008003');
  await seedOrg(ORG_A, 'Alpha Trading');
  await seedOrg(ORG_B, 'Beta Trading');
  await seedOrg(ORG_C, 'Gamma Trading');
  await seedCollab(INV_A, ORG_A, INVITEE, 'INVITED', 'SELLER', new Date('2026-03-01T00:00:00Z'));
  await seedCollab(INV_B, ORG_B, INVITEE, 'INVITED', 'DRIVER', new Date('2026-04-01T00:00:00Z'));
  await seedCollab(ACTIVE_C, ORG_C, INVITEE, 'ACTIVE', 'MANAGER');
});

describe('GET /api/v1/collaborations', () => {
  it('AC-1 lists two invitations with organization names and closed fields', async () => {
    const response = await list();

    expect(response.status).toBe(200);
    const body = bodyOf<Page>(response);
    expect(body.items).toHaveLength(2);
    expect(body.next_cursor).toBeNull();
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual([
        'id',
        'invited_at',
        'organization_id',
        'organization_name',
        'role',
      ]);
    }
    expect(body.items.map((i) => i.id)).toEqual([INV_B, INV_A]);
    expect(body.items[0]).toMatchObject({
      organization_id: ORG_B,
      organization_name: 'Beta Trading',
      role: 'DRIVER',
    });
    expect(body.items[1]).toMatchObject({ organization_name: 'Alpha Trading', role: 'SELLER' });
  });

  it('never shows another person invitations', async () => {
    const response = await list(OTHER);
    expect(response.status).toBe(200);
    expect(bodyOf<Page>(response).items).toEqual([]);
  });

  it('pages with limit and cursor', async () => {
    const first = bodyOf<Page>(await list(INVITEE, '?status=INVITED&limit=1'));
    expect(first.items.map((i) => i.id)).toEqual([INV_B]);
    expect(first.next_cursor).not.toBeNull();

    const second = bodyOf<Page>(
      await list(INVITEE, `?status=INVITED&limit=1&cursor=${first.next_cursor}`)
    );
    expect(second.items.map((i) => i.id)).toEqual([INV_A]);
    expect(second.next_cursor).toBeNull();
  });

  it.each([['?status=ACTIVE'], [''], ['?status=INVITED&person_id=x']])(
    'refuses the query %j with 400',
    async (query) => {
      const response = await list(INVITEE, query);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
  );

  it('requires authentication', async () => {
    const response = await request(app).get('/api/v1/collaborations?status=INVITED');
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/collaborations/:id/accept', () => {
  it('AC-2 activates the row, bumps scope_version and notifies the owner', async () => {
    const before = await scope(INVITEE);

    const response = await accept(INV_A);

    expect(response.status).toBe(204);
    const stored = await row(INV_A);
    expect(stored).toMatchObject({ status: 'ACTIVE', role: 'SELLER' });
    expect(stored.acceptedAt).not.toBeNull();
    expect(await scope(INVITEE)).toBe(before + 1);

    const notes = await prisma.notification.findMany({ where: { recipientId: OWNER } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      sourceEvent: 'collaboration.accepted',
      organizationId: ORG_A,
      relatedEntityType: 'collaboration',
      relatedEntityId: INV_A,
    });
    expect(await prisma.notification.count({ where: { recipientId: INVITEE } })).toBe(0);
  });

  it('AC-4 a second accept answers 404 and changes nothing', async () => {
    await accept(INV_A);
    const before = await scope(INVITEE);

    const response = await accept(INV_A);

    expect(response.status).toBe(404);
    expect(await scope(INVITEE)).toBe(before);
    expect(await prisma.notification.count({ where: { recipientId: OWNER } })).toBe(1);
  });
});

describe('POST /api/v1/collaborations/:id/decline', () => {
  it('AC-3 revokes the row and leaves scope_version alone', async () => {
    const before = await scope(INVITEE);

    const response = await decline(INV_A);

    expect(response.status).toBe(204);
    const stored = await row(INV_A);
    expect(stored.status).toBe('REVOKED');
    expect(stored.acceptedAt).toBeNull();
    expect(await scope(INVITEE)).toBe(before);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('a declined invitation can be invited again, then no longer listed meanwhile', async () => {
    await decline(INV_A);
    const page = bodyOf<Page>(await list());
    expect(page.items.map((i) => i.id)).toEqual([INV_B]);
  });
});

describe('AC-4 not possible', () => {
  beforeEach(async () => {
    await seedOrg('0199c008-0000-7000-8000-0000000000e1', 'Delta Trading');
    await seedCollab(REVOKED_ID, '0199c008-0000-7000-8000-0000000000e1', INVITEE, 'REVOKED');
    await seedCollab(OTHERS_INV, ORG_A, OTHER, 'INVITED');
  });

  it.each([
    ['an already ACTIVE collaboration', ACTIVE_C],
    ['a REVOKED collaboration', REVOKED_ID],
    ['someone else invitation', OTHERS_INV],
    ['an unknown id', UNKNOWN],
  ])('%s answers 404 NOT_FOUND on accept and decline and changes nothing', async (_l, id) => {
    const snapshot = await prisma.collaboration.findMany({ orderBy: { id: 'asc' } });
    const scopeBefore = await scope(INVITEE);

    for (const call of [accept, decline]) {
      const response = await call(id);
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    }

    expect(await prisma.collaboration.findMany({ orderBy: { id: 'asc' } })).toEqual(snapshot);
    expect(await scope(INVITEE)).toBe(scopeBefore);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('a malformed id answers 400', async () => {
    const response = await accept('not-a-uuid');
    expect(response.status).toBe(400);
  });

  it('requires authentication', async () => {
    const response = await request(app).post(`/api/v1/collaborations/${INV_A}/accept`);
    expect(response.status).toBe(401);
  });
});

describe('security', () => {
  it('AB-1 person A accepting or declining the invitation of B gets 404 and B is unchanged', async () => {
    await seedCollab(OTHERS_INV, ORG_A, OTHER, 'INVITED', 'MANAGER');
    const before = await row(OTHERS_INV);
    const scopeBefore = await scope(OTHER);

    expect((await accept(OTHERS_INV, INVITEE)).status).toBe(404);
    expect((await decline(OTHERS_INV, INVITEE)).status).toBe(404);

    expect(await row(OTHERS_INV)).toEqual(before);
    expect(await scope(OTHER)).toBe(scopeBefore);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AB-2 a body with role OWNER is ignored on accept', async () => {
    const response = await accept(INV_A, INVITEE, { role: 'OWNER', status: 'REVOKED' });

    expect(response.status).toBe(204);
    expect(await row(INV_A)).toMatchObject({ role: 'SELLER', status: 'ACTIVE' });
    expect(
      await prisma.collaboration.count({ where: { organizationId: ORG_A, role: 'OWNER' } })
    ).toBe(1);
  });
});
