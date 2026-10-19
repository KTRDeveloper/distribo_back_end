import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
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
const GUEST = id('06');
const PENDING_CUSTOMER = id('07');
const OTHER_OWNER = id('08');
const OUTSIDER = id('09');

const SUPPLIER_ORG = id('a1');
const BUYER_ORG = id('a2');
const OTHER_ORG = id('a3');

const RICE = id('b1');
const OIL = id('b2');
const FOREIGN_PRODUCT = id('b3');
const INACTIVE_PRODUCT = id('b4');

const REL = id('d1');
const REL_GUEST = id('d2');
const REL_PENDING = id('d3');
const REL_OWN_MANAGER = id('d4');
const REL_ORG_BUYER = id('d5');
const REL_FOREIGN = id('d6');
const REL_COUNTER = id('d7');
const REL_ENDED = id('d8');
const CUSTOMER_ENDED = id('0a');

const G1 = id('f1');
const G2 = id('f2');
const G3 = id('f3');

const REG = new Date('2026-01-01T00:00:00.000Z');

type PriceBody = { product_variant_id: string; price: number; set_by_id: string; set_at: string };

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
  extra: { supplierOrganizationId?: string; status?: 'PENDING' | 'ACTIVE' | 'ENDED' } = {}
) {
  await prisma.customerRelationship.create({
    data: {
      id: relId,
      supplierOrganizationId: extra.supplierOrganizationId ?? SUPPLIER_ORG,
      customerPersonId: customer.personId ?? null,
      customerOrganizationId: customer.organizationId ?? null,
      customerLabel: customer.personId || customer.organizationId ? null : 'Counter',
      status: extra.status ?? 'ACTIVE',
      createdById: OWNER,
    },
  });
}

function put(
  relationshipId: string,
  productId: string,
  body: unknown,
  caller = MANAGER,
  organizationId = SUPPLIER_ORG
) {
  return createAuthenticatedRequest(app, caller)
    .put(`/api/v1/organizations/${organizationId}/customers/${relationshipId}/prices/${productId}`)
    .send(body as object);
}

const livePrices = (relationshipId = REL, productId = RICE) =>
  prisma.customerPrice.findMany({
    where: { customerRelationshipId: relationshipId, productVariantId: productId, deletedAt: null },
  });

