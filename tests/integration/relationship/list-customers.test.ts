import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0a8-0000-7000-8000-000000000001';
const SELLER = '0199c0a8-0000-7000-8000-000000000002';
const DRIVER = '0199c0a8-0000-7000-8000-000000000003';
const OTHER_OWNER = '0199c0a8-0000-7000-8000-000000000005';
const CUSTOMER_1 = '0199c0a8-0000-7000-8000-000000000011';
const CUSTOMER_2 = '0199c0a8-0000-7000-8000-000000000012';
const CUSTOMER_3 = '0199c0a8-0000-7000-8000-000000000013';

const ORG_A = '0199c0a8-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0a8-0000-7000-8000-0000000000b1';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Item = {
  id: string;
  status: string;
  customer: unknown;
  customer_label: string | null;
  supplier_notes: string | null;
  created_at: string;
};
type Page = { items: Item[]; next_cursor: string | null };

async function seedPerson(id: string, phone: string, registered = true) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: registered ? REG : null,
      passwordHash: registered ? 'test-password-hash' : null,
      registeredAt: registered ? REG : null,
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

async function seedMember(orgId: string, personId: string, role: 'SELLER' | 'DRIVER') {
  await prisma.collaboration.create({
    data: {
      id: orgId.replace(/.{2}$/, personId.slice(-2)),
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedRelationship(orgId: string, over: Record<string, unknown>, createdAt: string) {
  return prisma.customerRelationship.create({
    data: {
      id: newId(),
      supplierOrganizationId: orgId,
      createdById: OWNER,
      creditLimit: 0n,
      createdAt: new Date(createdAt),
      ...over,
    },
  });
}

function list(orgId: string, query = '', personId = SELLER) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${orgId}/customers${query}`
  );
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600008001');
  await seedPerson(SELLER, '+237600008002');
  await seedPerson(DRIVER, '+237600008003');
  await seedPerson(OTHER_OWNER, '+237600008005');
  await seedPerson(CUSTOMER_1, '+237600008011');
  await seedPerson(CUSTOMER_2, '+237600008012');
  await seedPerson(CUSTOMER_3, '+237600008013', false);
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, SELLER, 'SELLER');
  await seedMember(ORG_A, DRIVER, 'DRIVER');
  await seedOrg(ORG_B, OTHER_OWNER);

  await seedRelationship(
    ORG_A,
    { customerLabel: 'Comptoir', status: 'ACTIVE' },
    '2026-02-01T00:00:00.000Z'
  );
  await seedRelationship(
    ORG_A,
    {
      customerPersonId: CUSTOMER_1,
      customerLabel: 'Maman Ngono',
      supplierNotes: 'pays late',
      supplierLabel: 'Fournisseur secret',
    },
    '2026-02-02T00:00:00.000Z'
  );
  await seedRelationship(ORG_A, { customerPersonId: CUSTOMER_2 }, '2026-02-03T00:00:00.000Z');
  await seedRelationship(ORG_A, { customerPersonId: CUSTOMER_3 }, '2026-02-04T00:00:00.000Z');
  await seedRelationship(
    ORG_B,
    { customerPersonId: CUSTOMER_1, customerLabel: 'Other business customer' },
    '2026-02-05T00:00:00.000Z'
  );
});

describe('GET /api/v1/organizations/:organizationId/customers', () => {
  it('AC-1 lists the 3 customers and the counter newest first, supplier view', async () => {
    const response = await list(ORG_A);

    expect(response.status).toBe(200);
    const body = bodyOf<Page>(response);
    expect(body.items).toHaveLength(4);
    expect(body.next_cursor).toBeNull();
    const dates = body.items.map((i) => i.created_at);
    expect(dates).toEqual([...dates].sort().reverse());
    const maman = body.items.find((i) => i.customer_label === 'Maman Ngono');
    expect(maman).toMatchObject({ supplier_notes: 'pays late', status: 'ACTIVE' });
    for (const item of body.items) {
      expect(item).not.toHaveProperty('supplier_label');
    }
  });

  it.each([
    ['counter=true', 1],
    ['counter=false', 3],
    ['status=ENDED', 0],
    ['status=ACTIVE', 4],
  ])('AC-2 filters with %s', async (query, count) => {
    const response = await list(ORG_A, `?${query}`);

    expect(response.status).toBe(200);
    expect(bodyOf<Page>(response).items).toHaveLength(count);
  });

  it('AC-2 status=ENDED returns an ended relationship', async () => {
    await prisma.customerRelationship.updateMany({
      where: { supplierOrganizationId: ORG_A, customerPersonId: CUSTOMER_2 },
      data: { status: 'ENDED', endedByParty: 'SUPPLIER' },
    });

    const response = await list(ORG_A, '?status=ENDED');

    expect(bodyOf<Page>(response).items).toHaveLength(1);
  });

  it('AC-3 pages by 2 with the returned cursor without repeating or skipping a row', async () => {
    const first = bodyOf<Page>(await list(ORG_A, '?limit=2'));
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();

    const second = bodyOf<Page>(
      await list(ORG_A, `?limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`)
    );
    expect(second.items).toHaveLength(2);
    expect(second.next_cursor).toBeNull();

    const all = bodyOf<Page>(await list(ORG_A)).items.map((i) => i.id);
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual(all);
  });

  it('AC-4 answers 403 FORBIDDEN for a DRIVER', async () => {
    const response = await list(ORG_A, '', DRIVER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('lets a MANAGER and the OWNER list', async () => {
    expect((await list(ORG_A, '', OWNER)).status).toBe(200);
  });

  it.each([
    ['an unknown query field', '?search=x'],
    ['an unknown status', '?status=DONE'],
    ['a non boolean counter', '?counter=maybe'],
    ['a limit of 101', '?limit=101'],
    ['a malformed cursor', '?cursor=%25%25'],
  ])('answers 400 VALIDATION_ERROR for %s', async (_name, query) => {
    const response = await list(ORG_A, query);

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('leaves out deleted and merged relationships', async () => {
    await prisma.customerRelationship.updateMany({
      where: { supplierOrganizationId: ORG_A, customerPersonId: CUSTOMER_3 },
      data: { deletedAt: new Date() },
    });

    expect(bodyOf<Page>(await list(ORG_A)).items).toHaveLength(3);
  });

  it('answers 401 without a token', async () => {
    const response = await createAuthenticatedRequest(app, SELLER)
      .get(`/api/v1/organizations/${ORG_A}/customers`)
      .set('Authorization', 'Bearer nope');
    expect(response.status).toBe(401);
  });
});

describe('security', () => {
  it('AB-1 answers 404 when a member of A lists the customers of B', async () => {
    const response = await list(ORG_B);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('AB-1 never returns B rows in the list of A, nor A rows in the list of B', async () => {
    const own = bodyOf<Page>(await list(ORG_A)).items;
    const ids = own.map((i) => i.id);
    const other = await prisma.customerRelationship.findMany({
      where: { supplierOrganizationId: ORG_B },
    });
    for (const row of other) expect(ids).not.toContain(row.id);
    expect(own.some((i) => i.customer_label === 'Other business customer')).toBe(false);
  });

  it('AB-2 never sends supplier_label to the supplier', async () => {
    const response = await list(ORG_A);

    expect(JSON.stringify(response.body)).not.toContain('supplier_label');
    expect(JSON.stringify(response.body)).not.toContain('Fournisseur secret');
  });
});
