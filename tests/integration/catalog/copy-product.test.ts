import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const id = (n: string) => `0199c0c8-0000-7000-8000-0000000000${n}`;

const BUYER_OWNER = id('01');
const BUYER_MANAGER = id('02');
const BUYER_SELLER = id('03');
const SUPPLIER_OWNER = id('04');
const OTHER_OWNER = id('05');

const BUYER_ORG = id('a1');
const SUPPLIER_ORG = id('a2');
const OTHER_ORG = id('a3');

const SOURCE = id('b1');
const INACTIVE_SOURCE = id('b2');
const STRANGER_SOURCE = id('b3');
const OWN_SOURCE = id('b4');
const ENDED_SOURCE = id('b5');
const DELETED_SOURCE = id('b6');

const NEW_ID = id('f1');
const NEW_VARIANT_ID = id('f2');
const REG = new Date('2026-01-01T00:00:00.000Z');

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
    data: { id: id(n), personId, organizationId: orgId, role, status: 'ACTIVE', acceptedAt: REG },
  });
}

function copy(body: object, caller = BUYER_MANAGER, organizationId = BUYER_ORG) {
  return createAuthenticatedRequest(app, caller)
    .post(`/api/v1/organizations/${organizationId}/products/copy`)
    .send(body);
}

const validBody = (over: object = {}) => ({
  id: NEW_ID,
  source_product_id: SOURCE,
  destination: {},
  variants: [{ id: NEW_VARIANT_ID, source_variant_id: SOURCE, price: 9000 }],
  ...over,
});

const productCount = () => prisma.product.count();

beforeEach(async () => {
  await seedPerson(BUYER_OWNER, '+237600009601');
  await seedPerson(BUYER_MANAGER, '+237600009602');
  await seedPerson(BUYER_SELLER, '+237600009603');
  await seedPerson(SUPPLIER_OWNER, '+237600009604');
  await seedPerson(OTHER_OWNER, '+237600009605');

  for (const [orgId, name] of [
    [BUYER_ORG, 'Buyer'],
    [SUPPLIER_ORG, 'Supplier'],
    [OTHER_ORG, 'Other'],
  ] as const) {
    await prisma.organization.create({ data: { id: orgId, name } });
  }
  await seedMember('c1', BUYER_ORG, BUYER_OWNER, 'OWNER');
  await seedMember('c2', BUYER_ORG, BUYER_MANAGER, 'MANAGER');
  await seedMember('c3', BUYER_ORG, BUYER_SELLER, 'SELLER');
  await seedMember('c4', SUPPLIER_ORG, SUPPLIER_OWNER, 'OWNER');
  await seedMember('c5', OTHER_ORG, OTHER_OWNER, 'OWNER');

  await prisma.customerRelationship.create({
    data: {
      id: id('d1'),
      supplierOrganizationId: SUPPLIER_ORG,
      customerOrganizationId: BUYER_ORG,
      status: 'ACTIVE',
      createdById: SUPPLIER_OWNER,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: id('d2'),
      supplierOrganizationId: OTHER_ORG,
      customerOrganizationId: BUYER_ORG,
      status: 'ENDED',
      endedByParty: 'SUPPLIER',
      createdById: OTHER_OWNER,
    },
  });

  const base = { unit: 'carton de 24', price: 12000n };
  await prisma.product.create({
    data: {
      ...base,
      id: SOURCE,
      organizationId: SUPPLIER_ORG,
      name: 'Pack 24',
      description: 'Eau minerale',
      category: 'Boissons',
      minOrderQuantity: '5',
    },
  });
  await prisma.product.create({
    data: {
      ...base,
      id: INACTIVE_SOURCE,
      organizationId: SUPPLIER_ORG,
      name: 'Old',
      status: 'INACTIVE',
    },
  });
  await prisma.product.create({
    data: {
      ...base,
      id: DELETED_SOURCE,
      organizationId: SUPPLIER_ORG,
      name: 'Gone',
      deletedAt: REG,
    },
  });
  await prisma.product.create({
    data: { ...base, id: STRANGER_SOURCE, organizationId: OTHER_ORG, name: 'Competitor' },
  });
  await prisma.product.create({
    data: { ...base, id: ENDED_SOURCE, organizationId: OTHER_ORG, name: 'Ended' },
  });
  await prisma.product.create({
    data: { ...base, id: OWN_SOURCE, organizationId: BUYER_ORG, name: 'Mine' },
  });
});