const priceRows = () => prisma.customerPrice.count();

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009401');
  await seedPerson(MANAGER, '+237600009402');
  await seedPerson(SELLER, '+237600009403');
  await seedPerson(DRIVER, '+237600009404');
  await seedPerson(CUSTOMER, '+237600009405');
  await seedPerson(GUEST, '+237600009406', false);
  await seedPerson(PENDING_CUSTOMER, '+237600009407');
  await seedPerson(OTHER_OWNER, '+237600009408');
  await seedPerson(OUTSIDER, '+237600009409');
  await seedPerson(CUSTOMER_ENDED, '+237600009410');

  await prisma.organization.create({ data: { id: SUPPLIER_ORG, name: 'Supplier' } });
  await prisma.organization.create({ data: { id: BUYER_ORG, name: 'Buyer' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other' } });
  await seedMember('c1', SUPPLIER_ORG, OWNER, 'OWNER');
  await seedMember('c2', SUPPLIER_ORG, MANAGER, 'MANAGER');
  await seedMember('c3', SUPPLIER_ORG, SELLER, 'SELLER');
  await seedMember('c4', SUPPLIER_ORG, DRIVER, 'DRIVER');
  await seedMember('c5', OTHER_ORG, OTHER_OWNER, 'OWNER');
  await seedMember('c8', BUYER_ORG, OUTSIDER, 'OWNER');
  await seedMember('c6', BUYER_ORG, MANAGER, 'MANAGER');
  await seedMember('c7', BUYER_ORG, OWNER, 'MANAGER');

  await prisma.product.create({
    data: { id: RICE, organizationId: SUPPLIER_ORG, name: 'Riz', unit: 'sac', price: 3000n },
  });
  await prisma.product.create({
    data: { id: OIL, organizationId: SUPPLIER_ORG, name: 'Huile', unit: 'litre', price: 1500n },
  });
  await prisma.product.create({
    data: {
      id: INACTIVE_PRODUCT,
      organizationId: SUPPLIER_ORG,
      name: 'Savon',
      unit: 'pain',
      price: 500n,
      status: 'INACTIVE',
    },
  });
  await prisma.product.create({
    data: { id: FOREIGN_PRODUCT, organizationId: OTHER_ORG, name: 'Sel', unit: 'sac', price: 200n },
  });

  await seedRelationship(REL, { personId: CUSTOMER });
  await seedRelationship(REL_GUEST, { personId: GUEST });
  // A PENDING invitation always has a person as supplier (database rule), never an organization.
  await prisma.customerRelationship.create({
    data: {
      id: REL_PENDING,
      supplierPersonId: OUTSIDER,
      customerPersonId: PENDING_CUSTOMER,
      status: 'PENDING',
      createdById: PENDING_CUSTOMER,
    },
  });
  await prisma.customerRelationship.create({
    data: {
      id: REL_ENDED,
      supplierOrganizationId: SUPPLIER_ORG,
      customerPersonId: CUSTOMER_ENDED,
      status: 'ENDED',
      endedByParty: 'SUPPLIER',
      createdById: OWNER,
    },
  });
  await seedRelationship(REL_OWN_MANAGER, { personId: MANAGER });
  await seedRelationship(REL_ORG_BUYER, { organizationId: BUYER_ORG });
  await seedRelationship(REL_COUNTER, {});
  await seedRelationship(
    REL_FOREIGN,
    { personId: CUSTOMER },
    { supplierOrganizationId: OTHER_ORG }
  );
});

describe('PUT /api/v1/organizations/:organizationId/customers/:relationshipId/prices/:productId', () => {
  it('AC-1 create: a manager sets 2800 for an article priced 3000', async () => {
    const response = await put(REL, RICE, { id: G1, price: 2800 });

    expect(response.status).toBe(200);
    const body = bodyOf<PriceBody>(response);
    expect(Object.keys(body).sort()).toEqual([
      'price',
      'product_variant_id',
      'set_at',
      'set_by_id',
    ]);
    expect(body).toMatchObject({ product_variant_id: RICE, price: 2800, set_by_id: MANAGER });
    const rows = await livePrices();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ price: 2800n, setById: MANAGER });
    expect(body.set_at).toBe(rows[0].setAt.toISOString());
  });

  it('an owner sets a price, and a counter relationship can hold one', async () => {
    expect((await put(REL, RICE, { id: G1, price: 2900 }, OWNER)).status).toBe(200);
    expect((await put(REL_COUNTER, RICE, { id: G2, price: 2700 }, OWNER)).status).toBe(200);

    expect((await livePrices(REL))[0].setById).toBe(OWNER);
    expect(await livePrices(REL_COUNTER)).toHaveLength(1);
  });

  it('AC-2 replace: a second price for the same pair leaves one live row, set_at later', async () => {
    const first = bodyOf<PriceBody>(await put(REL, RICE, { id: G1, price: 2800 }));
    const second = await put(REL, RICE, { id: G2, price: 3200 }, OWNER);

    expect(second.status).toBe(200);
    const body = bodyOf<PriceBody>(second);
    expect(body).toMatchObject({ price: 3200, set_by_id: OWNER });
    expect(new Date(body.set_at).getTime()).toBeGreaterThan(new Date(first.set_at).getTime());
    const rows = await livePrices();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ price: 3200n, setById: OWNER });
    expect(await priceRows()).toBe(1);
  });

  it('a price deleted earlier does not block a new live price', async () => {
    await prisma.customerPrice.create({
      data: {
        id: id('e1'),
        customerRelationshipId: REL,
        productId: RICE,
        price: 100n,
        setById: OWNER,
        deletedAt: REG,
      },
    });

    expect((await put(REL, RICE, { id: G1, price: 2800 })).status).toBe(200);

    expect(await livePrices()).toHaveLength(1);
    expect(await priceRows()).toBe(2);
  });

  it('AC-3 a negotiated price above the product price is stored', async () => {
    const response = await put(REL, RICE, { id: G1, price: 3500 });

    expect(response.status).toBe(200);
    expect((await livePrices())[0].price).toBe(3500n);
  });

  it('an INACTIVE product of the organization accepts a price (any status)', async () => {
    expect((await put(REL, INACTIVE_PRODUCT, { id: G1, price: 400 })).status).toBe(200);
  });

  describe('AC-4 notification', () => {
    it('a registered customer gets one unread price.negotiated_changed naming the article', async () => {
      await put(REL, RICE, { id: G1, price: 2800 });

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

    it('a guest customer gets no notification but the price is stored', async () => {
      const response = await put(REL_GUEST, RICE, { id: G1, price: 2800 });

      expect(response.status).toBe(200);
      expect(await prisma.notification.count()).toBe(0);
      expect(await livePrices(REL_GUEST)).toHaveLength(1);
    });

    it('a refused request notifies nobody', async () => {
      await put(REL, RICE, { id: G1, price: 0 });
      await put(REL, FOREIGN_PRODUCT, { id: G2, price: 10 });

      expect(await prisma.notification.count()).toBe(0);
    });
  });

  it('a repeat with the same id changes nothing and returns the first response', async () => {
    const first = await put(REL, RICE, { id: G1, price: 2800 });
    const repeat = await put(REL, RICE, { id: G1, price: 2800 });

    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual(first.body);
    expect(await priceRows()).toBe(1);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('two simultaneous different prices leave one live row (last writer wins)', async () => {
    const [a, b] = await Promise.all([
      put(REL, RICE, { id: G1, price: 2800 }, MANAGER),
      put(REL, RICE, { id: G2, price: 3100 }, OWNER),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await livePrices()).toHaveLength(1);
  });

  describe('AC-5 refusals', () => {
    it.each([
      ['price 0', REL, RICE, { id: G1, price: 0 }, MANAGER, 400, 'VALIDATION_ERROR'],
      ['price 1.5', REL, RICE, { id: G1, price: 1.5 }, MANAGER, 400, 'VALIDATION_ERROR'],
      ['price "2800"', REL, RICE, { id: G1, price: '2800' }, MANAGER, 400, 'VALIDATION_ERROR'],
      ['price 1e21', REL, RICE, { id: G1, price: 1e21 }, MANAGER, 400, 'VALIDATION_ERROR'],
      ['no price', REL, RICE, { id: G1 }, MANAGER, 400, 'VALIDATION_ERROR'],
      ['no id', REL, RICE, { price: 2800 }, MANAGER, 400, 'VALIDATION_ERROR'],
      [
        'an unknown field',
        REL,
        RICE,
        { id: G1, price: 2800, set_by_id: OWNER },
        MANAGER,
        400,
        'VALIDATION_ERROR',
      ],
      [
        'a malformed product id',
        REL,
        'not-a-uuid',
        { id: G1, price: 2800 },
        MANAGER,
        400,
        'VALIDATION_ERROR',
      ],
      [
        'a product of another business',
        REL,
        FOREIGN_PRODUCT,
        { id: G1, price: 2800 },
        MANAGER,
        404,
        'NOT_FOUND',
      ],
      ['an unknown product', REL, id('99'), { id: G1, price: 2800 }, MANAGER, 404, 'NOT_FOUND'],
      ['a SELLER caller', REL, RICE, { id: G1, price: 2800 }, SELLER, 403, 'FORBIDDEN'],
      ['a DRIVER caller', REL, RICE, { id: G1, price: 2800 }, DRIVER, 403, 'FORBIDDEN'],
      [
        'a manager on their own customer record',
        REL_OWN_MANAGER,
        RICE,
        { id: G1, price: 2800 },
        MANAGER,
        403,
        'OWN_RECORD',
      ],
      [
        'a manager of the customer organization',
        REL_ORG_BUYER,
        RICE,
        { id: G1, price: 2800 },
        MANAGER,
        403,
        'OWN_RECORD',
      ],
      [
        'an ENDED relationship',
        REL_ENDED,
        RICE,
        { id: G1, price: 2800 },
        MANAGER,
        409,
        'RELATIONSHIP_NOT_ACTIVE',
      ],
      [
        'a PENDING invitation (supplier is a person, so outside the organization)',
        REL_PENDING,
        RICE,
        { id: G1, price: 2800 },
        MANAGER,
        404,
        'NOT_FOUND',
      ],
    ])('%s', async (_name, relationshipId, productId, body, caller, status, code) => {
      const response = await put(relationshipId, productId, body, caller);

      expect(response.status).toBe(status);
      expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
      expect(await priceRows()).toBe(0);
    });

    it('a refused request does not reserve the gesture id', async () => {
      await put(REL, RICE, { id: G1, price: 0 });

      expect((await put(REL, RICE, { id: G1, price: 2800 })).status).toBe(200);
    });
  });

  describe('security', () => {
    it('AB-1 a SELLER or DRIVER cannot set a price and nothing is stored', async () => {
      const seller = await put(REL, RICE, { id: G1, price: 1 }, SELLER);
      const driver = await put(REL, RICE, { id: G2, price: 1 }, DRIVER);

      expect([seller.status, driver.status]).toEqual([403, 403]);
      expect(await priceRows()).toBe(0);
    });

    it('AB-1 a seller cannot overwrite an existing price', async () => {
      await put(REL, RICE, { id: G1, price: 2800 });

      await put(REL, RICE, { id: G2, price: 1 }, SELLER);

      expect((await livePrices())[0].price).toBe(2800n);
    });

    it('AB-2 a manager who is the customer person cannot set their own price', async () => {
      const response = await put(REL_OWN_MANAGER, RICE, { id: G1, price: 1 });

      expect(response.status).toBe(403);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
      expect(await priceRows()).toBe(0);
    });

    it('AB-2 a supplier owner who also manages the customer organization is refused too', async () => {
      const response = await put(REL_ORG_BUYER, RICE, { id: G1, price: 1 }, OWNER);

      expect(bodyOf<ErrorBody>(response).error.code).toBe('OWN_RECORD');
    });

    it('AB-3 a relationship of another business answers 404 and stores nothing', async () => {
      const response = await put(REL_FOREIGN, RICE, { id: G1, price: 1 });

      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(await priceRows()).toBe(0);
    });

    it('AB-3 a product of another business answers 404 even with the caller own relationship', async () => {
      const response = await put(REL, FOREIGN_PRODUCT, { id: G1, price: 1 });

      expect(response.status).toBe(404);
      expect(await priceRows()).toBe(0);
    });

    it('AB-3 an outside organization path answers 404 for a non member', async () => {
      const response = await put(REL, RICE, { id: G1, price: 1 }, OTHER_OWNER, SUPPLIER_ORG);

      expect(response.status).toBe(404);
      expect(await priceRows()).toBe(0);
    });

    it('AB-3 a manager of another business cannot reach this relationship through their own organization', async () => {
      const response = await put(REL, RICE, { id: G1, price: 1 }, OTHER_OWNER, OTHER_ORG);

      expect(response.status).toBe(404);
      expect(await priceRows()).toBe(0);
    });

    it('requires authentication', async () => {
      const response = await request(app)
        .put(`/api/v1/organizations/${SUPPLIER_ORG}/customers/${REL}/prices/${RICE}`)
        .send({ id: G3, price: 1 });

      expect(response.status).toBe(401);
      expect(await priceRows()).toBe(0);
    });
  });
});
