import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const id = (n: string) => `0199c0c8-0000-7000-8000-0000000000${n}`;

const OWNER = id('01');
const MANAGER = id('02');
const SELLER = id('03');
const DRIVER = id('04');
const CUSTOMER = id('05');
const CUSTOMER_B = id('06');
const OTHER_OWNER = id('08');

const SUPPLIER_ORG = id('a1');
const OTHER_ORG = id('a3');

const RICE = id('b1');
const FOREIGN_PRODUCT = id('b3');

const RICE_50 = id('c1');
const RICE_25 = id('c2');
const RICE_DELETED = id('c3');
const RICE_INACTIVE = id('c4');
const FOREIGN_VARIANT = id('c5');

const REL = id('d1');
const REL_B = id('d2');
const REL_OWN = id('d4');

const G1 = id('f1');
const G2 = id('f2');
const G3 = id('f3');

const REG = new Date('2026-01-01T00:00:00.000Z');

type PriceBody = { product_variant_id: string; price: number; set_by_id: string; set_at: string };

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
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER'
) {
  await prisma.collaboration.create({
    data: { id: id(n), personId, organizationId: orgId, role, status: 'ACTIVE', acceptedAt: REG },
  });
}

async function seedVariant(
  variantId: string,
  productId: string,
  organizationId: string,
  data: {
    name: string | null;
    unit: string;
    price: bigint;
    status?: 'ACTIVE' | 'INACTIVE';
    deletedAt?: Date;
  }
) {
  await prisma.productVariant.create({
    data: {
      id: variantId,
      productId,
      organizationId,
      name: data.name,
      unit: data.unit,
      price: data.price,
      status: data.status ?? 'ACTIVE',
      deletedAt: data.deletedAt ?? null,
      imageKeys: [],
    },
  });
}

async function seedRelationship(relId: string, personId: string) {
  await prisma.customerRelationship.create({
    data: {
      id: relId,
      supplierOrganizationId: SUPPLIER_ORG,
      customerPersonId: personId,
      status: 'ACTIVE',
      createdById: OWNER,
    },
  });
}

function put(
  relationshipId: string,
  variantId: string,
  body: unknown,
  caller = MANAGER,
  organizationId = SUPPLIER_ORG
) {
  return createAuthenticatedRequest(app, caller)
    .put(`/api/v1/organizations/${organizationId}/customers/${relationshipId}/prices/${variantId}`)
    .send(body as object);
}

function copy(targetId: string, body: object, caller = MANAGER) {
  return createAuthenticatedRequest(app, caller)
    .post(`/api/v1/organizations/${SUPPLIER_ORG}/customers/${targetId}/prices/copy`)
    .send(body);
}

