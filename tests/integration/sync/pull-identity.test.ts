import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { prisma } from '../../setup.js';

const OWNER_A = '0199e003-0000-7000-8000-000000000001';
const SELLER_A = '0199e003-0000-7000-8000-000000000002';
const OWNER_B = '0199e003-0000-7000-8000-000000000003';
const CUSTOMER = '0199e003-0000-7000-8000-000000000004';
const OUTSIDER = '0199e003-0000-7000-8000-000000000005';
const ORG_A = '0199e003-0000-7000-8000-0000000000a1';
const ORG_B = '0199e003-0000-7000-8000-0000000000b1';
const COLLAB_OWNER_A = '0199e003-0000-7000-8000-0000000000a2';
const COLLAB_SELLER_A = '0199e003-0000-7000-8000-0000000000a3';
const COLLAB_OWNER_B = '0199e003-0000-7000-8000-0000000000b2';
const RELATIONSHIP = '0199e003-0000-7000-8000-0000000000c1';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type Rows = Array<Record<string, unknown>>;
type Changes = { created: Rows; updated: Rows; deleted: string[] };
type PullBody = { changes: Record<string, Changes>; timestamp: number };

const pull = (personId: string, query = '') =>
  createAuthenticatedRequest(app, personId).get(`/api/v1/sync/pull${query}`);

