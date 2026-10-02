import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const createdPersonIds: string[] = [];
let phoneSequence = 0;

async function createRegisteredPerson(
  overrides: Partial<{
    fullName: string;
    email: string | null;
    emailVerifiedAt: Date | null;
    preferredLanguage: 'FR' | 'EN';
  }> = {}
) {
  const id = uuidv7();
  phoneSequence += 1;
  const person = await prisma.person.create({
    data: {
      id,
      fullName: 'Profile Test Person',
      phoneNumber: `+2250101${phoneSequence.toString().padStart(6, '0')}`,
      phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      passwordHash: 'test-password-hash',
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
      preferredLanguage: 'FR',
      ...overrides,
    },
  });
  createdPersonIds.push(id);
  return person;
}

beforeEach(() => {
  createdPersonIds.length = 0;
});

afterEach(async () => {
  if (createdPersonIds.length > 0) {
    await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  }
});

describe('person profile', () => {
  it('returns the signed-in person using only the explicit public profile fields', async () => {
    const person = await createRegisteredPerson({
      email: 'profile.read@example.test',
      emailVerifiedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    const response = await createAuthenticatedRequest(app, person.id).get('/api/v1/users/me');

    expect(response.status).toBe(200);
    const body = bodyOf<Record<string, unknown>>(response);
    expect(Object.keys(body).sort()).toEqual(
      [
        'created_at',
        'email',
        'email_verified',
        'full_name',
        'id',
        'phone_number',
        'phone_verified',
        'preferred_language',
        'registered',
        'scope_version',
      ].sort()
    );
    expect(body).toMatchObject({
      id: person.id,
      full_name: 'Profile Test Person',
      phone_number: person.phoneNumber,
      phone_verified: true,
      email: 'profile.read@example.test',
      email_verified: true,
      preferred_language: 'FR',
      registered: true,
      scope_version: 0,
    });
    expect(body).not.toHaveProperty('password_hash');
  });

  it('updates the signed-in person name and preferred language', async () => {
    const person = await createRegisteredPerson();

    const response = await createAuthenticatedRequest(app, person.id)
      .patch('/api/v1/users/me')
      .send({
        full_name: 'Béatrice N.',
        preferred_language: 'EN',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: person.id,
      full_name: 'Béatrice N.',
      preferred_language: 'EN',
    });
    await expect(
      prisma.person.findUniqueOrThrow({ where: { id: person.id } })
    ).resolves.toMatchObject({
      fullName: 'Béatrice N.',
      preferredLanguage: 'EN',
    });
  });

  it('resets email verification when the email changes or is cleared', async () => {
    const person = await createRegisteredPerson({
      email: 'verified@example.test',
      emailVerifiedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    const changed = await createAuthenticatedRequest(app, person.id)
      .patch('/api/v1/users/me')
      .send({
        email: 'changed@example.test',
      });

    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ email: 'changed@example.test', email_verified: false });
    await expect(
      prisma.person.findUniqueOrThrow({ where: { id: person.id } })
    ).resolves.toMatchObject({
      email: 'changed@example.test',
      emailVerifiedAt: null,
    });

    const cleared = await createAuthenticatedRequest(app, person.id)
      .patch('/api/v1/users/me')
      .send({
        email: null,
      });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ email: null, email_verified: false });
  });

  it.each([
    ['empty full name', { full_name: '' }, 400],
    ['100-character full name', { full_name: 'a'.repeat(100) }, 200],
    ['101-character full name', { full_name: 'a'.repeat(101) }, 400],
    ['unsupported language', { preferred_language: 'ES' }, 400],
    ['invalid email', { email: 'not-an-email' }, 400],
  ])('enforces the profile limit for %s', async (_label, body, expectedStatus) => {
    const person = await createRegisteredPerson();

    const response = await createAuthenticatedRequest(app, person.id)
      .patch('/api/v1/users/me')
      .send(body);

    expect(response.status).toBe(expectedStatus);
  });

  it('rejects server-owned fields without storing any part of the request', async () => {
    const person = await createRegisteredPerson();

    const response = await createAuthenticatedRequest(app, person.id)
      .patch('/api/v1/users/me')
      .send({
        full_name: 'Should Not Be Stored',
        phone_number: '+2250101010101',
        status: 'ANONYMIZED',
        scope_version: 99,
        registered_at: null,
        password_hash: 'replacement',
      });

    expect(response.status).toBe(400);
    await expect(
      prisma.person.findUniqueOrThrow({ where: { id: person.id } })
    ).resolves.toMatchObject({
      fullName: 'Profile Test Person',
      scopeVersion: 0,
      passwordHash: 'test-password-hash',
    });
  });

  it("rejects another person's id without changing either profile", async () => {
    const person = await createRegisteredPerson();
    const other = await createRegisteredPerson({ fullName: 'Other Person' });

    const response = await createAuthenticatedRequest(app, person.id)
      .patch('/api/v1/users/me')
      .send({
        id: other.id,
        full_name: 'Changed Other Person',
      });

    expect(response.status).toBe(400);
    await expect(
      prisma.person.findUniqueOrThrow({ where: { id: person.id } })
    ).resolves.toMatchObject({
      fullName: 'Profile Test Person',
    });
    await expect(
      prisma.person.findUniqueOrThrow({ where: { id: other.id } })
    ).resolves.toMatchObject({
      fullName: 'Other Person',
    });
  });

  it('rejects a request without an access token', async () => {
    const response = await request(app).get('/api/v1/users/me');

    expect(response.status).toBe(401);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
  });
});
