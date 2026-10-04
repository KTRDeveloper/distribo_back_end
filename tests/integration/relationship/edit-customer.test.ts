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

const ORG_A = '0199c0a8-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0a8-0000-7000-8000-0000000000b1';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Item = {
  id: string;
  status: string;
  customer_label: string | null;
  delivery_address: string | null;
  supplier_notes: string | null;
  credit_limit: number | null;
  balance: number;
};

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

async function seedRelationship(orgId: string, over: Record<string, unknown> = {}) {
  return prisma.customerRelationship.create({
    data: {
      id: newId(),
      supplierOrganizationId: orgId,
      createdById: OWNER,
      creditLimit: 0n,
      ...over,
    },
  });
}

function edit(orgId: string, id: string, body: unknown, personId = SELLER) {
  return createAuthenticatedRequest(app, personId)
    .patch(`/api/v1/organizations/${orgId}/customers/${id}`)
    .send(body as object);
}

let ownId: string;

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009001');
  await seedPerson(SELLER, '+237600009002');
  await seedPerson(DRIVER, '+237600009003');
  await seedPerson(OTHER_OWNER, '+237600009005');
  await seedPerson(CUSTOMER_1, '+237600009011');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, SELLER, 'SELLER');
  await seedMember(ORG_A, DRIVER, 'DRIVER');
  await seedOrg(ORG_B, OTHER_OWNER);

  ownId = (
    await seedRelationship(ORG_A, {
      customerPersonId: CUSTOMER_1,
      customerLabel: 'Maman Ngono',
      supplierNotes: 'pays late',
      deliveryAddress: 'Rue 1',
      supplierLabel: 'Fournisseur secret',
      creditLimit: 50000n,
      balance: 12000n,
    })
  ).id;
});

describe('PATCH /api/v1/organizations/:organizationId/customers/:relationshipId', () => {
  it('AC-1 / CM-19 edits the label and the notes and answers the supplier view', async () => {
    const response = await edit(ORG_A, ownId, {
      customer_label: 'Mama Ngono',
      supplier_notes: 'pays on time',
    });

    expect(response.status).toBe(200);
    const body = bodyOf<Item>(response);
    expect(body).toMatchObject({
      id: ownId,
      customer_label: 'Mama Ngono',
      supplier_notes: 'pays on time',
      delivery_address: 'Rue 1',
      credit_limit: 50000,
      balance: 12000,
    });
    expect(body).not.toHaveProperty('supplier_label');
    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: ownId } });
    expect(row.customerLabel).toBe('Mama Ngono');
    expect(row.supplierNotes).toBe('pays on time');
    expect(row.supplierLabel).toBe('Fournisseur secret');
  });

  it('edits the address and leaves the other fields alone', async () => {
    const response = await edit(ORG_A, ownId, { delivery_address: 'Rue 2' });

    expect(response.status).toBe(200);
    expect(bodyOf<Item>(response)).toMatchObject({
      delivery_address: 'Rue 2',
      customer_label: 'Maman Ngono',
      supplier_notes: 'pays late',
    });
  });

  it('clears supplier_notes and delivery_address with null', async () => {
    const response = await edit(ORG_A, ownId, { supplier_notes: null, delivery_address: null });

    expect(response.status).toBe(200);
    expect(bodyOf<Item>(response)).toMatchObject({ supplier_notes: null, delivery_address: null });
  });

  it('lets the OWNER edit a customer', async () => {
    expect((await edit(ORG_A, ownId, { customer_label: 'X' }, OWNER)).status).toBe(200);
  });

  it.each([
    ['customer_label empty', { customer_label: '' }],
    ['customer_label 101 chars', { customer_label: 'a'.repeat(101) }],
    ['customer_label null', { customer_label: null }],
    ['supplier_notes 2001 chars', { supplier_notes: 'a'.repeat(2001) }],
    ['delivery_address 2001 chars', { delivery_address: 'a'.repeat(2001) }],
    ['no field', {}],
  ])('AC-2 answers 400 for %s and changes nothing', async (_name, body) => {
    const response = await edit(ORG_A, ownId, body);

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: ownId } });
    expect(row.customerLabel).toBe('Maman Ngono');
    expect(row.supplierNotes).toBe('pays late');
  });

  it('AC-3 / C-06 answers 400 when a counter label is set to empty', async () => {
    const counter = await seedRelationship(ORG_A, { customerLabel: 'Comptoir' });

    const response = await edit(ORG_A, counter.id, { customer_label: '' });

    expect(response.status).toBe(400);
    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: counter.id } });
    expect(row.customerLabel).toBe('Comptoir');
  });

  it('AC-3 / C-06 edits the label of a counter', async () => {
    const counter = await seedRelationship(ORG_A, { customerLabel: 'Comptoir' });

    const response = await edit(ORG_A, counter.id, { customer_label: 'Comptoir 2' });

    expect(response.status).toBe(200);
    expect(bodyOf<Item>(response).customer_label).toBe('Comptoir 2');
  });

  it('AC-4 answers 403 FORBIDDEN for a DRIVER and changes nothing', async () => {
    const response = await edit(ORG_A, ownId, { customer_label: 'Hacked' }, DRIVER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: ownId } });
    expect(row.customerLabel).toBe('Maman Ngono');
  });

  it.each([
    ['credit_limit', { credit_limit: 999999 }],
    ['balance', { balance: 0 }],
    ['status', { status: 'ENDED' }],
    ['supplier_label', { supplier_label: 'x' }],
    ['customer_person_id', { customer_person_id: OWNER }],
  ])('AB-1 answers 400 and changes nothing when the body has %s', async (_name, extra) => {
    const response = await edit(ORG_A, ownId, { customer_label: 'Mama', ...extra });

    expect(response.status).toBe(400);
    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: ownId } });
    expect(row.customerLabel).toBe('Maman Ngono');
    expect(row.creditLimit).toBe(50000n);
    expect(row.balance).toBe(12000n);
    expect(row.status).toBe('ACTIVE');
    expect(row.supplierLabel).toBe('Fournisseur secret');
    expect(row.customerPersonId).toBe(CUSTOMER_1);
  });

  it('AB-2 answers 404 for a relationship of another business and changes nothing', async () => {
    const other = await seedRelationship(ORG_B, {
      customerPersonId: CUSTOMER_1,
      customerLabel: 'B label',
    });

    const response = await edit(ORG_A, other.id, { customer_label: 'Stolen' });

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: other.id } });
    expect(row.customerLabel).toBe('B label');
  });

  it('AB-2 answers 404 for a relationship where the organization is the customer', async () => {
    const asCustomer = await seedRelationship(ORG_B, {
      customerOrganizationId: ORG_A,
      customerLabel: 'B label',
    });

    expect((await edit(ORG_A, asCustomer.id, { customer_label: 'Stolen' })).status).toBe(404);
  });

  it('answers 404 for a deleted relationship and 400 for a malformed id', async () => {
    await prisma.customerRelationship.update({
      where: { id: ownId },
      data: { deletedAt: new Date() },
    });

    expect((await edit(ORG_A, ownId, { customer_label: 'X' })).status).toBe(404);
    expect((await edit(ORG_A, 'not-a-uuid', { customer_label: 'X' })).status).toBe(400);
  });
});
