import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: vi.fn(() => Promise.resolve({ allowed: true, remaining: 59 })),
}));

import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

type LookupBody = { items: Array<Record<string, unknown>> };

const CALLER = '0199c029-0000-7000-8000-000000000001';
const OWNER = '0199c029-0000-7000-8000-000000000002';
const REG = new Date('2026-01-01T00:00:00.000Z');
const NUMBER = '+237677129029';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `0199c029-${prefix}-7000-8000-${String(counter).padStart(12, '0')}`;
}

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

/** Creates an organization with its ACTIVE OWNER (the owner rule is checked at commit). */
async function seedOrg(
  name: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' = 'ACTIVE',
  description: string | null = 'About us',
  extra: { createdAt?: Date } = {}
) {
  return prisma.organization.create({
    data: {
      id: nextId('0001'),
      name,
      description,
      status,
      ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
      collaborations: {
        create: {
          id: nextId('0002'),
          personId: OWNER,
          role: 'OWNER',
          status: 'ACTIVE',
          acceptedAt: REG,
        },
      },
    },
  });
}

function seedContact(
  organizationId: string,
  opts: {
    kind?: 'PHONE' | 'EMAIL';
    value?: string;
    verified?: boolean;
    deleted?: boolean;
    slot?: number;
  } = {}
) {
  const kind = opts.kind ?? 'PHONE';
  return prisma.organizationContact.create({
    data: {
      id: nextId('0003'),
      organizationId,
      kind,
      slot: kind === 'PHONE' ? (opts.slot ?? 1) : null,
      value: opts.value ?? NUMBER,
      createdById: OWNER,
      ...(opts.verified === false ? {} : { verifiedAt: REG, verificationMethod: 'CODE' as const }),
      ...(opts.deleted ? { deletedAt: REG } : {}),
    },
  });
}

function lookup(phone: string) {
  return createAuthenticatedRequest(app, CALLER)
    .get('/api/v1/organizations/lookup')
    .query({ phone });
}

beforeEach(async () => {
  await seedPerson(CALLER, '+237600029001');
  await seedPerson(OWNER, '+237600029002');
});

describe('lookup by verified organization contacts', () => {
  it('lists the business with id, name and description for a verified PHONE contact (AC-1, CM-26)', async () => {
    const org = await seedOrg('Chez Mama');
    await seedContact(org.id);

    const response = await lookup(NUMBER);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [{ id: org.id, name: 'Chez Mama', description: 'About us' }],
    });
  });

  it('finds the business even when no collaborator holds the number (C-44)', async () => {
    const org = await seedOrg('No flag', 'ACTIVE', null);
    await seedContact(org.id);

    const response = await lookup(NUMBER);

    expect(bodyOf<LookupBody>(response).items.map((i) => i.id)).toEqual([org.id]);
  });

  it.each([
    ['a PHONE contact not yet verified', 'ACTIVE', { verified: false }],
    ['a deleted PHONE contact', 'ACTIVE', { deleted: true }],
    ['a SUSPENDED business', 'SUSPENDED', {}],
    ['a CLOSED business', 'CLOSED', {}],
  ] as const)('answers an empty list for %s (AC-2, C-44)', async (_label, status, contact) => {
    const org = await seedOrg('Hidden', status);
    await seedContact(org.id, contact);

    const response = await lookup(NUMBER);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });

  it('answers an empty list for an EMAIL contact whose value equals the number (AC-2)', async () => {
    const org = await seedOrg('Email only');
    await seedContact(org.id, { kind: 'EMAIL', value: NUMBER });

    const response = await lookup(NUMBER);

    expect(response.body).toEqual({ items: [] });
  });

  it('answers an empty list for an owner whose own number matches (AC-2)', async () => {
    await seedOrg('Owner number', 'ACTIVE', 'About us');

    const response = await lookup('+237600029002');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
  });

  it('lists two businesses holding the same verified number, newest first (AC-3)', async () => {
    const older = await seedOrg('Older', 'ACTIVE', 'About us', {
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const newer = await seedOrg('Newer', 'ACTIVE', null, {
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    await seedContact(older.id);
    await seedContact(newer.id);

    const response = await lookup(NUMBER);

    expect(bodyOf<LookupBody>(response).items).toEqual([
      { id: newer.id, name: 'Newer', description: null },
      { id: older.id, name: 'Older', description: 'About us' },
    ]);
  });

  it('does not list a business whose number was added but never proven (AB-1, CWE-290)', async () => {
    const org = await seedOrg('Spoofer');
    await seedContact(org.id, { verified: false });

    const response = await lookup(NUMBER);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
    expect(JSON.stringify(response.body)).not.toContain(org.id);
  });

  it('lists a business once when it holds the number in two verified slots', async () => {
    const org = await seedOrg('Twice');
    await seedContact(org.id, { slot: 1 });
    await seedContact(org.id, { slot: 2, value: '+237677129030' });

    const response = await lookup(NUMBER);

    expect(bodyOf<LookupBody>(response).items).toHaveLength(1);
  });

  it('still answers 400 for a missing number', async () => {
    const response = await createAuthenticatedRequest(app, CALLER).get(
      '/api/v1/organizations/lookup'
    );

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });
});