describe('POST /api/v1/organizations/:organizationId/products/copy', () => {
  it('AC-1, C-13, Product:required copies the texts and sets the caller price', async () => {
    const before = await productCount();
    const response = await copy(validBody());

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      product: {
        id: NEW_ID,
        name: 'Pack 24',
        description: 'Eau minerale',
        category: 'Boissons',
        variants: [
          {
            id: NEW_VARIANT_ID,
            unit: 'carton de 24',
            price: 9000,
            status: 'ACTIVE',
            min_order_quantity: null,
          },
        ],
      },
      copied: [NEW_VARIANT_ID],
      already_in_catalog: [],
    });
    expect(Object.keys(bodyOf<Record<string, unknown>>(response)).sort()).toEqual(
      ['product', 'copied', 'already_in_catalog'].sort()
    );
    expect(await productCount()).toBe(before + 1);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: NEW_ID } });
    expect(row.organizationId).toBe(BUYER_ORG);
    expect(row.status).toBe('ACTIVE');
    expect(row.minOrderQuantity).toBeNull();
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: NEW_VARIANT_ID },
    });
    expect(variant.price).toBe(9000n);
    expect(variant.minOrderQuantity).toBeNull();
    expect(variant.priceUpdatedAt).toBeInstanceOf(Date);
  });

  it('AC-1 an OWNER may copy too', async () => {
    const response = await copy(validBody(), BUYER_OWNER);
    expect(response.status).toBe(201);
  });

  it('AC-2 keeps no link: renaming the source leaves the copy unchanged', async () => {
    await copy(validBody());
    await prisma.product.update({ where: { id: SOURCE }, data: { name: 'Renamed' } });

    const row = await prisma.product.findUniqueOrThrow({ where: { id: NEW_ID } });
    expect(row.name).toBe('Pack 24');
    expect(Object.keys(row).filter((key) => /source/i.test(key))).toEqual([]);
  });

  it.each([
    ['an INACTIVE product', INACTIVE_SOURCE],
    ['a deleted product', DELETED_SOURCE],
    ['a product of a supplier the organization does not buy from', STRANGER_SOURCE],
    ['a product of a supplier whose relationship ended', ENDED_SOURCE],
    ["a product of the caller's own organization", OWN_SOURCE],
    ['an unknown product', id('9f')],
  ])('AC-3 source is %s answers 404 and creates nothing', async (_label, source) => {
    const before = await productCount();
    const response = await copy(validBody({ source_product_id: source }));

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(await productCount()).toBe(before);
  });

  it('AC-4 price 0 answers 400', async () => {
    const before = await productCount();
    const response = await copy(
      validBody({ variants: [{ id: NEW_VARIANT_ID, source_variant_id: SOURCE, price: 0 }] })
    );
    expect(response.status).toBe(400);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('VALIDATION_ERROR');
    expect(await productCount()).toBe(before);
  });

  it('AC-4, 15.3.3 refuses unknown fields and a missing field', async () => {
    expect((await copy(validBody({ organization_id: OTHER_ORG }))).status).toBe(400);
    expect((await copy(validBody({ name: 'Other name' }))).status).toBe(400);
    expect((await copy({ id: NEW_ID, price: 9000 })).status).toBe(400);
    expect(
      (
        await copy(
          validBody({ variants: [{ id: NEW_VARIANT_ID, source_variant_id: SOURCE, price: 10.5 }] })
        )
      ).status
    ).toBe(400);
  });

  it('AC-4 a SELLER answers 403', async () => {
    const before = await productCount();
    const response = await copy(validBody(), BUYER_SELLER);
    expect(response.status).toBe(403);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('FORBIDDEN');
    expect(await productCount()).toBe(before);
  });

  it('AB-1, WSTG-ATHZ-04, CWE-200 a competitor article answers 404 and nothing is created', async () => {
    const before = await productCount();
    const response = await copy(validBody({ source_product_id: STRANGER_SOURCE }));
    expect(response.status).toBe(404);
    expect(await productCount()).toBe(before);
  });

  it('answers 404 to a person who is not a member of the path organization', async () => {
    const before = await productCount();
    const response = await copy(validBody(), OTHER_OWNER, BUYER_ORG);
    expect(response.status).toBe(404);
    expect(await productCount()).toBe(before);
  });

  it('a repeat with the same id changes nothing and returns the first response', async () => {
    const first = await copy(validBody());
    const second = await copy(validBody());
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(await prisma.product.count({ where: { organizationId: BUYER_ORG } })).toBe(2);
  });
});
