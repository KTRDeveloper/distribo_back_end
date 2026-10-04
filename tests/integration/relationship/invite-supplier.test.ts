import { beforeEach, describe, expect, it, vi } from 'vitest';

const limiter = vi.hoisted(() => ({ counts: new Map<string, number>(), keys: [] as string[] }));

vi.mock('../../../src/lib/rate-limit.js', () => ({
  checkAndConsume: vi.fn((key: string, limit: number) => {
    limiter.keys.push(key);
    const count = (limiter.counts.get(key) ?? 0) + 1;
    limiter.counts.set(key, count);
    return Promise.resolve({ allowed: count <= limit, remaining: Math.max(limit - count, 0) });
  }),
}));

import request from 'supertest';
import { app } from '../../../src/app.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const CUSTOMER = '0199c0b0-0000-7000-8000-000000000001';
const OWNER = '0199c0b0-0000-7000-8000-000000000002';
const MANAGER = '0199c0b0-0000-7000-8000-000000000003';
const SELLER = '0199c0b0-0000-7000-8000-000000000004';
const DRIVER = '0199c0b0-0000-7000-8000-000000000005';
const OUTSIDER = '0199c0b0-0000-7000-8000-000000000006';
const PUBLIC_OWNER = '0199c0b0-0000-7000-8000-000000000007';
const KNOWN = '0199c0b0-0000-7000-8000-000000000008';

const ORG_A = '0199c0b0-0000-7000-8000-0000000000a1';
const ORG_PUBLIC = '0199c0b0-0000-7000-8000-0000000000a2';

const REG = new Date('2026-01-01T00:00:00.000Z');
const PHONE = '+237677123456';
const PUBLIC_PHONE = '+237600009307';

