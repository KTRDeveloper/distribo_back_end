import { beforeEach, describe, expect, it, vi } from 'vitest';

const limiter = vi.hoisted(() => ({ counts: new Map<string, number>(), keys: [] as string[] }));

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: vi.fn((key: string, limit: number) => {
    limiter.keys.push(key);
    const count = (limiter.counts.get(key) ?? 0) + 1;
    limiter.counts.set(key, count);
    return Promise.resolve({ allowed: count <= limit, remaining: Math.max(limit - count, 0) });
  }),
}));

import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

type LookupBody = { items: Array<Record<string, unknown>> };

const CALLER = '0199c018-0000-7000-8000-000000000001';
const OWNER = '0199c018-0000-7000-8000-000000000002';
const SECOND = '0199c018-0000-7000-8000-000000000003';
const REG = new Date('2026-01-01T00:00:00.000Z');
const PHONE = '+237677123456';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `0199c018-${prefix}-7000-8000-${String(counter).padStart(12, '0')}`;
}

async function seedPerson(id: string, phone: string | null) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      releasedPhoneNumber: phone === null ? '+237600018099' : null,
      ...(phone !== null ? { phoneVerifiedAt: REG } : {}),
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

/** Creates an organization with its ACTIVE OWNER in one statement (the owner rule is checked at commit). */
async function seedOrg(
  name: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' = 'ACTIVE',
  description: string | null = 'About us',
  ownerId = SECOND
) {
  return prisma.organization.create({
    data: {
      id: nextId('0001'),
      name,
      description,
      status,
      collaborations: {
        create: {
          id: nextId('0002'),
          personId: ownerId,
          role: 'OWNER',
          status: 'ACTIVE',
          acceptedAt: REG,
        },
      },
    },
  });
}

/** Gives the organization a verified PHONE contact (or another state) holding the number. */
async function seedContact(
  organizationId: string,
  opts: { verified?: boolean; deleted?: boolean; value?: string; slot?: number } = {}
) {
  return prisma.organizationContact.create({
    data: {
      id: nextId('0003'),
      organizationId,
      kind: 'PHONE',
      slot: opts.slot ?? 1,
      value: opts.value ?? PHONE,
      createdById: SECOND,
      ...(opts.verified === false ? {} : { verifiedAt: REG, verificationMethod: 'CODE' as const }),
      ...(opts.deleted ? { deletedAt: REG } : {}),
    },
  });
}

async function seedCollaboration(
  personId: string,
  organizationId: string,
  status: 'ACTIVE' | 'INVITED' | 'REVOKED',
  role: 'OWNER' | 'MANAGER' = 'MANAGER'
) {
  return prisma.collaboration.create({
    data: {
      id: nextId('0002'),
      personId,
      organizationId,
      role,
      status,
      acceptedAt: status === 'ACTIVE' ? REG : null,
    },
  });
}

function lookup(phone: string, personId = CALLER) {
  return createAuthenticatedRequest(app, personId)
    .get('/api/v1/organizations/lookup')
    .query({ phone });
}

beforeEach(async () => {
  limiter.counts.clear();
  limiter.keys.length = 0;
  await seedPerson(CALLER, '+237600018001');
  await seedPerson(OWNER, PHONE);
  await seedPerson(SECOND, '+237600018003');
});

describe('GET /api/v1/organizations/lookup', () => {
  it('lists the organization with id, name and description only (AC-1, CM-26)', async () => {
    const org = await seedOrg('Chez Mama', 'ACTIVE', 'About us', OWNER);
    await seedContact(org.id);

    const response = await lookup('6 77 12 34 56');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [{ id: org.id, name: 'Chez Mama', description: 'About us' }],
    });
    expect(limiter.keys).toEqual([`lookup:${CALLER}`]);
  });

  it('answers 200 with an empty list when the contact is not verified (AC-2)', async () => {
    const org = await seedOrg('Pending contact');
    await seedContact(org.id, { verified: false });

    const response = await lookup(PHONE);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });

  it.each(['INVITED', 'REVOKED'] as const)(
    'answers an empty list for a %s collaborator holding the number without a contact (AC-2)',
    async (status) => {
      const org = await seedOrg('Not active');
      await seedCollaboration(OWNER, org.id, status);

      const response = await lookup(PHONE);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ items: [] });
    }
  );

  it.each(['CLOSED', 'SUSPENDED'] as const)(
    'answers an empty list for a %s organization (AC-2)',
    async (status) => {
      const org = await seedOrg('Not open', status);
      await seedContact(org.id);

      const response = await lookup(PHONE);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ items: [] });
    }
  );

  it('answers an empty list for a private person who is not a collaborator (AC-2)', async () => {
    const response = await lookup(PHONE);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });

  it('answers an empty list for an unknown number (AC-2)', async () => {
    const response = await lookup('+237699999999');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });

  it('lists both organizations of one public contact (AC-3)', async () => {
    const first = await seedOrg('First', 'ACTIVE', 'About us', OWNER);
    const second = await seedOrg('Second', 'ACTIVE', null, OWNER);
    await seedContact(first.id);
    await seedContact(second.id);

    const response = await lookup(PHONE);

    expect(response.status).toBe(200);
    const items = bodyOf<LookupBody>(response).items;
    expect(items.map((i) => i.id).sort()).toEqual([first.id, second.id].sort());
    expect(items.find((i) => i.id === second.id)).toEqual({
      id: second.id,
      name: 'Second',
      description: null,
    });
  });

  it('answers 429 RATE_LIMITED on the 61st lookup shared with people lookups (AC-4, AB-2)', async () => {
    limiter.counts.set(`lookup:${CALLER}`, 59);

    const sixtieth = await lookup(PHONE);
    const sixtyFirst = await lookup(PHONE);

    expect(sixtieth.status).toBe(200);
    expect(sixtyFirst.status).toBe(429);
    expect(bodyOf<ErrorBody>(sixtyFirst).error.code).toBe('RATE_LIMITED');
  });

  it('exposes no collaborator data (AB-3)', async () => {
    const org = await seedOrg('Chez Mama', 'ACTIVE', 'About us', OWNER);
    await seedContact(org.id);

    const response = await lookup(PHONE);
    const serialized = JSON.stringify(response.body);

    expect(Object.keys(bodyOf<LookupBody>(response).items[0] ?? {}).sort()).toEqual([
      'description',
      'id',
      'name',
    ]);
    expect(serialized).not.toContain(OWNER);
    expect(serialized).not.toContain('Fixture Person');
    expect(serialized).not.toContain('OWNER');
    expect(serialized).not.toContain(PHONE);
  });

  it('refuses an invalid or missing number with 400 VALIDATION_ERROR', async () => {
    const response = await createAuthenticatedRequest(app, CALLER).get(
      '/api/v1/organizations/lookup'
    );

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses unknown query fields with 400', async () => {
    const response = await createAuthenticatedRequest(app, CALLER)
      .get('/api/v1/organizations/lookup')
      .query({ phone: PHONE, extra: '1' });

    expect(response.status).toBe(400);
  });

  it('answers 401 without a token', async () => {
    const { default: request } = await import('supertest');
    const response = await request(app).get('/api/v1/organizations/lookup').query({ phone: PHONE });

    expect(response.status).toBe(401);
  });
});
