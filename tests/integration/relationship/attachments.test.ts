import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const PERSON = '0199c0b0-0000-7000-8000-000000000201';
const OTHER = '0199c0b0-0000-7000-8000-000000000202';
const INVITER = '0199c0b0-0000-7000-8000-000000000203';
const ORG_A = '0199c0b0-0000-7000-8000-0000000002a1';
const ORG_B = '0199c0b0-0000-7000-8000-0000000002a2';
const ORG_TEAM = '0199c0b0-0000-7000-8000-0000000002a3';
const REG = new Date('2026-01-01T00:00:00.000Z');

type Attachments = {
  relationships: Array<Record<string, unknown> & { id: string; status: string }>;
  team_invitations: Array<{ id: string; organization_name: string }>;
  supplier_invitations: Array<{ id: string; supplier_label: string | null }>;
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

async function seedRelationship(
  organizationId: string,
  customerPersonId: string,
  over: Record<string, unknown> = {}
) {
  const id = newId();
  await prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId: organizationId,
      customerPersonId,
      supplierLabel: 'Mon fournisseur',
      customerLabel: 'PRIVATE-CUSTOMER-LABEL',
      supplierNotes: 'PRIVATE-SUPPLIER-NOTES',
      status: 'ACTIVE',
      creditLimit: 0n,
      createdById: customerPersonId,
      ...over,
    },
  });
  return id;
}

async function seedSupplierInvitation(supplierPersonId: string, customerPersonId: string) {
  const id = newId();
  await prisma.customerRelationship.create({
    data: {
      id,
      supplierPersonId,
      customerPersonId,
      supplierLabel: 'Chez Paul',
      status: 'PENDING',
      creditLimit: 0n,
      createdById: customerPersonId,
    },
  });
  return id;
}

async function seedTeamInvitation(organizationId: string, personId: string) {
  const id = newId();
  await prisma.collaboration.create({
    data: {
      id,
      personId,
      organizationId,
      role: 'SELLER',
      status: 'INVITED',
      invitedAt: REG,
    },
  });
  return id;
}

const get = (personId: string) =>
  createAuthenticatedRequest(app, personId).get('/api/v1/people/me/attachments');

beforeEach(async () => {
  await seedPerson(PERSON, '+237600009501');
  await seedPerson(OTHER, '+237600009502');
  await seedPerson(INVITER, '+237600009503');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: ORG_B, name: 'Org B', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: ORG_TEAM, name: 'Org Team', status: 'ACTIVE' } });
  await prisma.collaboration.create({
    data: {
      id: newId(),
      personId: INVITER,
      organizationId: ORG_TEAM,
      role: 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
});

describe('GET /api/v1/people/me/attachments', () => {
  it('AC-1 lists the relationships, the team invitation and the supplier invitation', async () => {
    const active = await seedRelationship(ORG_A, PERSON);
    const ended = await seedRelationship(ORG_B, PERSON, {
      status: 'ENDED',
      endedByParty: 'SUPPLIER',
    });
    const team = await seedTeamInvitation(ORG_TEAM, PERSON);
    const supplier = await seedSupplierInvitation(PERSON, INVITER);

    const response = await get(PERSON);

    expect(response.status).toBe(200);
    const body = bodyOf<Attachments>(response);
    expect(body.relationships.map((r) => r.id).sort()).toEqual([active, ended].sort());
    expect(body.team_invitations.map((i) => i.id)).toEqual([team]);
    expect(body.team_invitations[0]?.organization_name).toBe('Org Team');
    expect(body.supplier_invitations.map((i) => i.id)).toEqual([supplier]);
    expect(body.supplier_invitations[0]?.supplier_label).toBe('Chez Paul');
  });

  it('AC-2 returns three empty lists when nothing is attached', async () => {
    const response = await get(PERSON);

    expect(response.status).toBe(200);
    expect(bodyOf<Attachments>(response)).toEqual({
      relationships: [],
      team_invitations: [],
      supplier_invitations: [],
    });
  });

  it('AC-3 relationships carry the supplier label, never customer_label or supplier_notes (CM-19)', async () => {
    await seedRelationship(ORG_A, PERSON);

    const response = await get(PERSON);

    const [item] = bodyOf<Attachments>(response).relationships;
    expect(item).toMatchObject({ supplier_label: 'Mon fournisseur', balance: 0 });
    expect(item).not.toHaveProperty('customer_label');
    expect(item).not.toHaveProperty('supplier_notes');
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE-');
  });

  it('keeps PENDING invitations the person sent out of relationships', async () => {
    await seedSupplierInvitation(INVITER, PERSON);

    const response = await get(PERSON);

    expect(bodyOf<Attachments>(response).relationships).toEqual([]);
  });

  it('AC-4 caps each list at 100 items', async () => {
    const orgs = Array.from({ length: 150 }, () => newId());
    await prisma.organization.createMany({
      data: orgs.map((id, index) => ({ id, name: `Org ${index}`, status: 'ACTIVE' as const })),
    });
    await prisma.customerRelationship.createMany({
      data: orgs.map((organizationId) => ({
        id: newId(),
        supplierOrganizationId: organizationId,
        customerPersonId: PERSON,
        supplierLabel: 'Fournisseur',
        status: 'ACTIVE' as const,
        creditLimit: 0n,
        createdById: PERSON,
      })),
    });

    const response = await get(PERSON);

    expect(bodyOf<Attachments>(response).relationships).toHaveLength(100);
  });

  it('AB-1 shows person B only the items of B', async () => {
    await seedRelationship(ORG_A, PERSON);
    await seedTeamInvitation(ORG_TEAM, PERSON);
    await seedSupplierInvitation(PERSON, INVITER);
    const own = await seedRelationship(ORG_B, OTHER);

    const response = await get(OTHER);

    const body = bodyOf<Attachments>(response);
    expect(body.relationships.map((r) => r.id)).toEqual([own]);
    expect(body.team_invitations).toEqual([]);
    expect(body.supplier_invitations).toEqual([]);
  });

  it('AB-2 answers 401 without a token', async () => {
    const response = await request(app).get('/api/v1/people/me/attachments');
    expect(response.status).toBe(401);
  });
});