type View = {
  id: string;
  status: string;
  supplier: { kind: string; person?: { registered: boolean } } | null;
  supplier_label: string | null;
  credit_limit: number | null;
  customer_label?: string;
  supplier_notes?: string;
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

async function seedMember(
  orgId: string,
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER',
  isPublicContact = false
) {
  await prisma.collaboration.create({
    data: {
      id: newId(),
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
      isPublicContact,
    },
  });
}

function personInvite(body: unknown, personId = CUSTOMER) {
  return createAuthenticatedRequest(app, personId)
    .post('/api/v1/suppliers/invitations')
    .send(body as object);
}

function orgInvite(body: unknown, personId = MANAGER, organizationId = ORG_A) {
  return createAuthenticatedRequest(app, personId)
    .post(`/api/v1/organizations/${organizationId}/suppliers/invitations`)
    .send(body as object);
}

const validBody = (overrides: Record<string, unknown> = {}) => ({
  id: newId(),
  phone_number: PHONE,
  supplier_label: 'Chez Paul',
  ...overrides,
});

const relationshipCount = () => prisma.customerRelationship.count();

beforeEach(async () => {
  limiter.counts.clear();
  limiter.keys.length = 0;
  await seedPerson(CUSTOMER, '+237600009301');
  await seedPerson(OWNER, '+237600009302');
  await seedPerson(MANAGER, '+237600009303');
  await seedPerson(SELLER, '+237600009304');
  await seedPerson(DRIVER, '+237600009305');
  await seedPerson(OUTSIDER, '+237600009306');
  await seedPerson(PUBLIC_OWNER, PUBLIC_PHONE);
  await prisma.organization.create({ data: { id: ORG_A, name: 'Org A', status: 'ACTIVE' } });
  await seedMember(ORG_A, OWNER, 'OWNER');
  await seedMember(ORG_A, MANAGER, 'MANAGER');
  await seedMember(ORG_A, SELLER, 'SELLER');
  await seedMember(ORG_A, DRIVER, 'DRIVER');
  // A business that publishes PUBLIC_PHONE as its contact number.
  await prisma.organization.create({
    data: { id: ORG_PUBLIC, name: 'Public Org', status: 'ACTIVE' },
  });
  await seedMember(ORG_PUBLIC, PUBLIC_OWNER, 'OWNER', true);
});

describe('POST /api/v1/suppliers/invitations', () => {
  it('AC-1 a person invites a supplier: PENDING, supplier person set, limit 0 (C-06, C-08, C-10)', async () => {
    const response = await personInvite(validBody());

    expect(response.status).toBe(201);
    const view = bodyOf<View>(response);
    expect(view.status).toBe('PENDING');
    expect(view.supplier_label).toBe('Chez Paul');
    expect(view.credit_limit).toBe(0);
    expect(view.supplier?.kind).toBe('PERSON');
    expect(view.supplier?.person?.registered).toBe(false);
    // Customer projection: the supplier's own fields never leave (CM-19).
    expect(view).not.toHaveProperty('customer_label');
    expect(view).not.toHaveProperty('supplier_notes');

    const guest = await prisma.person.findFirstOrThrow({ where: { phoneNumber: PHONE } });
    expect(guest.registeredAt).toBeNull();
    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: view.id } });
    expect(row).toMatchObject({
      supplierPersonId: guest.id,
      supplierOrganizationId: null,
      customerPersonId: CUSTOMER,
      customerOrganizationId: null,
      customerPhoneNumber: null,
      supplierLabel: 'Chez Paul',
      status: 'PENDING',
      creditLimit: 0n,
      creditLimitSetById: null,
      createdById: CUSTOMER,
    });
    expect(await prisma.creditLimitChange.count()).toBe(0);
  });

  it('AC-1 reuses the person who already owns the number', async () => {
    await seedPerson(KNOWN, PHONE);

    const response = await personInvite(validBody());

    expect(response.status).toBe(201);
    const row = await prisma.customerRelationship.findFirstOrThrow();
    expect(row.supplierPersonId).toBe(KNOWN);
    expect(await prisma.person.count({ where: { phoneNumber: PHONE } })).toBe(1);
  });

  it('normalizes the number before looking it up', async () => {
    const response = await personInvite(validBody({ phone_number: '6 77 12 34 56' }));

    expect(response.status).toBe(201);
    expect(await prisma.person.count({ where: { phoneNumber: PHONE } })).toBe(1);
  });

  it('AC-3 refuses a public number of an organization: 409, nothing stored', async () => {
    const before = await prisma.person.count();

    const response = await personInvite(validBody({ phone_number: PUBLIC_PHONE }));

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NUMBER_IS_ORGANIZATION');
    expect(await relationshipCount()).toBe(0);
    expect(await prisma.person.count()).toBe(before);
  });

  it('AC-3 refuses the number of an existing live relationship: 409, one row only', async () => {
    expect((await personInvite(validBody())).status).toBe(201);

    const second = await personInvite(validBody({ supplier_label: 'Autre nom' }));

    expect(second.status).toBe(409);
    expect(bodyOf<ErrorBody>(second).error.code).toBe('RELATIONSHIP_EXISTS');
    expect(await relationshipCount()).toBe(1);
    expect((await prisma.customerRelationship.findFirstOrThrow()).supplierLabel).toBe('Chez Paul');
  });

  it('AC-3 a deleted relationship does not block a new invitation (C-07)', async () => {
    const first = bodyOf<View>(await personInvite(validBody()));
    await prisma.customerRelationship.update({
      where: { id: first.id },
      data: { status: 'PENDING', deletedAt: new Date() },
    });

    const again = await personInvite(validBody());

    expect(again.status).toBe(201);
    expect(await relationshipCount()).toBe(2);
  });

  it('AC-3 refuses a landline and an unusable number: 400, nothing stored', async () => {
    for (const phone_number of ['+237222123456', 'abc', '']) {
      const response = await personInvite(validBody({ phone_number }));
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    expect(await relationshipCount()).toBe(0);
  });

  it('AC-3 refuses an empty or blank supplier_label: 400, nothing stored', async () => {
    for (const supplier_label of ['', '   ']) {
      const response = await personInvite(validBody({ supplier_label }));
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    const missing = await personInvite({ id: newId(), phone_number: PHONE });
    expect(missing.status).toBe(400);
    expect(await relationshipCount()).toBe(0);
  });

  it('AC-4 the 61st invitation of one hour answers 429 and stores nothing', async () => {
    limiter.counts.set(`lookup:${CUSTOMER}`, 59);

    const sixtieth = await personInvite(validBody());
    const sixtyFirst = await personInvite(validBody({ phone_number: '+237677123457' }));

    expect(sixtieth.status).toBe(201);
    expect(sixtyFirst.status).toBe(429);
    expect(bodyOf<ErrorBody>(sixtyFirst).error.code).toBe('RATE_LIMITED');
    expect(await relationshipCount()).toBe(1);
    expect(limiter.keys).toEqual([`lookup:${CUSTOMER}`, `lookup:${CUSTOMER}`]);
  });

  it('AB-2 probing: lookups already spent the shared allowance, so an invitation is refused', async () => {
    limiter.counts.set(`lookup:${CUSTOMER}`, 60);

    const response = await personInvite(validBody());

    expect(response.status).toBe(429);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('RATE_LIMITED');
    expect(await relationshipCount()).toBe(0);
    expect(await prisma.person.count({ where: { phoneNumber: PHONE } })).toBe(0);
  });

  it('AB-1 a pending supplier is inert: PENDING and no credit', async () => {
    const view = bodyOf<View>(await personInvite(validBody()));

    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.status).toBe('PENDING');
    expect(row.creditLimit).toBe(0n);
    expect(row.balance).toBe(0n);
    expect(await prisma.order.count()).toBe(0);
  });

  it('AB-3 refuses server-owned fields: 400, nothing stored', async () => {
    for (const extra of [
      { status: 'ACTIVE' },
      { credit_limit: 500000 },
      { supplier_organization_id: ORG_A },
      { customer_person_id: OUTSIDER },
    ]) {
      const response = await personInvite(validBody(extra));
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
    expect(await relationshipCount()).toBe(0);
  });

  it('a repeat with the same gesture id changes nothing and returns the first response', async () => {
    const body = validBody();

    const first = await personInvite(body);
    const repeat = await personInvite(body);

    expect(first.status).toBe(201);
    expect(repeat.status).toBe(201);
    expect(repeat.body).toEqual(first.body);
    expect(await relationshipCount()).toBe(1);
  });

  it('requires authentication', async () => {
    const response = await request(app).post('/api/v1/suppliers/invitations').send(validBody());

    expect(response.status).toBe(401);
    expect(await relationshipCount()).toBe(0);
  });
});

