import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const CUSTOMER = '0199c0b0-0000-7000-8000-000000000101';
const CUSTOMER_2 = '0199c0b0-0000-7000-8000-000000000102';
const CALLER = '0199c0b0-0000-7000-8000-000000000103';
const OTHER = '0199c0b0-0000-7000-8000-000000000104';
const SELLER = '0199c0b0-0000-7000-8000-000000000105';
const CUSTOMER_OWNER = '0199c0b0-0000-7000-8000-000000000106';
const ORG_OWNER = '0199c0b0-0000-7000-8000-000000000107';

const ORG_A = '0199c0b0-0000-7000-8000-0000000001a1';
const ORG_SELL = '0199c0b0-0000-7000-8000-0000000001a2';
const ORG_CLOSED = '0199c0b0-0000-7000-8000-0000000001a3';
const ORG_OTHER = '0199c0b0-0000-7000-8000-0000000001a4';
const ORG_CUSTOMER = '0199c0b0-0000-7000-8000-0000000001a5';
const ORG_OWN = '0199c0b0-0000-7000-8000-0000000001a6';

const REG = new Date('2026-01-01T00:00:00.000Z');

type Item = {
  id: string;
  supplier_label: string | null;
  customer: { kind: string; person?: { public_name: string | null; registered: boolean } } | null;
};
type Page = { items: Item[]; next_cursor: string | null };

