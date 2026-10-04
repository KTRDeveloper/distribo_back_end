import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const id = (n: string) => `0199c0c7-0000-7000-8000-0000000000${n}`;

const SUPPLIER_OWNER = id('01');
const CUSTOMER_A = id('02');
const CUSTOMER_B = id('03');
const STRANGER = id('04');
const BUYER_MANAGER = id('05');
const BUYER_SELLER = id('06');
const OTHER_MANAGER = id('07');
const BUYER_OWNER = id('08');

const SUPPLIER_ORG = id('a1');
const BUYER_ORG = id('a2');
const OTHER_ORG = id('a3');
const CLOSED_ORG = id('a4');
const SUSPENDED_ORG = id('a5');
const UNKNOWN_ORG = id('ff');

const RICE = id('b1');
const OIL = id('b2');
const SOAP = id('b3');
const SALT = id('b4');
const OLD = id('b5');

const REG = new Date('2026-01-01T00:00:00.000Z');

type Item = {
  id: string;
  name: string;
  unit: string;
  price: number;
  min_order_quantity: string | null;
  description: string | null;
  category: string | null;
  price_is_negotiated: boolean;
};
type Page = { items: Item[]; next_cursor: string | null };

async function seedPerson(personId: string, phone: string) {
  await prisma.person.create({
    data: {
      id: personId,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
    },
  });
}

