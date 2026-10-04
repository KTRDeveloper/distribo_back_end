import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { errorHandler } from '../../../src/middleware/error-handler.js';
import {
  assertOrganizationActive,
  getActiveCollaboration,
  loadActor,
} from '../../../src/middleware/load-actor.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const ME = '0199c005-0000-7000-8000-000000000001';
const OTHER_OWNER = '0199c005-0000-7000-8000-000000000002';
const STRANGER = '0199c005-0000-7000-8000-000000000003';

const ORG_A = '0199c005-0000-7000-8000-0000000000a1';
const ORG_B = '0199c005-0000-7000-8000-0000000000b1';
const ORG_C = '0199c005-0000-7000-8000-0000000000c1';
const ORG_D = '0199c005-0000-7000-8000-0000000000d1';
const ORG_E = '0199c005-0000-7000-8000-0000000000e1';
const UNKNOWN = '0199c005-0000-7000-8000-0000000000ff';

type Status = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
type Role = 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER';
type CollabStatus = 'ACTIVE' | 'INVITED' | 'REVOKED';

type Detail = {
  id: string;
  name: string;
  description: string | null;
  email: string | null;
  status: string;
  created_at: string;
  role: string;
};
type Page = {
  items: { id: string; name: string; status: string; role: string }[];
  next_cursor: string | null;
};

const REGISTERED = new Date('2026-01-01T00:00:00.000Z');

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REGISTERED,
      passwordHash: 'test-password-hash',
      registeredAt: REGISTERED,
    },
  });
}

/** Creates an organization with its owner, plus an optional membership for `ME`. */
async function seedOrg(opts: {
  id: string;
  name: string;
  createdAt: string;
  status?: Status;
  ownerId?: string;
  mine?: { role: Role; status: CollabStatus };
}) {
  const ownerId = opts.ownerId ?? OTHER_OWNER;
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({
      data: {
        id: opts.id,
        name: opts.name,
        description: 'About ' + opts.name,
        email: 'org@example.cm',
        status: opts.status ?? 'ACTIVE',
        createdAt: new Date(opts.createdAt),
      },
    });
    await tx.collaboration.create({
      data: {
        id: opts.id.replace(/.$/, '9'),
        personId: ownerId,
        organizationId: opts.id,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REGISTERED,
      },
    });
    if (opts.mine) {
      await tx.collaboration.create({
        data: {
          id: opts.id.replace(/.$/, '8'),
          personId: ME,
          organizationId: opts.id,
          role: opts.mine.role,
          status: opts.mine.status,
          acceptedAt: opts.mine.status === 'ACTIVE' ? REGISTERED : null,
        },
      });
    }
  });
}

const get = (url: string, personId = ME) => createAuthenticatedRequest(app, personId).get(url);

beforeEach(async () => {
  await seedPerson(ME, '+237600005001');
  await seedPerson(OTHER_OWNER, '+237600005002');
  await seedPerson(STRANGER, '+237600005003');
});

