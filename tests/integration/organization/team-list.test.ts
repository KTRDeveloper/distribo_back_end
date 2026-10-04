import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c019-0000-7000-8000-000000000001';
const MANAGER = '0199c019-0000-7000-8000-000000000002';
const SELLER = '0199c019-0000-7000-8000-000000000003';
const DRIVER = '0199c019-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c019-0000-7000-8000-000000000005';

const ORG_A = '0199c019-0000-7000-8000-0000000000a1';
const ORG_B = '0199c019-0000-7000-8000-0000000000b1';

const OWNER_ROW = '0199c019-0000-7000-8000-0000000000a1';
const MANAGER_ROW = '0199c019-0000-7000-8000-0000000000a2';
const SELLER_ROW = '0199c019-0000-7000-8000-0000000000a3';
const DRIVER_ROW = '0199c019-0000-7000-8000-0000000000a4';
const OTHER_OWNER_ROW = '0199c019-0000-7000-8000-0000000000b9';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Item = {
  id: string;
  person: { public_name: string | null; phone_number: string | null; registered: boolean };
  role: string;
  status: string;
  is_public_contact: boolean;
  invited_at: string;
  accepted_at: string | null;
  amount_held?: number;
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
      email: `${phone.slice(1)}@example.test`,
      preferredLanguage: 'EN',
      registeredAt: REG,
    },
  });
}

async function seedCollaboration(
  id: string,
  personId: string,
  organizationId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  status: 'ACTIVE' | 'REVOKED',
  amountHeld = 0n,
  invitedAt = REG
) {
  await prisma.collaboration.create({
    data: {
      id,
      personId,
      organizationId,
      role,
      status,
      acceptedAt: REG,
      invitedAt,
      amountHeld,
      isPublicContact: role === 'OWNER',
    },
  });
}

function list(orgId: string, personId: string, query = '') {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${orgId}/collaborators${query}`
  );
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600019001');
  await seedPerson(MANAGER, '+237600019002');
  await seedPerson(SELLER, '+237600019003');
  await seedPerson(DRIVER, '+237600019004');
  await seedPerson(OTHER_OWNER, '+237600019005');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A' } });
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B' } });
  await seedCollaboration(OWNER_ROW, OWNER, ORG_A, 'OWNER', 'ACTIVE', 700n);
  await seedCollaboration(MANAGER_ROW, MANAGER, ORG_A, 'MANAGER', 'ACTIVE', 300n);
  await seedCollaboration(SELLER_ROW, SELLER, ORG_A, 'SELLER', 'ACTIVE', 100n);
  await seedCollaboration(DRIVER_ROW, DRIVER, ORG_A, 'DRIVER', 'REVOKED', 5000n);
  await seedCollaboration(OTHER_OWNER_ROW, OTHER_OWNER, ORG_B, 'OWNER', 'ACTIVE', 999n);
});

describe('GET /api/v1/organizations/:organizationId/collaborators', () => {
  it('AC-1 the owner sees all four rows, including the revoked driver holding 5000', async () => {
    const response = await list(ORG_A, OWNER);

    expect(response.status).toBe(200);
    const page = bodyOf<Page>(response);
    expect(page.items).toHaveLength(4);
    expect(page.next_cursor).toBeNull();
    const driver = page.items.find((i) => i.id === DRIVER_ROW);
    expect(driver).toMatchObject({ role: 'DRIVER', status: 'REVOKED', amount_held: 5000 });
    expect(page.items.find((i) => i.id === SELLER_ROW)?.amount_held).toBe(100);
    expect(page.items.find((i) => i.id === OWNER_ROW)).toMatchObject({
      role: 'OWNER',
      status: 'ACTIVE',
      is_public_contact: true,
      person: { public_name: 'Fixture Person', phone_number: '+237600019001', registered: true },
      accepted_at: REG.toISOString(),
      invited_at: REG.toISOString(),
      amount_held: 700,
    });
  });

  it('AC-2 the manager sees no money of others, only their own', async () => {
    const response = await list(ORG_A, MANAGER);

    expect(response.status).toBe(200);
    const page = bodyOf<Page>(response);
    expect(page.items).toHaveLength(4);
    for (const item of page.items) {
      if (item.id === MANAGER_ROW) expect(item.amount_held).toBe(300);
      else expect('amount_held' in item).toBe(false);
    }
  });

  it.each([
    ['OWNER', OWNER, 200],
    ['MANAGER', MANAGER, 200],
    ['SELLER', SELLER, 403],
    ['DRIVER', DRIVER, 403],
  ] as const)('AC-3 role %s answers %i', async (_role, personId, status) => {
    // the driver fixture is REVOKED for AC-1; a REVOKED member would get 404, so reactivate it
    await prisma.collaboration.update({ where: { id: DRIVER_ROW }, data: { status: 'ACTIVE' } });

    const response = await list(ORG_A, personId);

    expect(response.status).toBe(status);
    if (status === 403) expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('AC-4 pages hold 2, 2 and 1 items', async () => {
    await prisma.collaboration.update({
      where: { id: DRIVER_ROW },
      data: { status: 'ACTIVE' },
    });
    const extra = '0199c019-0000-7000-8000-000000000006';
    await seedPerson(extra, '+237600019006');
    await seedCollaboration(
      '0199c019-0000-7000-8000-0000000000a6',
      extra,
      ORG_A,
      'SELLER',
      'ACTIVE',
      0n,
      new Date('2026-02-01T00:00:00.000Z')
    );
    // five collaborators in A now
    const first = bodyOf<Page>(await list(ORG_A, OWNER, '?limit=2'));
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();
    const second = bodyOf<Page>(
      await list(ORG_A, OWNER, `?limit=2&cursor=${first.next_cursor ?? ''}`)
    );
    expect(second.items).toHaveLength(2);
    expect(second.next_cursor).not.toBeNull();
    const third = bodyOf<Page>(
      await list(ORG_A, OWNER, `?limit=2&cursor=${second.next_cursor ?? ''}`)
    );
    expect(third.items).toHaveLength(1);
    expect(third.next_cursor).toBeNull();

    const ids = [...first.items, ...second.items, ...third.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('rejects unknown query keys and a bad cursor with 400', async () => {
    expect((await list(ORG_A, OWNER, '?role=OWNER')).status).toBe(400);
    expect((await list(ORG_A, OWNER, '?cursor=not-a-cursor')).status).toBe(400);
    expect((await list(ORG_A, OWNER, '?limit=101')).status).toBe(400);
  });

  it('requires authentication', async () => {
    const response = await request(app).get(`/api/v1/organizations/${ORG_A}/collaborators`);
    expect(response.status).toBe(401);
  });

  it('AB-1 a member of A listing the team of B gets 404', async () => {
    const response = await list(ORG_B, OWNER);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(response.body)).not.toContain('999');
  });

  it('AB-2 no email, language or password data appears', async () => {
    const response = await list(ORG_A, OWNER);
    const text = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(text).not.toContain('example.test');
    expect(text).not.toMatch(/email|language|password|hash|person_id|deleted/i);
    for (const item of bodyOf<Page>(response).items) {
      expect(Object.keys(item.person).sort()).toEqual([
        'phone_number',
        'public_name',
        'registered',
      ]);
    }
  });
});
