import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0a9-0000-7000-8000-000000000001';
const MANAGER = '0199c0a9-0000-7000-8000-000000000002';
const SELLER = '0199c0a9-0000-7000-8000-000000000003';
const DRIVER = '0199c0a9-0000-7000-8000-000000000004';
const OWNER_B = '0199c0a9-0000-7000-8000-000000000005';
const OWNER_S1 = '0199c0a9-0000-7000-8000-000000000006';
const OWNER_S2 = '0199c0a9-0000-7000-8000-000000000007';
const PERSON_CUSTOMER = '0199c0a9-0000-7000-8000-000000000008';

const ORG_A = '0199c0a9-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0a9-0000-7000-8000-0000000000b1';
const SUPPLIER_1 = '0199c0a9-0000-7000-8000-0000000000c1';
const SUPPLIER_2 = '0199c0a9-0000-7000-8000-0000000000c2';

const REL_1 = '0199c0a9-0000-7000-8000-0000000000d1';
const REL_2 = '0199c0a9-0000-7000-8000-0000000000d2';
const REL_B = '0199c0a9-0000-7000-8000-0000000000d3';
const REL_PERSON = '0199c0a9-0000-7000-8000-0000000000d4';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Item = {
  id: string;
  status: string;
  supplier: { kind: string; name?: string } | null;
  supplier_label: string | null;
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

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER'
) {
  await prisma.collaboration.create({
    data: {
      id: newId(),
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedOrg(id: string, ownerId: string) {
  await prisma.organization.create({ data: { id, name: 'Org ' + id.slice(-2), status: 'ACTIVE' } });
  await seedMember(id, ownerId, 'OWNER');
}

function seedRelationship(id: string, data: Record<string, unknown>) {
  return prisma.customerRelationship.create({
    data: { id, createdById: OWNER, creditLimit: 0n, status: 'ACTIVE', ...data } as never,
  });
}

function list(personId = MANAGER, organizationId = ORG_A, query = '') {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${organizationId}/suppliers${query}`
  );
}

function patch(relationshipId: string, body: unknown, personId = MANAGER, organizationId = ORG_A) {
  return createAuthenticatedRequest(app, personId)
    .patch(`/api/v1/organizations/${organizationId}/suppliers/${relationshipId}`)
    .send(body as object);
}

const stored = (id: string) => prisma.customerRelationship.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009201');
  await seedPerson(MANAGER, '+237600009202');
  await seedPerson(SELLER, '+237600009203');
  await seedPerson(DRIVER, '+237600009204');
  await seedPerson(OWNER_B, '+237600009205');
  await seedPerson(OWNER_S1, '+237600009206');
  await seedPerson(OWNER_S2, '+237600009207');
  await seedPerson(PERSON_CUSTOMER, '+237600009208');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER');
  await seedMember(ORG_A, SELLER, 'SELLER');
  await seedMember(ORG_A, DRIVER, 'DRIVER');
  await seedOrg(ORG_B, OWNER_B);
  await seedOrg(SUPPLIER_1, OWNER_S1);
  await seedOrg(SUPPLIER_2, OWNER_S2);

  // Org A buys from two suppliers; the supplier wrote customer_label and supplier_notes.
  await seedRelationship(REL_1, {
    supplierOrganizationId: SUPPLIER_1,
    customerOrganizationId: ORG_A,
    customerLabel: 'Secret customer label',
    supplierNotes: 'Secret supplier notes',
    supplierLabel: 'Grossiste un',
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
  });
  await seedRelationship(REL_2, {
    supplierOrganizationId: SUPPLIER_2,
    customerOrganizationId: ORG_A,
    createdAt: new Date('2026-02-02T00:00:00.000Z'),
  });
  // Not Org A's: Org B's supplier, and a person (not an organization) buying from a supplier.
  await seedRelationship(REL_B, {
    supplierOrganizationId: SUPPLIER_1,
    customerOrganizationId: ORG_B,
  });
  await seedRelationship(REL_PERSON, {
    supplierOrganizationId: SUPPLIER_2,
    customerPersonId: PERSON_CUSTOMER,
  });
});

describe('GET /api/v1/organizations/:organizationId/suppliers', () => {
  it('AC-1 lists the two suppliers newest first, customer view, CM-19', async () => {
    const response = await list();

    expect(response.status).toBe(200);
    const page = bodyOf<Page>(response);
    expect(page.items.map((item) => item.id)).toEqual([REL_2, REL_1]);
    expect(page.next_cursor).toBeNull();
    expect(page.items[1]).toMatchObject({
      status: 'ACTIVE',
      supplier_label: 'Grossiste un',
      supplier: { kind: 'ORGANIZATION', name: 'Org c1' },
    });
  });

  it.each([
    ['OWNER', OWNER, 200],
    ['MANAGER', MANAGER, 200],
    ['SELLER', SELLER, 403],
    ['DRIVER', DRIVER, 403],
  ])('AC-3 %s answers %i on GET', async (_role, personId, status) => {
    const response = await list(personId);

    expect(response.status).toBe(status);
    if (status === 403) expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('AC-3 a SELLER and a DRIVER also get 403 on PATCH, nothing written', async () => {
    for (const personId of [SELLER, DRIVER]) {
      const response = await patch(REL_1, { supplier_label: 'Hacked' }, personId);
      expect(response.status).toBe(403);
    }
    expect((await stored(REL_1)).supplierLabel).toBe('Grossiste un');
  });

  it('paginates with limit and cursor', async () => {
    const first = bodyOf<Page>(await list(MANAGER, ORG_A, '?limit=1'));
    expect(first.items.map((item) => item.id)).toEqual([REL_2]);
    expect(first.next_cursor).not.toBeNull();

    const second = bodyOf<Page>(await list(MANAGER, ORG_A, `?limit=1&cursor=${first.next_cursor}`));
    expect(second.items.map((item) => item.id)).toEqual([REL_1]);
    expect(second.next_cursor).toBeNull();
  });

  it('AC-4 rejects an unknown query field with 400', async () => {
    const response = await list(MANAGER, ORG_A, '?foo=1');
    expect(response.status).toBe(400);
  });

  it('AB-1 a member of A listing for business B answers 404', async () => {
    const response = await list(MANAGER, ORG_B);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('AB-2 no customer_label or supplier_notes appears', async () => {
    const response = await list();

    expect(JSON.stringify(response.body)).not.toMatch(
      /customer_label|supplier_notes|Secret customer label|Secret supplier notes/
    );
  });

  it('shows only relationships where the organization itself is the customer', async () => {
    // A relationship where Org A is the supplier must not appear in its supplier list.
    await seedRelationship('0199c0a9-0000-7000-8000-0000000000d5', {
      supplierOrganizationId: ORG_A,
      customerPersonId: PERSON_CUSTOMER,
    });
    const page = bodyOf<Page>(await list());
    expect(page.items.map((item) => item.id).sort()).toEqual([REL_1, REL_2].sort());
  });
});

describe('PATCH /api/v1/organizations/:organizationId/suppliers/:relationshipId', () => {
  it('AC-2 stores the label and answers the customer view', async () => {
    const response = await patch(REL_2, { supplier_label: '  Fournisseur deux  ' });

    expect(response.status).toBe(200);
    const view = bodyOf<Item>(response);
    expect(view.id).toBe(REL_2);
    expect(view.supplier_label).toBe('Fournisseur deux');
    expect((await stored(REL_2)).supplierLabel).toBe('Fournisseur deux');
    expect(JSON.stringify(response.body)).not.toMatch(/customer_label|supplier_notes/);
  });

  it('an OWNER may name a supplier too', async () => {
    const response = await patch(REL_2, { supplier_label: 'Du patron' }, OWNER);
    expect(response.status).toBe(200);
  });

  it('writes nothing but supplier_label', async () => {
    await patch(REL_1, { supplier_label: 'Nouveau' });

    const row = await stored(REL_1);
    expect(row.customerLabel).toBe('Secret customer label');
    expect(row.supplierNotes).toBe('Secret supplier notes');
    expect(row.status).toBe('ACTIVE');
  });

  it('AC-4 100 characters pass, 101 answer 400 and nothing is written', async () => {
    expect((await patch(REL_1, { supplier_label: 'a'.repeat(100) })).status).toBe(200);
    const response = await patch(REL_1, { supplier_label: 'b'.repeat(101) });

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect((await stored(REL_1)).supplierLabel).toBe('a'.repeat(100));
  });

  it.each([
    ['another key', { supplier_label: 'X', customer_label: 'Y' }],
    ['credit limit', { supplier_label: 'X', credit_limit: 9 }],
    ['empty body', {}],
    ['empty label', { supplier_label: '   ' }],
  ])('AC-4 rejects %s with 400', async (_name, body) => {
    const response = await patch(REL_1, body);

    expect(response.status).toBe(400);
    const row = await stored(REL_1);
    expect(row.supplierLabel).toBe('Grossiste un');
    expect(row.customerLabel).toBe('Secret customer label');
  });

  it('AB-1 a member of A patching for business B answers 404', async () => {
    const response = await patch(REL_B, { supplier_label: 'Hacked' }, MANAGER, ORG_B);

    expect(response.status).toBe(404);
    expect((await stored(REL_B)).supplierLabel).toBeNull();
  });

  it('AB-1 a relationship of business B patched through business A answers 404', async () => {
    const response = await patch(REL_B, { supplier_label: 'Hacked' });

    expect(response.status).toBe(404);
    expect((await stored(REL_B)).supplierLabel).toBeNull();
  });

  it('answers 404 for a relationship where A is the supplier or an unknown id', async () => {
    expect((await patch(REL_PERSON, { supplier_label: 'X' })).status).toBe(404);
    expect(
      (await patch('0199c0a9-0000-7000-8000-0000000000ff', { supplier_label: 'X' })).status
    ).toBe(404);
  });

  it('answers 404 for a deleted relationship', async () => {
    await prisma.customerRelationship.update({ where: { id: REL_1 }, data: { deletedAt: REG } });

    const response = await patch(REL_1, { supplier_label: 'X' });
    expect(response.status).toBe(404);
  });
});