describe('GET /api/v1/organizations', () => {
  it('lists only my ACTIVE collaborations, newest first, with roles', async () => {
    await seedOrg({
      id: ORG_A,
      name: 'Old',
      createdAt: '2026-02-01T00:00:00.000Z',
      mine: { role: 'SELLER', status: 'ACTIVE' },
    });
    await seedOrg({
      id: ORG_B,
      name: 'New',
      createdAt: '2026-03-01T00:00:00.000Z',
      status: 'SUSPENDED',
      mine: { role: 'MANAGER', status: 'ACTIVE' },
    });
    await seedOrg({
      id: ORG_C,
      name: 'Invited',
      createdAt: '2026-04-01T00:00:00.000Z',
      mine: { role: 'DRIVER', status: 'INVITED' },
    });
    await seedOrg({
      id: ORG_D,
      name: 'Revoked',
      createdAt: '2026-05-01T00:00:00.000Z',
      mine: { role: 'DRIVER', status: 'REVOKED' },
    });
    await seedOrg({ id: ORG_E, name: 'Not mine', createdAt: '2026-06-01T00:00:00.000Z' });

    const response = await get('/api/v1/organizations');

    expect(response.status).toBe(200);
    const body = bodyOf<Page>(response);
    expect(body.items).toEqual([
      { id: ORG_B, name: 'New', status: 'SUSPENDED', role: 'MANAGER' },
      { id: ORG_A, name: 'Old', status: 'ACTIVE', role: 'SELLER' },
    ]);
    expect(body.next_cursor).toBeNull();
  });

  it('pages with limit and cursor', async () => {
    await seedOrg({
      id: ORG_A,
      name: 'One',
      createdAt: '2026-02-01T00:00:00.000Z',
      mine: { role: 'SELLER', status: 'ACTIVE' },
    });
    await seedOrg({
      id: ORG_B,
      name: 'Two',
      createdAt: '2026-03-01T00:00:00.000Z',
      mine: { role: 'SELLER', status: 'ACTIVE' },
    });

    const first = bodyOf<Page>(await get('/api/v1/organizations?limit=1'));
    expect(first.items.map((i) => i.id)).toEqual([ORG_B]);
    expect(first.next_cursor).not.toBeNull();

    const second = bodyOf<Page>(
      await get(`/api/v1/organizations?limit=1&cursor=${first.next_cursor}`)
    );
    expect(second.items.map((i) => i.id)).toEqual([ORG_A]);
    expect(second.next_cursor).toBeNull();
  });

  it('rejects unknown query parameters', async () => {
    const response = await get('/api/v1/organizations?foo=bar');
    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/v1/organizations');
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/organizations/:organizationId', () => {
  it('returns the seven fields and my role to a member', async () => {
    await seedOrg({
      id: ORG_A,
      name: 'Chez Mama',
      createdAt: '2026-02-01T00:00:00.000Z',
      mine: { role: 'MANAGER', status: 'ACTIVE' },
    });

    const response = await get(`/api/v1/organizations/${ORG_A}`);

    expect(response.status).toBe(200);
    const body = bodyOf<Detail>(response);
    expect(Object.keys(body).sort()).toEqual(
      ['created_at', 'description', 'email', 'id', 'name', 'role', 'status'].sort()
    );
    expect(body).toEqual({
      id: ORG_A,
      name: 'Chez Mama',
      description: 'About Chez Mama',
      email: 'org@example.cm',
      status: 'ACTIVE',
      created_at: '2026-02-01T00:00:00.000Z',
      role: 'MANAGER',
    });
  });

  it.each([
    ['not a collaborator', undefined],
    ['INVITED only', { role: 'SELLER', status: 'INVITED' }],
    ['REVOKED', { role: 'SELLER', status: 'REVOKED' }],
  ] as const)('answers 404 NOT_FOUND when the caller is %s', async (_label, mine) => {
    await seedOrg({
      id: ORG_A,
      name: 'Private',
      createdAt: '2026-02-01T00:00:00.000Z',
      ...(mine ? { mine: { role: mine.role, status: mine.status } } : {}),
    });

    const response = await get(`/api/v1/organizations/${ORG_A}`);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('answers 404 NOT_FOUND for an unknown id', async () => {
    const unknown = await get(`/api/v1/organizations/${UNKNOWN}`);
    expect(unknown.status).toBe(404);
    expect(bodyOf<ErrorBody>(unknown).error.code).toBe('NOT_FOUND');
  });

  it('answers 400 VALIDATION_ERROR for a malformed id', async () => {
    const malformed = await get('/api/v1/organizations/not-a-uuid');
    expect(malformed.status).toBe(400);
    expect(bodyOf<ErrorBody>(malformed).error.code).toBe('VALIDATION_ERROR');
  });

  it('never returns another business to a member of a different one (AB-1)', async () => {
    await seedOrg({
      id: ORG_A,
      name: 'Mine',
      createdAt: '2026-02-01T00:00:00.000Z',
      mine: { role: 'SELLER', status: 'ACTIVE' },
    });
    await seedOrg({ id: ORG_B, name: 'Secret Business B', createdAt: '2026-03-01T00:00:00.000Z' });

    const response = await get(`/api/v1/organizations/${ORG_B}`);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('Secret Business B');
  });
});

describe('loadActor', () => {
  function actorApp() {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      req.user = { id: String(req.headers['x-test-person']), deviceId: 'device' };
      next();
    });
    testApp.post('/orgs/:organizationId/probe', loadActor, (req, res) => {
      res.json({ actor: req.actor });
    });
    testApp.use(errorHandler);
    return testApp;
  }

  it('sets req.actor from the ACTIVE collaboration of the path organization', async () => {
    await seedOrg({
      id: ORG_A,
      name: 'A',
      createdAt: '2026-02-01T00:00:00.000Z',
      mine: { role: 'SELLER', status: 'ACTIVE' },
    });

    const response = await request(actorApp())
      .post(`/orgs/${ORG_A}/probe`)
      .set('x-test-person', ME)
      .send({});

    expect(response.status).toBe(200);
    expect(bodyOf<{ actor: unknown }>(response).actor).toEqual({
      personId: ME,
      organizationId: ORG_A,
      role: 'SELLER',
    });
  });

  it('takes the organization from the path only, never from the body or a header (AB-2)', async () => {
    await seedOrg({
      id: ORG_A,
      name: 'A',
      createdAt: '2026-02-01T00:00:00.000Z',
      mine: { role: 'SELLER', status: 'ACTIVE' },
    });
    await seedOrg({ id: ORG_B, name: 'B', createdAt: '2026-03-01T00:00:00.000Z' });

    const tampered = await request(actorApp())
      .post(`/orgs/${ORG_A}/probe`)
      .set('x-test-person', ME)
      .set('x-organization-id', ORG_B)
      .send({ organizationId: ORG_B, organization_id: ORG_B });
    expect(bodyOf<{ actor: { organizationId: string } }>(tampered).actor.organizationId).toBe(ORG_A);

    const foreign = await request(actorApp())
      .post(`/orgs/${ORG_B}/probe`)
      .set('x-test-person', ME)
      .send({ organizationId: ORG_A });
    expect(foreign.status).toBe(404);
    expect(bodyOf<ErrorBody>(foreign).error.code).toBe('NOT_FOUND');
  });

  it('answers 401 UNAUTHORIZED when no person is authenticated', async () => {
    const bare = express();
    bare.get('/orgs/:organizationId', loadActor, (_req, res) => {
      res.json({});
    });
    bare.use(errorHandler);

    const response = await request(bare).get(`/orgs/${ORG_A}`);
    expect(response.status).toBe(401);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
  });
});

describe('getActiveCollaboration', () => {
  it('returns the ACTIVE collaboration and null for any other state', async () => {
    await seedOrg({
      id: ORG_A,
      name: 'A',
      createdAt: '2026-02-01T00:00:00.000Z',
      mine: { role: 'DRIVER', status: 'ACTIVE' },
    });
    await seedOrg({
      id: ORG_B,
      name: 'B',
      createdAt: '2026-03-01T00:00:00.000Z',
      mine: { role: 'DRIVER', status: 'INVITED' },
    });

    expect(await getActiveCollaboration(ME, ORG_A)).toMatchObject({
      personId: ME,
      organizationId: ORG_A,
      role: 'DRIVER',
    });
    expect(await getActiveCollaboration(ME, ORG_B)).toBeNull();
    expect(await getActiveCollaboration(STRANGER, ORG_A)).toBeNull();
    expect(await getActiveCollaboration(ME, UNKNOWN)).toBeNull();
  });
});

describe('assertOrganizationActive', () => {
  it('passes for ACTIVE and throws ORGANIZATION_NOT_ACTIVE (409) for SUSPENDED and CLOSED', async () => {
    await seedOrg({ id: ORG_A, name: 'A', createdAt: '2026-02-01T00:00:00.000Z' });
    await seedOrg({
      id: ORG_B,
      name: 'B',
      createdAt: '2026-02-02T00:00:00.000Z',
      status: 'SUSPENDED',
    });
    await seedOrg({
      id: ORG_C,
      name: 'C',
      createdAt: '2026-02-03T00:00:00.000Z',
      status: 'CLOSED',
    });

    await expect(assertOrganizationActive(ORG_A)).resolves.toBeUndefined();
    for (const id of [ORG_B, ORG_C]) {
      await expect(assertOrganizationActive(id)).rejects.toMatchObject({
        statusCode: 409,
        code: 'ORGANIZATION_NOT_ACTIVE',
      });
    }
  });

  it('accepts a transaction client and fails closed on an unknown organization', async () => {
    await seedOrg({ id: ORG_A, name: 'A', createdAt: '2026-02-01T00:00:00.000Z' });

    await prisma.$transaction(async (tx) => {
      await expect(assertOrganizationActive(ORG_A, tx)).resolves.toBeUndefined();
    });
    await expect(assertOrganizationActive(UNKNOWN)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});
