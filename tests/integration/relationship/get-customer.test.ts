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

function open(orgId: string, id: string, personId = SELLER) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${orgId}/customers/${id}`
  );
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
      supplierLabel: 'Fournisseur secret',
      creditLimit: 50000n,
      balance: 12000n,
    })
  ).id;
});

describe('GET /api/v1/organizations/:organizationId/customers/:relationshipId', () => {
  it('AC-1 opens a customer with the supplier view, balance and credit limit', async () => {
    const response = await open(ORG_A, ownId);

    expect(response.status).toBe(200);
    const body = bodyOf<Item>(response);
    expect(body).toMatchObject({
      id: ownId,
      status: 'ACTIVE',
      customer_label: 'Maman Ngono',
      supplier_notes: 'pays late',
      credit_limit: 50000,
      balance: 12000,
    });
    expect(body).not.toHaveProperty('supplier_label');
  });

  it('AC-2 answers 404 for a deleted relationship', async () => {
    await prisma.customerRelationship.update({
      where: { id: ownId },
      data: { deletedAt: new Date() },
    });

    const response = await open(ORG_A, ownId);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('AC-2 answers 404 for an unknown id', async () => {
    expect((await open(ORG_A, newId())).status).toBe(404);
  });

  it('AC-2 answers 400 VALIDATION_ERROR when the id is not a UUID', async () => {
    const response = await open(ORG_A, 'not-a-uuid');

    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
  });

  it('AC-3 answers 403 FORBIDDEN for a DRIVER', async () => {
    const response = await open(ORG_A, ownId, DRIVER);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('lets the OWNER open a customer', async () => {
    expect((await open(ORG_A, ownId, OWNER)).status).toBe(200);
  });

  it('AC-2 / AB-1 answers 404 for a relationship of another business under own path', async () => {
    const other = await seedRelationship(ORG_B, { customerPersonId: CUSTOMER_1 });

    const response = await open(ORG_A, other.id);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('AB-1 answers 404 when the relationship is read as customer of the organization', async () => {
    const asCustomer = await seedRelationship(ORG_B, { customerOrganizationId: ORG_A });

    expect((await open(ORG_A, asCustomer.id)).status).toBe(404);
  });
});
