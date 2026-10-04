import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0a7-0000-7000-8000-000000000001';
const MANAGER = '0199c0a7-0000-7000-8000-000000000002';
const SELLER = '0199c0a7-0000-7000-8000-000000000003';
const DRIVER = '0199c0a7-0000-7000-8000-000000000004';
const OTHER_OWNER = '0199c0a7-0000-7000-8000-000000000005';
const CUSTOMER = '0199c0a7-0000-7000-8000-000000000006';

const ORG_A = '0199c0a7-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0a7-0000-7000-8000-0000000000b1';

const REL = '0199c0a7-0000-7000-8000-0000000000d1';
const OTHER_REL = '0199c0a7-0000-7000-8000-0000000000d2';
const FOREIGN = '0199c0a7-0000-7000-8000-0000000000d6';

const REG = new Date('2026-01-01T00:00:00.000Z');

type ChangeBody = {
  previous_limit: number | null;
  new_limit: number | null;
  set_by_id: string;
  set_at: string;
};
type PageBody = { items: ChangeBody[]; next_cursor: string | null };

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
  suffix: number
) {
  await prisma.collaboration.create({
    data: {
      id: orgId.slice(0, -3) + orgId.slice(-2, -1) + suffix + '5',
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
  await seedMember(id, ownerId, 'OWNER', 9);
}

function seedRelationship(
  id: string,
  supplierOrganizationId: string,
  createdById: string,
  customer: { customerPersonId: string } | { customerLabel: string } = {
    customerPersonId: CUSTOMER,
  }
) {
  return prisma.customerRelationship.create({
    data: {
      id,
      supplierOrganizationId,
      ...customer,
      createdById,
      creditLimit: 0n,
      status: 'ACTIVE',
    },
  });
}

/** Seeds `count` journal rows on a relationship, one minute apart, limits 1000, 2000, ... */
async function seedChanges(relationshipId: string, count: number, setById = OWNER) {
  for (let i = 1; i <= count; i += 1) {
    await prisma.creditLimitChange.create({
      data: {
        id: `0199c0a7-0000-7000-8000-00000000e${relationshipId.slice(-1)}0${i}`,
        customerRelationshipId: relationshipId,
        previousLimit: BigInt((i - 1) * 1000),
        newLimit: BigInt(i * 1000),
        setById,
        setAt: new Date(REG.getTime() + i * 60_000),
      },
    });
  }
}

function history(relationshipId: string, personId = OWNER, organizationId = ORG_A, query = '') {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${organizationId}/customers/${relationshipId}/credit-limit-changes${query}`
  );
}

beforeEach(async () => {
  await seedPerson(OWNER, '+237600010001');
  await seedPerson(MANAGER, '+237600010002');
  await seedPerson(SELLER, '+237600010003');
  await seedPerson(DRIVER, '+237600010004');
  await seedPerson(OTHER_OWNER, '+237600010005');
  await seedPerson(CUSTOMER, '+237600010006');
  await seedOrg(ORG_A, OWNER);
  await seedMember(ORG_A, MANAGER, 'MANAGER', 1);
  await seedMember(ORG_A, SELLER, 'SELLER', 2);
  await seedMember(ORG_A, DRIVER, 'DRIVER', 3);
  await seedOrg(ORG_B, OTHER_OWNER);
  await seedRelationship(REL, ORG_A, OWNER);
  await seedRelationship(OTHER_REL, ORG_A, OWNER, { customerLabel: 'Comptoir' });
  await seedRelationship(FOREIGN, ORG_B, OTHER_OWNER);
});

describe('GET /api/v1/organizations/:organizationId/customers/:relationshipId/credit-limit-changes', () => {
  it('AC-1 history: three items newest first, with the four listed fields only', async () => {
    await seedChanges(REL, 3);
    await seedChanges(OTHER_REL, 2);

    const response = await history(REL);

    expect(response.status).toBe(200);
    const body = bodyOf<PageBody>(response);
    expect(body.items.map((item) => item.new_limit)).toEqual([3000, 2000, 1000]);
    expect(body.items[0]).toEqual({
      previous_limit: 2000,
      new_limit: 3000,
      set_by_id: OWNER,
      set_at: new Date(REG.getTime() + 3 * 60_000).toISOString(),
    });
    expect(body.next_cursor).toBeNull();
  });

  it('returns an empty page, and null limits as null, when nothing or no ceiling was set', async () => {
    expect(bodyOf<PageBody>(await history(REL)).items).toEqual([]);
    await prisma.creditLimitChange.create({
      data: {
        id: '0199c0a7-0000-7000-8000-00000000e001',
        customerRelationshipId: REL,
        previousLimit: 5000n,
        newLimit: null,
        setById: OWNER,
      },
    });

    const [item] = bodyOf<PageBody>(await history(REL)).items;
    expect(item).toMatchObject({ previous_limit: 5000, new_limit: null });
  });

  it.each([
    ['OWNER', OWNER, 200],
    ['MANAGER', MANAGER, 200],
    ['SELLER', SELLER, 403],
    ['DRIVER', DRIVER, 403],
  ])('AC-2 roles: %s answers %s', async (_role, personId, status) => {
    await seedChanges(REL, 1);

    const response = await history(REL, personId);

    expect(response.status).toBe(status);
    if (status === 403) expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
  });

  it('AC-3 paging: pages of 2, 2 and 1 with cursors, no repeat', async () => {
    await seedChanges(REL, 5);

    const first = bodyOf<PageBody>(await history(REL, OWNER, ORG_A, '?limit=2'));
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();
    const second = bodyOf<PageBody>(
      await history(REL, OWNER, ORG_A, `?limit=2&cursor=${first.next_cursor}`)
    );
    expect(second.items).toHaveLength(2);
    expect(second.next_cursor).not.toBeNull();
    const third = bodyOf<PageBody>(
      await history(REL, OWNER, ORG_A, `?limit=2&cursor=${second.next_cursor}`)
    );
    expect(third.items).toHaveLength(1);
    expect(third.next_cursor).toBeNull();

    const limits = [...first.items, ...second.items, ...third.items].map((i) => i.new_limit);
    expect(limits).toEqual([5000, 4000, 3000, 2000, 1000]);
  });

  it('rejects a malformed cursor, an unknown query field and a malformed id with 400', async () => {
    expect((await history(REL, OWNER, ORG_A, '?cursor=not-a-cursor')).status).toBe(400);
    expect((await history(REL, OWNER, ORG_A, '?foo=1')).status).toBe(400);
    expect((await history('not-an-id')).status).toBe(400);
  });

  it('AB-1 other business: 404 for a relationship of B, indistinguishable from an absent id', async () => {
    await seedChanges(FOREIGN, 2, OTHER_OWNER);

    const foreign = await history(FOREIGN, OWNER, ORG_A);
    const absent = await history('0199c0a7-0000-7000-8000-0000000000ff', OWNER, ORG_A);

    expect(foreign.status).toBe(404);
    expect(bodyOf<ErrorBody>(foreign).error.code).toBe('NOT_FOUND');
    expect(absent.status).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toContain('1000');
  });

  it('AB-1 other business: a member of A cannot read through the organization B path', async () => {
    await seedChanges(FOREIGN, 2, OTHER_OWNER);

    expect((await history(FOREIGN, OWNER, ORG_B)).status).toBe(404);
  });
});
