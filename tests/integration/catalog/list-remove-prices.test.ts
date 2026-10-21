import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { seedCustomerPrice, seedProduct } from '../../helpers/catalog-fixtures.js';
import { prisma } from '../../setup.js';

const id = (n: string) => `0199c0c8-0000-7000-8000-0000000000${n}`;

const OWNER = id('01');
const MANAGER = id('02');
const SELLER = id('03');
const DRIVER = id('04');
const CUSTOMER = id('05');
const GUEST = id('06');
const OTHER_OWNER = id('08');
const BUYER_OWNER = id('09');

const SUPPLIER_ORG = id('a1');
const BUYER_ORG = id('a2');
const OTHER_ORG = id('a3');

const RICE = id('b1');
const OIL = id('b2');
const SOAP = id('b3');
const FOREIGN_PRODUCT = id('b4');

const REL = id('d1');
const REL_GUEST = id('d2');
const REL_OWN_MANAGER = id('d4');
const REL_ORG_BUYER = id('d5');
const REL_FOREIGN = id('d6');

const G1 = id('f1');

const REG = new Date('2026-01-01T00:00:00.000Z');
const PAST = new Date('2026-02-01T08:00:00.000Z');
const FUTURE = new Date('2099-01-01T00:00:00.000Z');

type PriceItem = {
  product_variant_id: string;
  label: string;
  price: number;
  variant_price: number;
  set_by_id: string;
  set_at: string;
  to_review: boolean;
};
type PricePage = { items: PriceItem[]; next_cursor: string | null };

