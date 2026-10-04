import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';
import { newId } from '../../../src/shared/ids.js';

const PERSON = '0199c0a1-0000-7000-8000-000000000001';
const OTHER = '0199c0a1-0000-7000-8000-000000000002';
const SUPPLIER_OWNER = '0199c0a1-0000-7000-8000-000000000003';

const SUPPLIER_ORG = '0199c0a1-0000-7000-8000-0000000000a1';
const SECOND_ORG = '0199c0a1-0000-7000-8000-0000000000a2';
const REG = new Date('2026-01-01T00:00:00.000Z');
const URL = '/api/v1/users/me/deletion-check';

type Check = { can_delete: boolean; blockers: Array<{ code: string; label: string }> };

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

async function seedOrg(
  id: string,
  name: string,
  ownerId: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' = 'ACTIVE'
) {
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: { id, name, status } });
    await tx.collaboration.create({
      data: {
        id: newId(),
        personId: ownerId,
        organizationId: id,
        role: 'OWNER',
        status: 'ACTIVE',
        acceptedAt: REG,
      },
    });
  });
}

async function seedMember(orgId: string, personId: string, role: 'MANAGER' | 'SELLER') {
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

async function seedRelationship(customerPersonId: string, balance: bigint, orgId = SUPPLIER_ORG) {
  await prisma.customerRelationship.create({
    data: {
      id: newId(),
      supplierOrganizationId: orgId,
      customerPersonId,
      creditLimit: 0n,
      balance,
      createdById: SUPPLIER_OWNER,
    },
  });
}

const check = (personId = PERSON) => createAuthenticatedRequest(app, personId).get(URL);

beforeEach(async () => {
  await seedPerson(PERSON, '+237600170001');
  await seedPerson(OTHER, '+237600170002');
  await seedPerson(SUPPLIER_OWNER, '+237600170003');
  await seedOrg(SUPPLIER_ORG, 'Grossiste Mbarga', SUPPLIER_OWNER);
});

describe('GET /api/v1/users/me/deletion-check', () => {
  it('AC-1: nothing blocks', async () => {
    const response = await check();

    expect(response.status).toBe(200);
    expect(bodyOf<Check>(response)).toEqual({ can_delete: true, blockers: [] });
  });

  it('AC-2: a positive balance blocks and names the supplier', async () => {
    await seedRelationship(PERSON, 5000n);

    const response = await check();

    expect(response.status).toBe(200);
    expect(bodyOf<Check>(response)).toEqual({
      can_delete: false,
      blockers: [{ code: 'POSITIVE_BALANCE', label: 'Grossiste Mbarga' }],
    });
  });

  it('AC-3: a zero or negative balance does not block', async () => {
    await seedOrg(SECOND_ORG, 'Grossiste Eto', SUPPLIER_OWNER);
    await seedRelationship(PERSON, 0n);
    await seedRelationship(PERSON, -3000n, SECOND_ORG);

    expect(bodyOf<Check>(await check())).toEqual({ can_delete: true, blockers: [] });
  });

  it('AC-3: owning a CLOSED organization does not block', async () => {
    await seedOrg('0199c0a1-0000-7000-8000-0000000000b1', 'Ancienne Boutique', PERSON, 'CLOSED');

    expect(bodyOf<Check>(await check())).toEqual({ can_delete: true, blockers: [] });
  });

  it('AC-3: a MANAGER role in an organization does not block', async () => {
    await seedMember(SUPPLIER_ORG, PERSON, 'MANAGER');

    expect(bodyOf<Check>(await check())).toEqual({ can_delete: true, blockers: [] });
  });

  it('AC-4: owning an ACTIVE organization blocks and names it', async () => {
    await seedOrg('0199c0a1-0000-7000-8000-0000000000b2', 'Boutique Fotso', PERSON);

    const response = await check();

    expect(bodyOf<Check>(response)).toEqual({
      can_delete: false,
      blockers: [{ code: 'OWNS_ORGANIZATION', label: 'Boutique Fotso' }],
    });
  });

  it('owning a SUSPENDED organization blocks', async () => {
    await seedOrg(
      '0199c0a1-0000-7000-8000-0000000000b3',
      'Boutique Suspendue',
      PERSON,
      'SUSPENDED'
    );

    expect(bodyOf<Check>(await check()).blockers).toEqual([
      { code: 'OWNS_ORGANIZATION', label: 'Boutique Suspendue' },
    ]);
  });

  it('AB-1: only the caller own relationships and organizations are considered', async () => {
    await seedRelationship(OTHER, 9000n);
    await seedOrg('0199c0a1-0000-7000-8000-0000000000b4', 'Boutique Autre', OTHER);

    expect(bodyOf<Check>(await check())).toEqual({ can_delete: true, blockers: [] });
    expect(bodyOf<Check>(await check(OTHER)).blockers).toHaveLength(2);
  });

  it('AB-2: no token is rejected with 401', async () => {
    const response = await request(app).get(URL);

    expect(response.status).toBe(401);
  });
});
