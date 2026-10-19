import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const PERSON_ID = '0199c004-0000-7000-8000-000000000001';
const GUEST_ID = '0199c004-0000-7000-8000-000000000002';
const UUID_V4 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

type Created = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  role: string;
  payment_code: string;
  plan: string;
  plan_ends_at: string | null;
  grace_ends_at: string | null;
  max_collaborators: number | null;
  max_products: number | null;
};

const VIEW_KEYS = [
  'created_at',
  'description',
  'grace_ends_at',
  'id',
  'max_collaborators',
  'max_products',
  'name',
  'payment_code',
  'plan',
  'plan_ends_at',
  'role',
  'status',
];

async function seedPeople() {
  await prisma.person.create({
    data: {
      id: PERSON_ID,
      fullName: 'Org Creator',
      phoneNumber: '+237600004001',
      phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      passwordHash: 'test-password-hash',
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  await prisma.person.create({
    data: { id: GUEST_ID, phoneNumber: '+237600004002' },
  });
}

function post(body: unknown, personId = PERSON_ID) {
  return createAuthenticatedRequest(app, personId).post('/api/v1/organizations').send(body as object);
}

describe('POST /api/v1/organizations', () => {
  beforeEach(seedPeople);

  it('creates the organization and the caller OWNER collaboration', async () => {
    const id = newId();
    const response = await post({ id, name: 'Chez Mama', description: 'Boissons' });

    expect(response.status).toBe(201);
    const body = bodyOf<Created>(response);
    expect(Object.keys(body).sort()).toEqual(VIEW_KEYS);
    expect(body).toMatchObject({
      id,
      name: 'Chez Mama',
      description: 'Boissons',
      status: 'ACTIVE',
      role: 'OWNER',
    });
    expect(Number.isNaN(Date.parse(body.created_at))).toBe(false);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id } });
    expect(org.status).toBe('ACTIVE');
    const collabs = await prisma.collaboration.findMany({ where: { organizationId: id } });
    expect(collabs).toHaveLength(1);
    expect(collabs[0]).toMatchObject({
      personId: PERSON_ID,
      role: 'OWNER',
      status: 'ACTIVE',
      isPublicContact: true,
    });
    expect(collabs[0].acceptedAt).not.toBeNull();
  });

  it('returns a null description when omitted', async () => {
    const response = await post({ id: newId(), name: 'Minimal' });

    expect(response.status).toBe(201);
    expect(bodyOf<Created>(response)).toMatchObject({ description: null });
  });

  it('increases the caller scope_version by 1', async () => {
    const before = await prisma.person.findUniqueOrThrow({ where: { id: PERSON_ID } });

    const response = await post({ id: newId(), name: 'Scope' });

    expect(response.status).toBe(201);
    const after = await prisma.person.findUniqueOrThrow({ where: { id: PERSON_ID } });
    expect(after.scopeVersion).toBe(before.scopeVersion + 1);
  });

  describe('limits', () => {
    const cases: Array<[string, () => Record<string, unknown>, number]> = [
      ['name empty', () => ({ id: newId(), name: '' }), 400],
      ['name 100 chars', () => ({ id: newId(), name: 'a'.repeat(100) }), 201],
      ['name 101 chars', () => ({ id: newId(), name: 'a'.repeat(101) }), 400],
      ['description 2000 chars', () => ({ id: newId(), name: 'n', description: 'd'.repeat(2000) }), 201],
      ['description 2001 chars', () => ({ id: newId(), name: 'n', description: 'd'.repeat(2001) }), 400],
      ['email unknown field', () => ({ id: newId(), name: 'n', email: 'a@b.cm' }), 400],
      ['id a UUIDv4', () => ({ id: UUID_V4, name: 'n' }), 400],
      ['id missing', () => ({ name: 'n' }), 400],
    ];

    it.each(cases)('%s -> %i', async (_label, body, status) => {
      const response = await post(body());
      expect(response.status).toBe(status);
      if (status === 400) {
        expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
        expect(await prisma.organization.count()).toBe(0);
      }
    });

    it('does not consume the id of an invalid request', async () => {
      const id = newId();
      const invalid = await post({ id, name: '' });
      const valid = await post({ id, name: 'Fixed' });

      expect(invalid.status).toBe(400);
      expect(valid.status).toBe(201);
    });
  });

  it('creates one organization and returns equal responses for a repeat', async () => {
    const body = { id: newId(), name: 'Twice' };

    const first = await post(body);
    const second = await post(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.collaboration.count()).toBe(1);
    const person = await prisma.person.findUniqueOrThrow({ where: { id: PERSON_ID } });
    expect(person.scopeVersion).toBe(1);
  });

  it('leaves no organization when the collaboration insert fails', async () => {
    // An unregistered person cannot hold an ACTIVE collaboration (C-05), so the insert fails.
    const response = await post({ id: newId(), name: 'Ghost' }, GUEST_ID);

    expect(response.status).toBe(500);
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.collaboration.count()).toBe(0);
    const guest = await prisma.person.findUniqueOrThrow({ where: { id: GUEST_ID } });
    expect(guest.scopeVersion).toBe(0);
  });

  describe('security', () => {
    it.each(['status', 'role', 'owner', 'person_id'])('rejects %s in the body', async (field) => {
      const response = await post({ id: newId(), name: 'Mass', [field]: 'OWNER' });

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.organization.count()).toBe(0);
      expect(await prisma.collaboration.count()).toBe(0);
    });

    it('answers 401 without a token', async () => {
      const response = await request(app)
        .post('/api/v1/organizations')
        .send({ id: newId(), name: 'No token' });

      expect(response.status).toBe(401);
      expect(await prisma.organization.count()).toBe(0);
    });

    it('answers 401 with an invalid token', async () => {
      const response = await request(app)
        .post('/api/v1/organizations')
        .set('Authorization', 'Bearer invalid.token.here')
        .send({ id: newId(), name: 'Bad token' });

      expect(response.status).toBe(401);
    });
  });
});
