import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const failure = vi.hoisted(() => ({ counterInsert: false }));

vi.mock('../../../src/modules/relationship/relationship.repository.js', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('../../../src/modules/relationship/relationship.repository.js')
  >();
  return {
    ...original,
    createCounter: (...args: Parameters<typeof original.createCounter>) => {
      if (failure.counterInsert) return Promise.reject(new Error('forced counter failure'));
      return original.createCounter(...args);
    },
  };
});

const PERSON_ID = '0199c006-0000-7000-8000-000000000001';

function post(body: unknown) {
  return createAuthenticatedRequest(app, PERSON_ID)
    .post('/api/v1/organizations')
    .send(body as object);
}

describe('default counter of a new organization', () => {
  beforeEach(async () => {
    failure.counterInsert = false;
    await prisma.person.create({
      data: {
        id: PERSON_ID,
        fullName: 'Counter Owner',
        phoneNumber: '+237600006001',
        phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        passwordHash: 'test-password-hash',
        registeredAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  });

  it('creates exactly one counter with the stated values', async () => {
    const id = newId();
    const response = await post({ id, name: 'Chez Mama' });

    expect(response.status).toBe(201);
    const rows = await prisma.customerRelationship.findMany({
      where: { supplierOrganizationId: id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      supplierPersonId: null,
      customerPersonId: null,
      customerOrganizationId: null,
      customerPhoneNumber: null,
      customerLabel: 'Client de passage',
      creditLimit: 0n,
      status: 'ACTIVE',
      createdById: PERSON_ID,
    });
    expect(await prisma.creditLimitChange.count()).toBe(0);
  });

  it('stores nothing when the counter insert fails', async () => {
    failure.counterInsert = true;

    const response = await post({ id: newId(), name: 'Doomed' });

    expect(response.status).toBe(500);
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.collaboration.count()).toBe(0);
    expect(await prisma.customerRelationship.count()).toBe(0);
    const person = await prisma.person.findUniqueOrThrow({ where: { id: PERSON_ID } });
    expect(person.scopeVersion).toBe(0);
  });

  it('keeps the response shape unchanged', async () => {
    const response = await post({ id: newId(), name: 'Shape', description: 'D', email: 'a@b.cm' });

    expect(response.status).toBe(201);
    expect(Object.keys(response.body as object).sort()).toEqual(
      ['created_at', 'description', 'email', 'id', 'name', 'role', 'status'].sort()
    );
  });

  it('creates one counter when the same body is posted twice', async () => {
    const body = { id: newId(), name: 'Twice' };

    const first = await post(body);
    const second = await post(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await prisma.customerRelationship.count()).toBe(1);
  });
});
