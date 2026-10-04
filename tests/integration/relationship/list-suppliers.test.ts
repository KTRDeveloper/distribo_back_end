import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const ME = '0199c0a8-0000-7000-8000-000000000001';
const OTHER = '0199c0a8-0000-7000-8000-000000000002';
const OWNER_A = '0199c0a8-0000-7000-8000-000000000005';
const OWNER_B = '0199c0a8-0000-7000-8000-000000000006';
const INVITED = '0199c0a8-0000-7000-8000-000000000011';

const ORG_A = '0199c0a8-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0a8-0000-7000-8000-0000000000b1';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Item = {
  id: string;
  status: string;
  supplier: unknown;
  supplier_label: string | null;
  balance: number;
  created_at: string;
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

async function seedOrg(id: string, ownerId: string) {
  await prisma.organization.create({ data: { id, name: 'Org ' + id.slice(-2) } });
  await prisma.collaboration.create({
    data: {
      id: id.replace(/.$/, '9'),
      personId: ownerId,
      organizationId: id,
      role: 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedRelationship(over: Record<string, unknown>, createdAt: string) {
  return prisma.customerRelationship.create({
    data: {
      id: newId(),
      createdById: ME,
      creditLimit: 0n,
      createdAt: new Date(createdAt),
      ...over,
    },
  });
}

function list(query = '', personId = ME) {
  return createAuthenticatedRequest(app, personId).get(`/api/v1/suppliers${query}`);
}

beforeEach(async () => {
  await seedPerson(ME, '+237600009001');
  await seedPerson(OTHER, '+237600009002');
  await seedPerson(OWNER_A, '+237600009005');
  await seedPerson(OWNER_B, '+237600009006');
  await seedPerson(INVITED, '+237600009011');
  await seedOrg(ORG_A, OWNER_A);
  await seedOrg(ORG_B, OWNER_B);

  await seedRelationship(
    {
      supplierOrganizationId: ORG_A,
      customerPersonId: ME,
      customerLabel: 'Secret customer label',
      supplierLabel: 'Mon grossiste',
      supplierNotes: 'Secret supplier notes',
      balance: 5000n,
    },
    '2026-02-01T00:00:00.000Z'
  );
  await seedRelationship(
    {
      supplierOrganizationId: ORG_B,
      customerPersonId: ME,
      status: 'ENDED',
      endedByParty: 'SUPPLIER',
    },
    '2026-02-02T00:00:00.000Z'
  );
  await seedRelationship(
    { supplierPersonId: INVITED, customerPersonId: ME, status: 'PENDING', creditLimit: null },
    '2026-02-03T00:00:00.000Z'
  );
  // Not mine: another person's relationship, and one where I am the supplier person.
  await seedRelationship(
    { supplierOrganizationId: ORG_A, customerPersonId: OTHER, customerLabel: 'Foreign' },
    '2026-02-04T00:00:00.000Z'
  );
  await seedRelationship(
    { supplierPersonId: ME, customerPersonId: OTHER, status: 'PENDING', creditLimit: null },
    '2026-02-05T00:00:00.000Z'
  );
});

describe('GET /api/v1/suppliers', () => {
  it('AC-1 lists the three relationships newest first, customer view', async () => {
    const response = await list();

    expect(response.status).toBe(200);
    const body = bodyOf<Page>(response);
    expect(body.items).toHaveLength(3);
    expect(body.next_cursor).toBeNull();
    const dates = body.items.map((i) => i.created_at);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(body.items.map((i) => i.status)).toEqual(['PENDING', 'ENDED', 'ACTIVE']);
    const active = body.items.find((i) => i.status === 'ACTIVE');
    expect(active).toMatchObject({ supplier_label: 'Mon grossiste', balance: 5000 });
    for (const item of body.items) {
      expect(item).not.toHaveProperty('customer_label');
      expect(item).not.toHaveProperty('supplier_notes');
    }
  });

  it('AC-2 status=PENDING returns only the invitation', async () => {
    const body = bodyOf<Page>(await list('?status=PENDING'));

    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.status).toBe('PENDING');
  });

  it('AC-3 pages 2 then 1 with the returned cursor', async () => {
    const first = bodyOf<Page>(await list('?limit=2'));
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();

    const second = bodyOf<Page>(
      await list(`?limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`)
    );
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();

    const all = bodyOf<Page>(await list()).items.map((i) => i.id);
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual(all);
  });

  it('AC-4 leaves out deleted and merged rows', async () => {
    await prisma.customerRelationship.updateMany({
      where: { supplierOrganizationId: ORG_B, customerPersonId: ME },
      data: { deletedAt: new Date() },
    });

    expect(bodyOf<Page>(await list()).items).toHaveLength(2);
  });

  it.each([
    ['an unknown query field', '?search=x'],
    ['an unknown status', '?status=DONE'],
    ['a limit of 101', '?limit=101'],
    ['a malformed cursor', '?cursor=%25%25'],
  ])('answers 400 VALIDATION_ERROR for %s', async (_name, query) => {
    const response = await list(query);

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 401 without a token', async () => {
    const response = await request(app).get('/api/v1/suppliers');

    expect(response.status).toBe(401);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('UNAUTHORIZED');
  });
});

describe('security', () => {
  it('AB-1 never returns the relationships of another person', async () => {
    const mine = bodyOf<Page>(await list()).items.map((i) => i.id);
    const theirs = bodyOf<Page>(await list('', OTHER)).items.map((i) => i.id);
    const foreign = await prisma.customerRelationship.findMany({
      where: { customerPersonId: OTHER },
    });

    expect(theirs).toHaveLength(2);
    for (const row of foreign) expect(mine).not.toContain(row.id);
    for (const id of mine) expect(theirs).not.toContain(id);
  });

  it('AB-2 never sends customer_label or supplier_notes', async () => {
    const response = await list();

    expect(JSON.stringify(response.body)).not.toContain('customer_label');
    expect(JSON.stringify(response.body)).not.toContain('supplier_notes');
    expect(JSON.stringify(response.body)).not.toContain('Secret');
  });
});
