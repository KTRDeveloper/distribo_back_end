import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { projectForDriver } from '../../../src/modules/relationship/relationship.visibility.js';
import { newId } from '../../../src/shared/ids.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const OWNER = '0199c0a8-0000-7000-8000-000000000001';
const SELLER = '0199c0a8-0000-7000-8000-000000000002';
const ME = '0199c0a8-0000-7000-8000-000000000011';
const OTHER = '0199c0a8-0000-7000-8000-000000000012';

const ORG_A = '0199c0a8-0000-7000-8000-0000000000a1';
const ORG_B = '0199c0a8-0000-7000-8000-0000000000b1';
const ORG_C = '0199c0a8-0000-7000-8000-0000000000c1';

const REG = new Date('2026-01-01T00:00:00.000Z');
const MARK = new Date('2026-03-01T10:00:00.000Z');

type Item = { id: string; status: string; balance: number; contested_at: string | null };
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
      createdById: OWNER,
      creditLimit: 0n,
      createdAt: new Date(createdAt),
      ...over,
    },
  });
}

function suppliers(query = '', personId = ME) {
  return createAuthenticatedRequest(app, personId).get(`/api/v1/suppliers${query}`);
}

let contestedId: string;
let plainId: string;
let endedContestedId: string;
let otherContestedId: string;

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009001');
  await seedPerson(SELLER, '+237600009002');
  await seedPerson(ME, '+237600009011');
  await seedPerson(OTHER, '+237600009012');
  await seedOrg(ORG_A, OWNER);
  await seedOrg(ORG_B, OWNER);
  await seedOrg(ORG_C, OWNER);
  await prisma.collaboration.create({
    data: {
      id: '0199c0a8-0000-7000-8000-0000000000a2',
      personId: SELLER,
      organizationId: ORG_A,
      role: 'SELLER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });

  contestedId = (
    await seedRelationship(
      {
        supplierOrganizationId: ORG_A,
        customerPersonId: ME,
        customerLabel: 'Contested one',
        balance: 7000n,
        contestedAt: MARK,
      },
      '2026-02-01T00:00:00.000Z'
    )
  ).id;
  plainId = (
    await seedRelationship(
      { supplierOrganizationId: ORG_B, customerPersonId: ME, balance: 100n },
      '2026-02-02T00:00:00.000Z'
    )
  ).id;
  endedContestedId = (
    await seedRelationship(
      {
        supplierOrganizationId: ORG_C,
        customerPersonId: ME,
        status: 'ENDED',
        endedByParty: 'SUPPLIER',
        contestedAt: MARK,
      },
      '2026-02-03T00:00:00.000Z'
    )
  ).id;
  otherContestedId = (
    await seedRelationship(
      { supplierOrganizationId: ORG_A, customerPersonId: OTHER, contestedAt: MARK },
      '2026-02-04T00:00:00.000Z'
    )
  ).id;
});

describe('supplier side', () => {
  it('AC-1 the list and the single read show the contested record with its balance', async () => {
    const list = await createAuthenticatedRequest(app, SELLER).get(
      `/api/v1/organizations/${ORG_A}/customers`
    );
    expect(list.status).toBe(200);
    const items = bodyOf<Page>(list).items;
    const listed = items.find((i) => i.id === contestedId);
    expect(listed).toMatchObject({ balance: 7000, contested_at: MARK.toISOString() });

    const one = await createAuthenticatedRequest(app, SELLER).get(
      `/api/v1/organizations/${ORG_A}/customers/${contestedId}`
    );
    expect(one.status).toBe(200);
    expect(bodyOf<Item>(one)).toMatchObject({ balance: 7000, contested_at: MARK.toISOString() });
  });

  it('shows contested_at null for an uncontested record', async () => {
    await prisma.customerRelationship.update({
      where: { id: contestedId },
      data: { contestedAt: null },
    });
    const one = await createAuthenticatedRequest(app, SELLER).get(
      `/api/v1/organizations/${ORG_A}/customers/${contestedId}`
    );
    expect(bodyOf<Item>(one).contested_at).toBeNull();
  });
});

describe('customer side', () => {
  it('AC-2 the default list hides the contested records and shows contested_at null', async () => {
    const response = await suppliers();
    expect(response.status).toBe(200);
    const items = bodyOf<Page>(response).items;
    expect(items.map((i) => i.id)).toEqual([plainId]);
    expect(items[0]?.contested_at).toBeNull();
  });

  it('AC-2 contested=false behaves like the default', async () => {
    const items = bodyOf<Page>(await suppliers('?contested=false')).items;
    expect(items.map((i) => i.id)).toEqual([plainId]);
  });

  it('AC-3 contested=true lists only the contested records, newest first', async () => {
    const items = bodyOf<Page>(await suppliers('?contested=true')).items;
    expect(items.map((i) => i.id)).toEqual([endedContestedId, contestedId]);
    for (const item of items) expect(item.contested_at).toBe(MARK.toISOString());
  });

  it('AC-3 status combines with contested and the paging works', async () => {
    const ended = bodyOf<Page>(await suppliers('?contested=true&status=ENDED')).items;
    expect(ended.map((i) => i.id)).toEqual([endedContestedId]);

    const first = bodyOf<Page>(await suppliers('?contested=true&limit=1'));
    expect(first.items.map((i) => i.id)).toEqual([endedContestedId]);
    expect(first.next_cursor).not.toBeNull();
    const second = bodyOf<Page>(
      await suppliers(`?contested=true&limit=1&cursor=${first.next_cursor}`)
    );
    expect(second.items.map((i) => i.id)).toEqual([contestedId]);
    expect(second.next_cursor).toBeNull();
  });

  it('AC-5 any other value of contested is a 400', async () => {
    for (const value of ['maybe', '1', 'TRUE', '']) {
      const response = await suppliers(`?contested=${value}`);
      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('keeps rejecting unknown query fields', async () => {
    const response = await suppliers('?hidden=true');
    expect(response.status).toBe(400);
  });
});

describe('organization suppliers list', () => {
  it('does not accept the contested query (person list only)', async () => {
    const response = await createAuthenticatedRequest(app, OWNER).get(
      `/api/v1/organizations/${ORG_A}/suppliers?contested=true`
    );
    expect(response.status).toBe(400);
  });
});

describe('driver view', () => {
  it('AC-4 has no contested_at', async () => {
    const row = await prisma.customerRelationship.findUniqueOrThrow({
      where: { id: contestedId },
      include: { customerPerson: true, customerOrganization: true },
    });
    const view = projectForDriver(row);
    expect(Object.keys(view).sort()).toEqual(['available_credit', 'customer_name', 'id']);
  });
});

describe('abuse cases', () => {
  it('AB-1 contested=true never lists another person’s records', async () => {
    const mine = bodyOf<Page>(await suppliers('?contested=true')).items.map((i) => i.id);
    expect(mine).not.toContain(otherContestedId);

    const theirs = bodyOf<Page>(await suppliers('?contested=true', OTHER)).items.map((i) => i.id);
    expect(theirs).toEqual([otherContestedId]);

    const stranger = bodyOf<Page>(await suppliers('?contested=true', SELLER)).items;
    expect(stranger).toEqual([]);
  });
});