async function seedPerson(id: string, phone: string, name = 'Fixture Person') {
  await prisma.person.create({
    data: {
      id,
      fullName: name,
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

async function seedInvitation(
  supplierPersonId: string,
  customer: { personId?: string; organizationId?: string } = { personId: CUSTOMER },
  label = 'Chez Paul'
) {
  const id = newId();
  await prisma.customerRelationship.create({
    data: {
      id,
      supplierPersonId,
      customerPersonId: customer.personId,
      customerOrganizationId: customer.organizationId,
      supplierLabel: label,
      status: 'PENDING',
      creditLimit: 0n,
      createdById: customer.personId ?? CUSTOMER,
    },
  });
  return id;
}

const accept = (invitationId: string, organizationId: string, personId = CALLER, id = newId()) =>
  createAuthenticatedRequest(app, personId)
    .post(`/api/v1/supplier-invitations/${invitationId}/accept`)
    .send({ id, organization_id: organizationId });

const decline = (invitationId: string, personId = CALLER, id = newId()) =>
  createAuthenticatedRequest(app, personId)
    .post(`/api/v1/supplier-invitations/${invitationId}/decline`)
    .send({ id });

const row = (id: string) => prisma.customerRelationship.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await seedPerson(CUSTOMER, '+237600009401', 'Customer One');
  await seedPerson(CUSTOMER_2, '+237600009402', 'Customer Two');
  await seedPerson(CALLER, '+237600009403');
  await seedPerson(OTHER, '+237600009404');
  await seedPerson(SELLER, '+237600009405');
  await seedPerson(CUSTOMER_OWNER, '+237600009406');
  await seedPerson(ORG_OWNER, '+237600009407');
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A', status: 'ACTIVE' } });
  await prisma.organization.create({ data: { id: ORG_SELL, name: 'Org Sell', status: 'ACTIVE' } });
  await prisma.organization.create({
    data: { id: ORG_CLOSED, name: 'Org Closed', status: 'CLOSED' },
  });
  await prisma.organization.create({
    data: { id: ORG_OTHER, name: 'Org Other', status: 'ACTIVE' },
  });
  await prisma.organization.create({
    data: { id: ORG_CUSTOMER, name: 'Customer Org', status: 'ACTIVE' },
  });
  await prisma.organization.create({ data: { id: ORG_OWN, name: 'Org Own', status: 'ACTIVE' } });
  await seedMember(ORG_A, ORG_OWNER, 'OWNER');
  await seedMember(ORG_A, CALLER, 'MANAGER');
  await seedMember(ORG_SELL, ORG_OWNER, 'OWNER');
  await seedMember(ORG_SELL, CALLER, 'SELLER');
  await seedMember(ORG_OWN, CALLER, 'OWNER');
  await seedMember(ORG_CLOSED, CALLER, 'OWNER');
  await seedMember(ORG_OTHER, OTHER, 'OWNER');
  await seedMember(ORG_CUSTOMER, CUSTOMER_OWNER, 'OWNER');
});

describe('GET /api/v1/supplier-invitations', () => {
  it('AC-1 lists the two PENDING invitations addressed to the caller, with the customer public view', async () => {
    const first = await seedInvitation(CALLER, { personId: CUSTOMER }, 'Chez Paul');
    const second = await seedInvitation(CALLER, { personId: CUSTOMER_2 }, 'Chez Marie');
    await seedInvitation(OTHER);
    const deleted = await seedInvitation(CALLER, { organizationId: ORG_OTHER });
    await prisma.customerRelationship.update({
      where: { id: deleted },
      data: { deletedAt: new Date() },
    });

    const response = await createAuthenticatedRequest(app, CALLER).get(
      '/api/v1/supplier-invitations'
    );

    expect(response.status).toBe(200);
    const page = bodyOf<Page>(response);
    expect(page.items.map((item) => item.id).sort()).toEqual([first, second].sort());
    expect(page.next_cursor).toBeNull();
    const item = page.items.find((candidate) => candidate.id === first);
    expect(item).toEqual({
      id: first,
      supplier_label: 'Chez Paul',
      customer: {
        kind: 'PERSON',
        person: { public_name: 'Customer One', phone_number: '+237600009401', registered: true },
      },
    });
  });

  it('shows nothing of another person invitations', async () => {
    await seedInvitation(OTHER);

    const response = await createAuthenticatedRequest(app, CALLER).get(
      '/api/v1/supplier-invitations'
    );

    expect(bodyOf<Page>(response).items).toEqual([]);
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/v1/supplier-invitations');
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/supplier-invitations/:id/accept', () => {
  it('AC-2 an organization the caller manages becomes the supplier: ACTIVE, no supplier person (CM-25, C-08)', async () => {
    const id = await seedInvitation(CALLER);

    const response = await accept(id, ORG_A);

    expect(response.status).toBe(200);
    const body = bodyOf<{ merged: boolean; relationship: { id: string; status: string } }>(
      response
    );
    expect(body.merged).toBe(false);
    expect(body.relationship).toMatchObject({ id, status: 'ACTIVE' });
    expect(await row(id)).toMatchObject({
      supplierOrganizationId: ORG_A,
      supplierPersonId: null,
      status: 'ACTIVE',
      deletedAt: null,
      creditLimit: 0n,
    });
    const notifications = await prisma.notification.findMany({ where: { recipientId: CUSTOMER } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      sourceEvent: 'supplier.accepted',
      relatedEntityId: id,
    });
  });

  it('an OWNER of the organization may accept too', async () => {
    const id = await seedInvitation(CALLER);

    const response = await accept(id, ORG_OWN);

    expect(response.status).toBe(200);
    expect((await row(id)).supplierOrganizationId).toBe(ORG_OWN);
  });

  it('notifies the owner when the customer is an organization', async () => {
    const id = await seedInvitation(CALLER, { organizationId: ORG_CUSTOMER });
    // The creator of an organization invitation is a registered member.
    await prisma.customerRelationship.update({
      where: { id },
      data: { createdById: CUSTOMER_OWNER },
    });

    const response = await accept(id, ORG_A);

    expect(response.status).toBe(200);
    const notifications = await prisma.notification.findMany({
      where: { recipientId: CUSTOMER_OWNER },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      sourceEvent: 'supplier.accepted',
      organizationId: ORG_CUSTOMER,
    });
  });

  it('AC-3 an existing live relationship with that customer: 200 merged true, invitation deleted (C-07)', async () => {
    const existing = newId();
    await prisma.customerRelationship.create({
      data: {
        id: existing,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        status: 'ACTIVE',
        createdById: CUSTOMER,
      },
    });
    const id = await seedInvitation(CALLER);

    const response = await accept(id, ORG_A);

    expect(response.status).toBe(200);
    expect(bodyOf<unknown>(response)).toEqual({ merged: true });
    const invitation = await row(id);
    expect(invitation.deletedAt).not.toBeNull();
    expect(invitation.supplierOrganizationId).toBeNull();
    expect(await row(existing)).toMatchObject({ deletedAt: null, status: 'ACTIVE' });
    expect(
      await prisma.customerRelationship.count({
        where: { supplierOrganizationId: ORG_A, deletedAt: null },
      })
    ).toBe(1);
  });

  it('AC-3 a deleted relationship with that customer does not merge (C-07)', async () => {
    await prisma.customerRelationship.create({
      data: {
        id: newId(),
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        status: 'ACTIVE',
        createdById: CUSTOMER,
        deletedAt: new Date(),
      },
    });
    const id = await seedInvitation(CALLER);

    const response = await accept(id, ORG_A);

    expect(response.status).toBe(200);
    expect(bodyOf<{ merged: boolean }>(response).merged).toBe(false);
    expect((await row(id)).status).toBe('ACTIVE');
  });

  it('answers the first response again for a repeated gesture id and changes nothing', async () => {
    const id = await seedInvitation(CALLER);
    const gestureId = newId();

    const first = await accept(id, ORG_A, CALLER, gestureId);
    const second = await accept(id, ORG_A, CALLER, gestureId);

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(await prisma.notification.count({ where: { recipientId: CUSTOMER } })).toBe(1);
  });

  it('an invitation already accepted is not found for a second accept', async () => {
    const id = await seedInvitation(CALLER);
    expect((await accept(id, ORG_A)).status).toBe(200);

    const again = await accept(id, ORG_A);

    expect(again.status).toBe(404);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('AC-5 refuses an organization the caller only sells for: 403, nothing changes', async () => {
    const id = await seedInvitation(CALLER);

    const response = await accept(id, ORG_SELL);

    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await row(id)).toMatchObject({ status: 'PENDING', supplierPersonId: CALLER });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AC-5 refuses an organization the caller is not a member of: 404', async () => {
    const id = await seedInvitation(CALLER);

    const response = await accept(id, ORG_OTHER);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await row(id)).toMatchObject({ status: 'PENDING', supplierPersonId: CALLER });
  });

  it('AC-5 refuses a CLOSED organization: 409 ORGANIZATION_NOT_ACTIVE', async () => {
    const id = await seedInvitation(CALLER);

    const response = await accept(id, ORG_CLOSED);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
    expect(await row(id)).toMatchObject({ status: 'PENDING', supplierPersonId: CALLER });
  });

  it('refuses a SUSPENDED organization: 409 ORGANIZATION_NOT_ACTIVE', async () => {
    const id = await seedInvitation(CALLER);
    await prisma.organization.update({ where: { id: ORG_A }, data: { status: 'SUSPENDED' } });

    const response = await accept(id, ORG_A);

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('ORGANIZATION_NOT_ACTIVE');
  });

  it('AC-5 refuses an invitation addressed to someone else: 404', async () => {
    const id = await seedInvitation(OTHER);

    const response = await accept(id, ORG_A);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('refuses an unknown invitation id: 404', async () => {
    const response = await accept(newId(), ORG_A);
    expect(response.status).toBe(404);
  });

  it('rejects unknown body fields and a malformed organization id: 400, nothing changes', async () => {
    const id = await seedInvitation(CALLER);

    const unknown = await createAuthenticatedRequest(app, CALLER)
      .post(`/api/v1/supplier-invitations/${id}/accept`)
      .send({ id: newId(), organization_id: ORG_A, status: 'ACTIVE' });
    const malformed = await accept(id, 'not-a-uuid');
    const badPath = await accept('not-a-uuid', ORG_A);

    expect(unknown.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(badPath.status).toBe(400);
    expect((await row(id)).status).toBe('PENDING');
  });

  it('requires authentication', async () => {
    const response = await request(app)
      .post(`/api/v1/supplier-invitations/${newId()}/accept`)
      .send({ id: newId(), organization_id: ORG_A });
    expect(response.status).toBe(401);
  });

  it('AB-1 another person cannot take the invitation: 404, it stays PENDING', async () => {
    const id = await seedInvitation(OTHER);
    await seedMember(ORG_A, SELLER, 'MANAGER');

    const response = await accept(id, ORG_A, SELLER);

    expect(response.status).toBe(404);
    expect(await row(id)).toMatchObject({ status: 'PENDING', supplierPersonId: OTHER });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('AB-2 a SELLER of the organization cannot accept: 403', async () => {
    const id = await seedInvitation(CALLER);

    const response = await accept(id, ORG_SELL);

    expect(response.status).toBe(403);
    expect((await row(id)).status).toBe('PENDING');
  });
});

describe('POST /api/v1/supplier-invitations/:id/decline', () => {
  it('AC-4 deletes the invitation and notifies the customer supplier.declined', async () => {
    const id = await seedInvitation(CALLER);

    const response = await decline(id);

    expect(response.status).toBe(200);
    const invitation = await row(id);
    expect(invitation.deletedAt).not.toBeNull();
    expect(invitation.status).toBe('PENDING');
    const notifications = await prisma.notification.findMany({ where: { recipientId: CUSTOMER } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      sourceEvent: 'supplier.declined',
      relatedEntityId: id,
    });
    const list = await createAuthenticatedRequest(app, CALLER).get('/api/v1/supplier-invitations');
    expect(bodyOf<Page>(list).items).toEqual([]);
  });

  it('a declined invitation does not block a new one for the same pair (C-07)', async () => {
    const id = await seedInvitation(CALLER);
    expect((await decline(id)).status).toBe(200);

    await expect(seedInvitation(CALLER)).resolves.toBeTypeOf('string');
  });

  it('AB-1 another person cannot decline it: 404, it stays PENDING, nobody is notified', async () => {
    const id = await seedInvitation(OTHER);

    const response = await decline(id);

    expect(response.status).toBe(404);
    expect((await row(id)).deletedAt).toBeNull();
    expect(await prisma.notification.count()).toBe(0);
  });

  it('a second decline answers 404 and notifies once', async () => {
    const id = await seedInvitation(CALLER);
    expect((await decline(id)).status).toBe(200);

    const again = await decline(id);

    expect(again.status).toBe(404);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('a repeated gesture id answers the first response again', async () => {
    const id = await seedInvitation(CALLER);
    const gestureId = newId();

    const first = await decline(id, CALLER, gestureId);
    const second = await decline(id, CALLER, gestureId);

    expect(second.status).toBe(first.status);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('refuses an ACTIVE relationship the caller no longer holds as a person: 404', async () => {
    const id = await seedInvitation(CALLER);
    expect((await accept(id, ORG_A)).status).toBe(200);

    const response = await decline(id);

    expect(response.status).toBe(404);
    expect((await row(id)).deletedAt).toBeNull();
  });

  it('rejects unknown body fields: 400', async () => {
    const id = await seedInvitation(CALLER);

    const response = await createAuthenticatedRequest(app, CALLER)
      .post(`/api/v1/supplier-invitations/${id}/decline`)
      .send({ id: newId(), reason: 'x' });

    expect(response.status).toBe(400);
    expect((await row(id)).deletedAt).toBeNull();
  });
});