const live = (relationshipId = REL) =>
  prisma.customerPrice.findMany({
    where: { customerRelationshipId: relationshipId, deletedAt: null },
    orderBy: { productVariantId: 'asc' },
  });

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009601');
  await seedPerson(MANAGER, '+237600009602');
  await seedPerson(SELLER, '+237600009603');
  await seedPerson(DRIVER, '+237600009604');
  await seedPerson(CUSTOMER, '+237600009605');
  await seedPerson(CUSTOMER_B, '+237600009606');
  await seedPerson(OTHER_OWNER, '+237600009608');

  await prisma.organization.create({ data: { id: SUPPLIER_ORG, name: 'Supplier' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other' } });
  await seedMember('e1', SUPPLIER_ORG, OWNER, 'OWNER');
  await seedMember('e2', SUPPLIER_ORG, MANAGER, 'MANAGER');
  await seedMember('e3', SUPPLIER_ORG, SELLER, 'SELLER');
  await seedMember('e4', SUPPLIER_ORG, DRIVER, 'DRIVER');
  await seedMember('e5', OTHER_ORG, OTHER_OWNER, 'OWNER');

  await prisma.product.create({
    data: { id: RICE, organizationId: SUPPLIER_ORG, name: 'Riz' },
  });
  await seedVariant(RICE_50, RICE, SUPPLIER_ORG, { name: null, unit: 'sac 50 kg', price: 3000n });
  await seedVariant(RICE_25, RICE, SUPPLIER_ORG, { name: null, unit: 'sac 25 kg', price: 1600n });
  await seedVariant(RICE_DELETED, RICE, SUPPLIER_ORG, {
    name: 'Vieux',
    unit: 'sac',
    price: 100n,
    deletedAt: REG,
  });
  await seedVariant(RICE_INACTIVE, RICE, SUPPLIER_ORG, {
    name: 'Brisé',
    unit: 'sac',
    price: 900n,
    status: 'INACTIVE',
  });
  await prisma.product.create({
    data: { id: FOREIGN_PRODUCT, organizationId: OTHER_ORG, name: 'Sel' },
  });
  await seedVariant(FOREIGN_VARIANT, FOREIGN_PRODUCT, OTHER_ORG, {
    name: null,
    unit: 'sac',
    price: 200n,
  });

  await seedRelationship(REL, CUSTOMER);
  await seedRelationship(REL_B, CUSTOMER_B);
  await seedRelationship(REL_OWN, MANAGER);
});

describe('variant prices', () => {
  it('set (AC-1, C-11): a price on the first variant leaves the second without one', async () => {
    const response = await put(REL, RICE_50, { id: G1, price: 2800 });

    expect(response.status).toBe(200);
    const body = bodyOf<PriceBody>(response);
    expect(Object.keys(body).sort()).toEqual([
      'price',
      'product_variant_id',
      'set_at',
      'set_by_id',
    ]);
    expect(body).toMatchObject({ product_variant_id: RICE_50, price: 2800, set_by_id: MANAGER });
    const rows = await live();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productVariantId: RICE_50,
      productId: RICE,
      price: 2800n,
      setById: MANAGER,
    });
    expect(body.set_at).toBe(rows[0].setAt.toISOString());
    expect(rows.find((row) => row.productVariantId === RICE_25)).toBeUndefined();
  });

  it('set: an INACTIVE variant accepts a price (any status)', async () => {
    expect((await put(REL, RICE_INACTIVE, { id: G1, price: 800 }, OWNER)).status).toBe(200);
  });

  it('set: the customer is notified with the label of the variant', async () => {
    await put(REL, RICE_50, { id: G1, price: 2800 });

    const notifications = await prisma.notification.findMany({
      where: { sourceEvent: 'price.negotiated_changed' },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].content).toContain('Riz — sac 50 kg');
  });

  it('replace (AC-2, C-11): the same variant again leaves one live row at the new price', async () => {
    await put(REL, RICE_50, { id: G1, price: 2800 });
    const second = await put(REL, RICE_50, { id: G2, price: 2700 });

    expect(second.status).toBe(200);
    const rows = await live();
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBe(2700n);
    expect(await prisma.customerPrice.count()).toBe(1);
  });

  it('replace: a price deleted earlier does not block a new live price', async () => {
    await prisma.customerPrice.create({
      data: {
        id: id('90'),
        customerRelationshipId: REL,
        productId: RICE,
        productVariantId: RICE_50,
        price: 100n,
        setById: OWNER,
        deletedAt: REG,
      },
    });

    expect((await put(REL, RICE_50, { id: G1, price: 2800 })).status).toBe(200);

    expect(await live()).toHaveLength(1);
    expect(await prisma.customerPrice.count()).toBe(2);
  });

  it('replace: two simultaneous prices leave one live row', async () => {
    const [a, b] = await Promise.all([
      put(REL, RICE_50, { id: G1, price: 2800 }, MANAGER),
      put(REL, RICE_50, { id: G2, price: 3100 }, OWNER),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await live()).toHaveLength(1);
  });

  describe('refusals (AC-3, C-04)', () => {
    it.each([
      ['price 0', REL, RICE_50, { id: G1, price: 0 }, MANAGER, 400, 'VALIDATION_ERROR'],
      [
        'an unknown field',
        REL,
        RICE_50,
        { id: G1, price: 2800, set_by_id: OWNER },
        MANAGER,
        400,
        'VALIDATION_ERROR',
      ],
      [
        'a malformed variant id',
        REL,
        'not-a-uuid',
        { id: G1, price: 2800 },
        MANAGER,
        400,
        'VALIDATION_ERROR',
      ],
      [
        'a variant of another business',
        REL,
        FOREIGN_VARIANT,
        { id: G1, price: 2800 },
        MANAGER,
        404,
        'NOT_FOUND',
      ],
      ['a deleted variant', REL, RICE_DELETED, { id: G1, price: 2800 }, MANAGER, 404, 'NOT_FOUND'],
      ['an unknown variant', REL, id('99'), { id: G1, price: 2800 }, MANAGER, 404, 'NOT_FOUND'],
      [
        'a product id instead of a variant id',
        REL,
        RICE,
        { id: G1, price: 2800 },
        MANAGER,
        404,
        'NOT_FOUND',
      ],
      [
        'the caller is the customer person',
        REL_OWN,
        RICE_50,
        { id: G1, price: 2800 },
        MANAGER,
        403,
        'OWN_RECORD',
      ],
      ['a SELLER caller', REL, RICE_50, { id: G1, price: 2800 }, SELLER, 403, 'FORBIDDEN'],
      ['a DRIVER caller', REL, RICE_50, { id: G1, price: 2800 }, DRIVER, 403, 'FORBIDDEN'],
    ])('%s', async (_name, relationshipId, variantId, body, caller, status, code) => {
      const response = await put(relationshipId, variantId, body, caller);

      expect(response.status).toBe(status);
      expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
      expect(await prisma.customerPrice.count()).toBe(0);
      expect(await prisma.notification.count()).toBe(0);
    });
  });

  describe('copy (AC-4, C-11)', () => {
    it('copies each price by variant and replaces the one the target already has', async () => {
      for (const [n, rel, variant, price] of [
        ['a1', REL, RICE_50, 2800n],
        ['a2', REL, RICE_25, 1500n],
        ['a3', REL_B, RICE_50, 2900n],
      ] as const) {
        await prisma.customerPrice.create({
          data: {
            id: id(n),
            customerRelationshipId: rel,
            productId: RICE,
            productVariantId: variant,
            price,
            setById: OWNER,
          },
        });
      }

      const response = await copy(REL_B, { id: G1, from_relationship_id: REL });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ copied: 2 });
      const rows = await live(REL_B);
      expect(
        rows.map((row) => ({
          variant: row.productVariantId,
          product: row.productId,
          price: row.price,
          by: row.setById,
        }))
      ).toEqual(
        [
          { variant: RICE_50, product: RICE, price: 2800n, by: MANAGER },
          { variant: RICE_25, product: RICE, price: 1500n, by: MANAGER },
        ].sort((a, b) => a.variant.localeCompare(b.variant))
      );
      expect(await prisma.customerPrice.count({ where: { customerRelationshipId: REL_B } })).toBe(
        2
      );
    });
  });

  describe('security', () => {
    it('AB-1 a variant of business B answers 404 and no price row is written', async () => {
      const response = await put(REL, FOREIGN_VARIANT, { id: G1, price: 1 });

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await prisma.customerPrice.count()).toBe(0);
    });

    it('AB-1 a manager of business B cannot price a variant of business A', async () => {
      const response = await put(REL, RICE_50, { id: G1, price: 1 }, OTHER_OWNER, OTHER_ORG);

      expect(response.status).toBe(404);
      expect(await prisma.customerPrice.count()).toBe(0);
    });

    it('AB-2 a manager who prices their own customer record is refused with OWN_RECORD', async () => {
      const response = await put(REL_OWN, RICE_50, { id: G3, price: 1 });

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
      expect(await prisma.customerPrice.count()).toBe(0);
    });
  });
});