async function seedPerson(id: string, phone: string, name: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: name,
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${name.toLowerCase().replace(/\W/g, '')}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('GET /api/v1/sync/pull (identity tables)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER_A, '+237600000301', 'Owner A');
    await seedPerson(SELLER_A, '+237600000302', 'Seller A');
    await seedPerson(OWNER_B, '+237600000303', 'Owner B');
    await seedPerson(CUSTOMER, '+237600000304', 'Customer');
    await seedPerson(OUTSIDER, '+237600000305', 'Outsider');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await prisma.collaboration.create({
      data: {
        id: COLLAB_OWNER_A,
        personId: OWNER_A,
        organizationId: ORG_A,
        role: 'OWNER',
        status: 'ACTIVE',
        invitedAt: LONG_AGO,
        acceptedAt: LONG_AGO,
        amountHeld: 5000n,
      },
    });
    await prisma.collaboration.create({
      data: {
        id: COLLAB_SELLER_A,
        personId: SELLER_A,
        organizationId: ORG_A,
        role: 'SELLER',
        status: 'ACTIVE',
        invitedAt: LONG_AGO,
        acceptedAt: LONG_AGO,
        amountHeld: 1200n,
      },
    });
    await prisma.collaboration.create({
      data: {
        id: COLLAB_OWNER_B,
        personId: OWNER_B,
        organizationId: ORG_B,
        role: 'OWNER',
        status: 'ACTIVE',
        invitedAt: LONG_AGO,
        acceptedAt: LONG_AGO,
        amountHeld: 9999n,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        id: RELATIONSHIP,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        createdById: SELLER_A,
        createdAt: LONG_AGO,
      },
    });
  });

  it('first pull sends the viewer organization, its team and public people as created (AC-1)', async () => {
    const response = await pull(SELLER_A, '?last_pulled_at=');

    expect(response.status).toBe(200);
    const { changes, timestamp } = bodyOf<PullBody>(response);
    expect(timestamp).toBeGreaterThan(Date.now() - 60_000);
    expect(changes['organizations']?.created.map((r) => r['id'])).toEqual([ORG_A]);
    expect(changes['organizations']?.created[0]).toMatchObject({
      name: 'Org A',
      status: 'ACTIVE',
      created_at: LONG_AGO.getTime(),
    });
    expect(changes['collaborations']?.created.map((r) => r['id']).sort()).toEqual(
      [COLLAB_OWNER_A, COLLAB_SELLER_A].sort()
    );
    expect(changes['people']?.created.map((r) => r['id']).sort()).toEqual(
      [OWNER_A, SELLER_A, CUSTOMER].sort()
    );
    for (const table of ['organizations', 'collaborations', 'people']) {
      expect(changes[table]?.updated).toEqual([]);
      expect(changes[table]?.deleted).toEqual([]);
    }
  });

  it('treats an absent last_pulled_at like an empty one (AC-1)', async () => {
    const response = await pull(SELLER_A);
    expect(response.status).toBe(200);
    expect(bodyOf<PullBody>(response).changes['organizations']?.created).toHaveLength(1);
  });

  it('incremental pull lists only the collaboration whose role changed as updated (AC-2)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER_A));
    await sleep(20);
    await prisma.collaboration.update({
      where: { id: COLLAB_SELLER_A },
      data: { role: 'MANAGER' },
    });

    const response = await pull(SELLER_A, `?last_pulled_at=${first.timestamp}`);

    const { changes } = bodyOf<PullBody>(response);
    expect(changes['collaborations']?.updated).toHaveLength(1);
    expect(changes['collaborations']?.updated[0]).toMatchObject({
      id: COLLAB_SELLER_A,
      role: 'MANAGER',
    });
    expect(changes['collaborations']?.created).toEqual([]);
    expect(changes['organizations']).toEqual({ created: [], updated: [], deleted: [] });
    expect(changes['people']).toEqual({ created: [], updated: [], deleted: [] });
  });

  it('lists a deleted collaboration by id and a row created later as created (AC-2, C-35)', async () => {
    const first = bodyOf<PullBody>(await pull(OWNER_A));
    await sleep(20);
    await prisma.collaboration.update({
      where: { id: COLLAB_SELLER_A },
      data: { deletedAt: new Date() },
    });

    const { changes } = bodyOf<PullBody>(await pull(OWNER_A, `?last_pulled_at=${first.timestamp}`));

    expect(changes['collaborations']?.deleted).toEqual([COLLAB_SELLER_A]);
    expect(changes['collaborations']?.updated).toEqual([]);

    const afterDelete = bodyOf<PullBody>(await pull(OWNER_A));
    expect(afterDelete.changes['collaborations']?.created.map((r) => r['id'])).toEqual([
      COLLAB_OWNER_A,
    ]);
  });

  it('a person who just became visible is sent even if their own row is old (AC-2)', async () => {
    const first = bodyOf<PullBody>(await pull(SELLER_A));
    await sleep(20);
    await prisma.collaboration.create({
      data: {
        id: '0199e003-0000-7000-8000-0000000000a4',
        personId: OUTSIDER,
        organizationId: ORG_A,
        role: 'DRIVER',
        status: 'INVITED',
      },
    });

    const { changes } = bodyOf<PullBody>(
      await pull(SELLER_A, `?last_pulled_at=${first.timestamp}`)
    );

    expect([...(changes['people']?.created ?? []), ...(changes['people']?.updated ?? [])]).toEqual([
      { id: OUTSIDER, full_name: 'Outsider', phone_number: '+237600000305' },
    ]);
  });

  it('shows amount_held to a SELLER only on their own row (AC-3, CM-30)', async () => {
    const { changes } = bodyOf<PullBody>(await pull(SELLER_A));

    const rows = changes['collaborations']?.created ?? [];
    const own = rows.find((r) => r['id'] === COLLAB_SELLER_A);
    const other = rows.find((r) => r['id'] === COLLAB_OWNER_A);
    expect(own?.['amount_held']).toBe(1200);
    expect(other).toBeDefined();
    expect(other).not.toHaveProperty('amount_held');
  });

  it('shows amount_held on every row of the organization to an OWNER (AC-3, CM-30)', async () => {
    const { changes } = bodyOf<PullBody>(await pull(OWNER_A));

    const held: Record<string, unknown> = {};
    for (const r of changes['collaborations']?.created ?? []) {
      held[r['id'] as string] = r['amount_held'];
    }
    expect(held).toEqual({ [COLLAB_OWNER_A]: 5000, [COLLAB_SELLER_A]: 1200 });
  });

  it('never sends rows of an organization the viewer does not belong to (AC-4, AB-1)', async () => {
    const { changes } = bodyOf<PullBody>(await pull(SELLER_A));
    const serialized = JSON.stringify(changes);

    for (const secret of [ORG_B, COLLAB_OWNER_B, OWNER_B, '+237600000303', 'Owner B', '9999']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('a person with no membership receives nothing but themselves (AC-4, AB-1)', async () => {
    const { changes } = bodyOf<PullBody>(await pull(OUTSIDER));

    expect(changes['organizations']?.created).toEqual([]);
    expect(changes['collaborations']?.created).toEqual([]);
    expect(changes['people']?.created.map((r) => r['id'])).toEqual([OUTSIDER]);
  });

  it('sends only id, full_name and phone_number for people (AB-2, CWE-200)', async () => {
    const { changes } = bodyOf<PullBody>(await pull(SELLER_A));

    for (const person of changes['people']?.created ?? []) {
      expect(Object.keys(person).sort()).toEqual(['full_name', 'id', 'phone_number']);
    }
    const serialized = JSON.stringify(changes['people']);
    expect(serialized).not.toContain('example.test');
    expect(serialized).not.toContain('test-password-hash');
    expect(serialized).not.toContain('FR');
  });

  it.each([['abc'], ['-5'], ['1.5'], ['1e3'], ['9'.repeat(16)]])(
    'refuses last_pulled_at=%s with 400 VALIDATION_ERROR (AC-5)',
    async (value) => {
      const response = await pull(SELLER_A, `?last_pulled_at=${value}`);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
  );

  it('refuses a future last_pulled_at with 400 VALIDATION_ERROR (AC-5)', async () => {
    const response = await pull(SELLER_A, `?last_pulled_at=${Date.now() + 3_600_000}`);

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses an unknown query parameter and a repeated last_pulled_at (AC-5)', async () => {
    for (const query of ['?organization_id=' + ORG_B, '?last_pulled_at=1&last_pulled_at=2']) {
      const response = await pull(SELLER_A, query);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('answers 401 without a token', async () => {
    const response = await request(app).get('/api/v1/sync/pull');
    expect(response.status).toBe(401);
  });

  it('a revoked member no longer receives the organization (AB-1, v5.0.0-8.2.2)', async () => {
    await prisma.collaboration.update({
      where: { id: COLLAB_SELLER_A },
      data: { status: 'REVOKED' },
    });

    const { changes } = bodyOf<PullBody>(await pull(SELLER_A));

    expect(changes['organizations']?.created).toEqual([]);
    expect(changes['collaborations']?.created).toEqual([]);
  });
});