describe('POST /api/v1/organizations/:organizationId/suppliers/invitations', () => {
  it('AC-2 a MANAGER invites on behalf of the organization: it is the customer', async () => {
    const response = await orgInvite(validBody());

    expect(response.status).toBe(201);
    const view = bodyOf<View>(response);
    expect(view.status).toBe('PENDING');
    expect(view.credit_limit).toBe(0);
    const row = await prisma.customerRelationship.findUniqueOrThrow({ where: { id: view.id } });
    expect(row).toMatchObject({
      customerOrganizationId: ORG_A,
      customerPersonId: null,
      supplierOrganizationId: null,
      status: 'PENDING',
      creditLimit: 0n,
      createdById: MANAGER,
    });
    expect(row.supplierPersonId).not.toBeNull();
  });

  it('AC-2 an OWNER invites on behalf of the organization', async () => {
    const response = await orgInvite(validBody(), OWNER);

    expect(response.status).toBe(201);
    const row = await prisma.customerRelationship.findFirstOrThrow();
    expect(row.customerOrganizationId).toBe(ORG_A);
    expect(row.createdById).toBe(OWNER);
  });

  it('AC-3 a SELLER or a DRIVER is refused with 403, nothing stored', async () => {
    for (const personId of [SELLER, DRIVER]) {
      const response = await orgInvite(validBody(), personId);
      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    }
    expect(await relationshipCount()).toBe(0);
    expect(await prisma.person.count({ where: { phoneNumber: PHONE } })).toBe(0);
  });

  it('answers 404 to a person who is not a member of the organization (v5.0.0-8.2.2)', async () => {
    const response = await orgInvite(validBody(), OUTSIDER);

    expect(response.status).toBe(404);
    expect(await relationshipCount()).toBe(0);
  });

  it('AC-3 refuses a public number of an organization: 409', async () => {
    const response = await orgInvite(validBody({ phone_number: PUBLIC_PHONE }));

    expect(response.status).toBe(409);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NUMBER_IS_ORGANIZATION');
    expect(await relationshipCount()).toBe(0);
  });

  it('AC-3 refuses the number of an existing live relationship of the organization: 409', async () => {
    expect((await orgInvite(validBody())).status).toBe(201);

    const second = await orgInvite(validBody(), OWNER);

    expect(second.status).toBe(409);
    expect(bodyOf<ErrorBody>(second).error.code).toBe('RELATIONSHIP_EXISTS');
    expect(await relationshipCount()).toBe(1);
  });

  it('a person and an organization may each invite the same number (distinct pairs)', async () => {
    expect((await personInvite(validBody())).status).toBe(201);

    const response = await orgInvite(validBody());

    expect(response.status).toBe(201);
    expect(await relationshipCount()).toBe(2);
  });

  it('AC-4 the 61st invitation shares the per-person limit and answers 429', async () => {
    limiter.counts.set(`lookup:${MANAGER}`, 59);

    const sixtieth = await orgInvite(validBody());
    const sixtyFirst = await orgInvite(validBody({ phone_number: '+237677123457' }));

    expect(sixtieth.status).toBe(201);
    expect(sixtyFirst.status).toBe(429);
    expect(bodyOf<ErrorBody>(sixtyFirst).error.code).toBe('RATE_LIMITED');
    expect(await relationshipCount()).toBe(1);
  });

  it('AB-3 refuses server-owned fields: 400, nothing stored', async () => {
    for (const extra of [
      { status: 'ACTIVE' },
      { credit_limit: 1 },
      { customer_organization_id: ORG_PUBLIC },
    ]) {
      const response = await orgInvite(validBody(extra));
      expect(response.status).toBe(400);
    }
    expect(await relationshipCount()).toBe(0);
  });

  it('a refused role does not spend the lookup allowance', async () => {
    await orgInvite(validBody(), SELLER);

    expect(limiter.keys).toEqual([]);
  });
});