async function seedMember(
  n: string,
  orgId: string,
  personId: string,
  role: 'OWNER' | 'MANAGER' | 'SELLER'
) {
  await prisma.collaboration.create({
    data: {
      id: id(n),
      personId,
      organizationId: orgId,
      role,
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
}

async function seedProduct(
  productId: string,
  name: string,
  price: bigint,
  createdAt: string,
  extra: { status?: 'ACTIVE' | 'INACTIVE'; deletedAt?: Date } = {}
) {
  await prisma.product.create({
    data: {
      id: productId,
      organizationId: SUPPLIER_ORG,
      name,
      unit: 'sac',
      price,
      status: extra.status ?? 'ACTIVE',
      deletedAt: extra.deletedAt ?? null,
      createdAt: new Date(createdAt),
    },
  });
}

async function seedRelationship(
  relId: string,
  customer: { personId?: string; organizationId?: string }
) {
  await prisma.customerRelationship.create({
    data: {
      id: relId,
      supplierOrganizationId: SUPPLIER_ORG,
      customerPersonId: customer.personId ?? null,
      customerOrganizationId: customer.organizationId ?? null,
      createdById: SUPPLIER_OWNER,
    },
  });
}

async function seedNegotiated(n: string, relId: string, productId: string, price: bigint) {
  await prisma.customerPrice.create({
    data: {
      id: id(n),
      customerRelationshipId: relId,
      productId,
      price,
      setById: SUPPLIER_OWNER,
    },
  });
}

function browse(personId: string, query = '', orgId = SUPPLIER_ORG) {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${orgId}/catalog${query}`
  );
}

const priceOf = (page: Page, productId: string) => page.items.find((item) => item.id === productId);

beforeEach(async () => {
  await seedPerson(SUPPLIER_OWNER, '+237600009301');
  await seedPerson(CUSTOMER_A, '+237600009302');
  await seedPerson(CUSTOMER_B, '+237600009303');
  await seedPerson(STRANGER, '+237600009304');
  await seedPerson(BUYER_MANAGER, '+237600009305');
  await seedPerson(BUYER_SELLER, '+237600009306');
  await seedPerson(OTHER_MANAGER, '+237600009307');
  await seedPerson(BUYER_OWNER, '+237600009308');

  await prisma.organization.create({ data: { id: SUPPLIER_ORG, name: 'Supplier' } });
  await prisma.organization.create({ data: { id: BUYER_ORG, name: 'Buyer' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other' } });
  await prisma.organization.create({ data: { id: CLOSED_ORG, name: 'Closed', status: 'CLOSED' } });
  await prisma.organization.create({
    data: { id: SUSPENDED_ORG, name: 'Suspended', status: 'SUSPENDED' },
  });
  await seedMember('c1', SUPPLIER_ORG, SUPPLIER_OWNER, 'OWNER');
  await seedMember('c5', BUYER_ORG, BUYER_OWNER, 'OWNER');
  await seedMember('c2', BUYER_ORG, BUYER_MANAGER, 'MANAGER');
  await seedMember('c3', BUYER_ORG, BUYER_SELLER, 'SELLER');
  await seedMember('c4', OTHER_ORG, OTHER_MANAGER, 'OWNER');

  await seedProduct(RICE, 'Riz', 3000n, '2026-02-01T00:00:00Z');
  await seedProduct(OIL, 'Huile', 1500n, '2026-02-02T00:00:00Z');
  await seedProduct(SOAP, 'Savon', 500n, '2026-02-03T00:00:00Z', { status: 'INACTIVE' });
  await seedProduct(SALT, 'Sel', 200n, '2026-02-04T00:00:00Z');
  await seedProduct(OLD, 'Vieux', 100n, '2026-02-05T00:00:00Z', { deletedAt: REG });
});

describe('GET /api/v1/organizations/:organizationId/catalog', () => {
  it('AC-1 a person with no relationship sees product prices, flag false', async () => {
    const response = await browse(STRANGER);

    expect(response.status).toBe(200);
    const page = bodyOf<Page>(response);
    expect(page.items.map((i) => [i.id, i.price, i.price_is_negotiated])).toEqual([
      [SALT, 200, false],
      [OIL, 1500, false],
      [RICE, 3000, false],
    ]);
    expect(Object.keys(page.items[0]).sort()).toEqual(
      [
        'category',
        'description',
        'id',
        'min_order_quantity',
        'name',
        'price',
        'price_is_negotiated',
        'unit',
      ].sort()
    );
    expect(page.next_cursor).toBeNull();
  });

  it('AC-2 CM-11 own negotiated price shows, even above the product price', async () => {
    await seedRelationship(id('d1'), { personId: CUSTOMER_A });
    await seedNegotiated('e1', id('d1'), RICE, 2800n);
    await seedNegotiated('e2', id('d1'), OIL, 1800n);

    const page = bodyOf<Page>(await browse(CUSTOMER_A));

    expect(priceOf(page, RICE)).toMatchObject({ price: 2800, price_is_negotiated: true });
    expect(priceOf(page, OIL)).toMatchObject({ price: 1800, price_is_negotiated: true });
    expect(priceOf(page, SALT)).toMatchObject({ price: 200, price_is_negotiated: false });
  });

  it('a deleted negotiated price is ignored', async () => {
    await seedRelationship(id('d1'), { personId: CUSTOMER_A });
    await prisma.customerPrice.create({
      data: {
        id: id('e1'),
        customerRelationshipId: id('d1'),
        productId: RICE,
        price: 2800n,
        setById: SUPPLIER_OWNER,
        deletedAt: REG,
      },
    });

    const page = bodyOf<Page>(await browse(CUSTOMER_A));

    expect(priceOf(page, RICE)).toMatchObject({ price: 3000, price_is_negotiated: false });
  });

  it('AC-3 a MANAGER on behalf of the organization gets its negotiated prices', async () => {
    await seedRelationship(id('d2'), { organizationId: BUYER_ORG });
    await seedNegotiated('e1', id('d2'), RICE, 2700n);

    const onBehalf = bodyOf<Page>(await browse(BUYER_MANAGER, `?as_organization_id=${BUYER_ORG}`));
    const asPerson = bodyOf<Page>(await browse(BUYER_MANAGER));

    expect(priceOf(onBehalf, RICE)).toMatchObject({ price: 2700, price_is_negotiated: true });
    expect(priceOf(asPerson, RICE)).toMatchObject({ price: 3000, price_is_negotiated: false });
  });

  it('AC-3 the organization relationship decides, not the caller person one', async () => {
    await seedRelationship(id('d1'), { personId: BUYER_MANAGER });
    await seedNegotiated('e1', id('d1'), RICE, 2000n);

    const page = bodyOf<Page>(await browse(BUYER_MANAGER, `?as_organization_id=${BUYER_ORG}`));

    expect(priceOf(page, RICE)).toMatchObject({ price: 3000, price_is_negotiated: false });
  });

  it('an OWNER may act as the organization', async () => {
    expect((await browse(BUYER_OWNER, `?as_organization_id=${BUYER_ORG}`)).status).toBe(200);
  });

  it.each([
    ['a CLOSED organization', CLOSED_ORG, ''],
    ['a SUSPENDED organization', SUSPENDED_ORG, ''],
    ['an unknown organization', UNKNOWN_ORG, ''],
    [
      'as_organization_id the caller does not manage',
      SUPPLIER_ORG,
      `?as_organization_id=${OTHER_ORG}`,
    ],
    [
      'as_organization_id of an unknown organization',
      SUPPLIER_ORG,
      `?as_organization_id=${UNKNOWN_ORG}`,
    ],
  ])('AC-4 %s answers 404 NOT_FOUND', async (_label, orgId, query) => {
    const response = await browse(STRANGER, query, orgId);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
  });

  it('AC-5 INACTIVE and deleted products never appear', async () => {
    const page = bodyOf<Page>(await browse(STRANGER));

    expect(page.items.map((i) => i.id)).not.toContain(SOAP);
    expect(page.items.map((i) => i.id)).not.toContain(OLD);
  });

  it('a negotiated price on an INACTIVE article does not bring it back', async () => {
    await seedRelationship(id('d1'), { personId: CUSTOMER_A });
    await seedNegotiated('e1', id('d1'), SOAP, 400n);

    const page = bodyOf<Page>(await browse(CUSTOMER_A));

    expect(page.items.map((i) => i.id)).not.toContain(SOAP);
  });

  it('AB-1 each customer sees only their own negotiated price', async () => {
    await seedRelationship(id('d1'), { personId: CUSTOMER_A });
    await seedRelationship(id('d3'), { personId: CUSTOMER_B });
    await seedNegotiated('e1', id('d1'), RICE, 2800n);
    await seedNegotiated('e2', id('d3'), RICE, 2600n);

    const a = await browse(CUSTOMER_A);
    const b = await browse(CUSTOMER_B);

    expect(priceOf(bodyOf<Page>(a), RICE)?.price).toBe(2800);
    expect(priceOf(bodyOf<Page>(b), RICE)?.price).toBe(2600);
    expect(JSON.stringify(a.body)).not.toContain('2600');
    expect(JSON.stringify(b.body)).not.toContain('2800');
  });

  it('AB-1 a relationship with another supplier changes nothing', async () => {
    await prisma.organization.update({ where: { id: OTHER_ORG }, data: {} });
    await prisma.customerRelationship.create({
      data: {
        id: id('d4'),
        supplierOrganizationId: OTHER_ORG,
        customerPersonId: CUSTOMER_A,
        createdById: SUPPLIER_OWNER,
      },
    });

    const page = bodyOf<Page>(await browse(CUSTOMER_A));

    expect(page.items.every((i) => !i.price_is_negotiated)).toBe(true);
  });

  it.each([
    ['a SELLER of the business', BUYER_SELLER],
    ['a person outside the business', STRANGER],
    ['a manager of another business', OTHER_MANAGER],
  ])('AB-2 %s passing as_organization_id gets 404', async (_label, personId) => {
    await seedRelationship(id('d2'), { organizationId: BUYER_ORG });
    await seedNegotiated('e1', id('d2'), RICE, 2700n);

    const response = await browse(personId, `?as_organization_id=${BUYER_ORG}`);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(response.body)).not.toContain('2700');
  });

  it('a collaborator of a revoked collaboration cannot act as the organization', async () => {
    await prisma.collaboration.updateMany({
      where: { personId: BUYER_MANAGER },
      data: { status: 'REVOKED' },
    });

    expect((await browse(BUYER_MANAGER, `?as_organization_id=${BUYER_ORG}`)).status).toBe(404);
  });

  it('pages with limit and cursor, no overlap', async () => {
    const first = bodyOf<Page>(await browse(STRANGER, '?limit=2'));
    expect(first.items.map((i) => i.id)).toEqual([SALT, OIL]);
    expect(first.next_cursor).not.toBeNull();

    const second = bodyOf<Page>(
      await browse(STRANGER, `?limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`)
    );
    expect(second.items.map((i) => i.id)).toEqual([RICE]);
    expect(second.next_cursor).toBeNull();
  });

  it.each([['?limit=0'], ['?limit=101'], ['?foo=1'], ['?as_organization_id=nope'], ['?cursor=@@']])(
    'rejects the invalid query %s with 400',
    async (query) => {
      const response = await browse(STRANGER, query);

      expect(response.status).toBe(400);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    }
  );

  it('answers 401 without a token', async () => {
    const { default: request } = await import('supertest');
    const response = await request(app).get(`/api/v1/organizations/${SUPPLIER_ORG}/catalog`);

    expect(response.status).toBe(401);
  });
});