async function seedPerson(personId: string, phone: string, registered = true) {
  await prisma.person.create({
    data: {
      id: personId,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      ...(registered
        ? { phoneVerifiedAt: REG, passwordHash: 'test-password-hash', registeredAt: REG }
        : {}),
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

async function seedRelationship(
  relId: string,
  customer: { personId?: string; organizationId?: string },
  supplierOrganizationId = SUPPLIER_ORG
) {
  await prisma.customerRelationship.create({
    data: {
      id: relId,
      supplierOrganizationId,
      customerPersonId: customer.personId ?? null,
      customerOrganizationId: customer.organizationId ?? null,
      status: 'ACTIVE',
      createdById: OWNER,
    },
  });
}

async function seedPrice(
  n: string,
  relationshipId: string,
  productId: string,
  price: bigint,
  extra: { setAt?: Date; deletedAt?: Date; setById?: string } = {}
) {
  await seedCustomerPrice(prisma, {
    id: id(n),
    customerRelationshipId: relationshipId,
    productVariantId: productId,
    price,
    setById: extra.setById ?? OWNER,
    setAt: extra.setAt ?? PAST,
    deletedAt: extra.deletedAt ?? null,
  });
}

const base = (organizationId = SUPPLIER_ORG) => `/api/v1/organizations/${organizationId}/customers`;

function list(relationshipId: string, caller = SELLER, query = '', organizationId = SUPPLIER_ORG) {
  return createAuthenticatedRequest(app, caller).get(
    `${base(organizationId)}/${relationshipId}/prices${query}`
  );
}

function remove(
  relationshipId: string,
  productId: string,
  caller = MANAGER,
  organizationId = SUPPLIER_ORG
) {
  return createAuthenticatedRequest(app, caller).delete(
    `${base(organizationId)}/${relationshipId}/prices/${productId}`
  );
}

function put(relationshipId: string, productId: string, body: object, caller = MANAGER) {
  return createAuthenticatedRequest(app, caller)
    .put(`${base()}/${relationshipId}/prices/${productId}`)
    .send(body);
}

const livePrices = (relationshipId = REL, productId = RICE) =>
  prisma.customerPrice.findMany({
    where: { customerRelationshipId: relationshipId, productVariantId: productId, deletedAt: null },
  });

const customerPriceOfRice = async () => {
  const response = await createAuthenticatedRequest(app, CUSTOMER).get(
    `/api/v1/organizations/${SUPPLIER_ORG}/catalog`
  );
  const items = bodyOf<{
    items: Array<{
      id: string;
      variants: Array<{ id: string; price: number; price_is_negotiated: boolean }>;
    }>;
  }>(response).items;
  return items.flatMap((item) => item.variants).find((variant) => variant.id === RICE);
};

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009501');
  await seedPerson(MANAGER, '+237600009502');
  await seedPerson(SELLER, '+237600009503');
  await seedPerson(DRIVER, '+237600009504');
  await seedPerson(CUSTOMER, '+237600009505');
  await seedPerson(GUEST, '+237600009506', false);
  await seedPerson(OTHER_OWNER, '+237600009508');
  await seedPerson(BUYER_OWNER, '+237600009509');

  await prisma.organization.create({ data: { id: SUPPLIER_ORG, name: 'Supplier' } });
  await prisma.organization.create({ data: { id: BUYER_ORG, name: 'Buyer' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other' } });
  await seedMember('c1', SUPPLIER_ORG, OWNER, 'OWNER');
  await seedMember('c2', SUPPLIER_ORG, MANAGER, 'MANAGER');
  await seedMember('c3', SUPPLIER_ORG, SELLER, 'SELLER');
  await seedMember('c4', SUPPLIER_ORG, DRIVER, 'DRIVER');
  await seedMember('c5', OTHER_ORG, OTHER_OWNER, 'OWNER');
  await seedMember('c8', BUYER_ORG, BUYER_OWNER, 'OWNER');
  await seedMember('c6', BUYER_ORG, MANAGER, 'MANAGER');

  await seedProduct(prisma, {
    id: RICE,
    organizationId: SUPPLIER_ORG,
    name: 'Riz',
    unit: 'sac',
    price: 3000n,
  });
  await seedProduct(prisma, {
    id: OIL,
    organizationId: SUPPLIER_ORG,
    name: 'Huile',
    unit: 'litre',
    price: 1500n,
  });
  await seedProduct(prisma, {
    id: SOAP,
    organizationId: SUPPLIER_ORG,
    name: 'Savon',
    unit: 'pain',
    price: 500n,
  });

  await seedRelationship(REL, { personId: CUSTOMER });
  await seedRelationship(REL_GUEST, { personId: GUEST });
  await seedRelationship(REL_OWN_MANAGER, { personId: MANAGER });
  await seedRelationship(REL_ORG_BUYER, { organizationId: BUYER_ORG });
  await seedRelationship(REL_FOREIGN, { personId: CUSTOMER }, OTHER_ORG);
});

describe('GET /api/v1/organizations/:organizationId/customers/:relationshipId/prices', () => {
  it('AC-1 a SELLER lists the prices with the review flag', async () => {
    // RICE: set long ago, product price changed after (priceUpdatedAt is now) -> to review.
    await seedPrice('e1', REL, RICE, 2800n, { setAt: PAST });
    // OIL: set after the product price last changed -> nothing to review.
    await seedPrice('e2', REL, OIL, 1400n, { setAt: FUTURE });

    const response = await list(REL, SELLER);

    expect(response.status).toBe(200);
    const page = bodyOf<PricePage>(response);
    expect(page.next_cursor).toBeNull();
    expect(page.items).toHaveLength(2);
    const rice = page.items.find((item) => item.product_variant_id === RICE)!;
    const oil = page.items.find((item) => item.product_variant_id === OIL)!;
    expect(Object.keys(rice).sort()).toEqual([
      'label',
      'price',
      'product_variant_id',
      'set_at',
      'set_by_id',
      'to_review',
      'variant_price',
    ]);
    expect(rice).toMatchObject({
      label: 'Riz — sac',
      price: 2800,
      variant_price: 3000,
      set_by_id: OWNER,
      set_at: PAST.toISOString(),
      to_review: true,
    });
    expect(oil).toMatchObject({ label: 'Huile — litre', price: 1400, to_review: false });
  });

  it('leaves out deleted prices and the prices of other relationships', async () => {
    await seedPrice('e1', REL, RICE, 2800n, { deletedAt: REG });
    await seedPrice('e2', REL, OIL, 1400n);
    await seedPrice('e3', REL_GUEST, SOAP, 400n);

    const page = bodyOf<PricePage>(await list(REL, MANAGER));

    expect(page.items.map((item) => item.product_variant_id)).toEqual([OIL]);
  });

  it('paginates with limit and cursor', async () => {
    await seedPrice('e1', REL, RICE, 2800n, { setAt: new Date('2026-02-01T08:00:00.000Z') });
    await seedPrice('e2', REL, OIL, 1400n, { setAt: new Date('2026-02-02T08:00:00.000Z') });
    await seedPrice('e3', REL, SOAP, 400n, { setAt: new Date('2026-02-03T08:00:00.000Z') });

    const first = bodyOf<PricePage>(await list(REL, SELLER, '?limit=2'));
    expect(first.items.map((item) => item.product_variant_id)).toEqual([SOAP, OIL]);
    expect(first.next_cursor).not.toBeNull();

    const second = bodyOf<PricePage>(
      await list(REL, SELLER, `?limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`)
    );
    expect(second.items.map((item) => item.product_variant_id)).toEqual([RICE]);
    expect(second.next_cursor).toBeNull();
  });

  it('refuses a DRIVER (403) and a bad limit or unknown query key (400)', async () => {
    expect((await list(REL, DRIVER)).status).toBe(403);
    expect((await list(REL, SELLER, '?limit=101')).status).toBe(400);
    expect((await list(REL, SELLER, '?foo=1')).status).toBe(400);
  });

  it('requires authentication', async () => {
    const response = await request(app).get(`${base()}/${REL}/prices`);

    expect(response.status).toBe(401);
  });
});

describe('DELETE /api/v1/organizations/:organizationId/customers/:relationshipId/prices/:variantId', () => {
  it('AC-2 a MANAGER deletes a live price: 204, deleted, the product price applies again', async () => {
    await seedPrice('e1', REL, RICE, 2800n);
    expect(await customerPriceOfRice()).toMatchObject({ price: 2800, price_is_negotiated: true });

    const response = await remove(REL, RICE, MANAGER);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(await livePrices()).toHaveLength(0);
    const row = await prisma.customerPrice.findUniqueOrThrow({ where: { id: id('e1') } });
    expect(row.deletedAt).not.toBeNull();
    expect(await customerPriceOfRice()).toMatchObject({ price: 3000, price_is_negotiated: false });
  });

  it('an OWNER can delete too, and the price leaves the list', async () => {
    await seedPrice('e1', REL, RICE, 2800n);
    await seedPrice('e2', REL, OIL, 1400n);

    expect((await remove(REL, RICE, OWNER)).status).toBe(204);

    const page = bodyOf<PricePage>(await list(REL, SELLER));
    expect(page.items.map((item) => item.product_variant_id)).toEqual([OIL]);
  });

  it('a registered customer gets one price.negotiated_changed; a guest gets none', async () => {
    await seedPrice('e1', REL, RICE, 2800n);
    await seedPrice('e2', REL_GUEST, RICE, 2800n);

    await remove(REL, RICE);
    await remove(REL_GUEST, RICE);

    const notifications = await prisma.notification.findMany({
      where: { sourceEvent: 'price.negotiated_changed' },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      recipientId: CUSTOMER,
      organizationId: SUPPLIER_ORG,
      readStatus: 'UNREAD',
    });
    expect(notifications[0].content).toContain('Riz');
  });

  it('AC-3 the price can be set again after removal: a new live row', async () => {
    await seedPrice('e1', REL, RICE, 2800n);
    await remove(REL, RICE);

    const response = await put(REL, RICE, { id: G1, price: 2600 });

    expect(response.status).toBe(200);
    const rows = await livePrices();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(G1);
    expect(rows[0].price).toBe(2600n);
    expect(await prisma.customerPrice.count()).toBe(2);
  });

  describe('AC-4 refusals', () => {
    it.each([
      ['no live price for that product', REL, OIL, MANAGER, 404, 'NOT_FOUND'],
      ['an unknown product', REL, id('99'), MANAGER, 404, 'NOT_FOUND'],
      ['a SELLER caller', REL, RICE, SELLER, 403, 'FORBIDDEN'],
      ['a DRIVER caller', REL, RICE, DRIVER, 403, 'FORBIDDEN'],
      ['a manager on their own record', REL_OWN_MANAGER, RICE, MANAGER, 403, 'OWN_RECORD'],
      ['a manager of the customer organization', REL_ORG_BUYER, RICE, MANAGER, 403, 'OWN_RECORD'],
      ['a malformed product id', REL, 'not-a-uuid', MANAGER, 400, 'VALIDATION_ERROR'],
    ])('%s', async (_name, relationshipId, productId, caller, status, code) => {
      await seedPrice('e1', REL, RICE, 2800n);
      await seedPrice('e2', REL_OWN_MANAGER, RICE, 2800n);
      await seedPrice('e3', REL_ORG_BUYER, RICE, 2800n);

      const response = await remove(relationshipId, productId, caller);

      expect(response.status).toBe(status);
      expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
      expect(await prisma.customerPrice.count({ where: { deletedAt: null } })).toBe(3);
      expect(await prisma.notification.count()).toBe(0);
    });

    it('a price already deleted answers 404 on a repeat', async () => {
      await seedPrice('e1', REL, RICE, 2800n);

      expect((await remove(REL, RICE)).status).toBe(204);
      const repeat = await remove(REL, RICE);

      expect(repeat.status).toBe(404);
      expect(await prisma.notification.count()).toBe(1);
    });

    it('requires authentication', async () => {
      const response = await request(app).delete(`${base()}/${REL}/prices/${RICE}`);

      expect(response.status).toBe(401);
    });
  });
});

describe('security', () => {
  it('AB-1 a member of A lists or deletes prices under a relationship of B: 404, nothing changes', async () => {
    await seedProduct(prisma, {
      id: FOREIGN_PRODUCT,
      organizationId: OTHER_ORG,
      name: 'Sel',
      unit: 'sac',
      price: 9n,
    });
    await seedPrice('e1', REL_FOREIGN, FOREIGN_PRODUCT, 1n);

    const listed = await list(REL_FOREIGN, OWNER);
    const deleted = await remove(REL_FOREIGN, FOREIGN_PRODUCT, OWNER);

    expect(listed.status).toBe(404);
    expect(deleted.status).toBe(404);
    expect(bodyOf<ErrorBody>(listed).error.code).toBe('NOT_FOUND');
    expect(await prisma.customerPrice.count({ where: { deletedAt: null } })).toBe(1);
  });

  it('AB-1 a member of B cannot reach A through the path organization either', async () => {
    await seedPrice('e1', REL, RICE, 2800n);

    const listed = await list(REL, OTHER_OWNER, '', SUPPLIER_ORG);
    const deleted = await remove(REL, RICE, OTHER_OWNER, SUPPLIER_ORG);
    const viaOwnOrg = await remove(REL, RICE, OTHER_OWNER, OTHER_ORG);

    expect([listed.status, deleted.status, viaOwnOrg.status]).toEqual([404, 404, 404]);
    expect(await livePrices()).toHaveLength(1);
  });
});
