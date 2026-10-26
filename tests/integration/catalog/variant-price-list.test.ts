import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';
import { seedProduct } from '../../helpers/catalog-fixtures.js';

const id = (n: string) => `0199c0d6-0000-7000-8000-0000000000${n}`;

const OWNER = id('01');
const MANAGER = id('02');
const SELLER = id('03');
const DRIVER = id('04');
const CUSTOMER = id('05');
const OTHER_OWNER = id('08');

const SUPPLIER_ORG = id('a1');
const OTHER_ORG = id('a3');

const RICE = id('b1'); // product and its first variant share this id
const RICE_BAG = RICE;
const RICE_SACK = id('b2'); // second variant of the same product
const FOREIGN_PRODUCT = id('b4');

const REL = id('d1');
const REL_OWN = id('d4');
const REL_FOREIGN = id('d6');

const REG = new Date('2026-01-01T00:00:00.000Z');
const OLD = new Date('2026-02-01T08:00:00.000Z');
const FUTURE = new Date('2099-01-01T00:00:00.000Z');

type Item = {
  product_variant_id: string;
  label: string;
  price: number;
  variant_price: number;
  set_by_id: string;
  set_at: string;
  to_review: boolean;
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
  role: 'OWNER' | 'MANAGER' | 'SELLER' | 'DRIVER'
) {
  await prisma.collaboration.create({
    data: { id: id(n), personId, organizationId: orgId, role, status: 'ACTIVE', acceptedAt: REG },
  });
}

async function seedRelationship(
  relId: string,
  customerPersonId: string,
  supplierOrganizationId = SUPPLIER_ORG
) {
  await prisma.customerRelationship.create({
    data: {
      id: relId,
      supplierOrganizationId,
      customerPersonId,
      status: 'ACTIVE',
      createdById: OWNER,
    },
  });
}

async function seedPrice(
  n: string,
  relationshipId: string,
  productId: string,
  variantId: string,
  price: bigint,
  setAt: Date
) {
  await prisma.customerPrice.create({
    data: {
      id: id(n),
      customerRelationshipId: relationshipId,
      productId,
      productVariantId: variantId,
      price,
      setById: OWNER,
      setAt,
    },
  });
}

const base = (organizationId = SUPPLIER_ORG) => `/api/v1/organizations/${organizationId}/customers`;

const list = (relationshipId: string, caller = SELLER, organizationId = SUPPLIER_ORG) =>
  createAuthenticatedRequest(app, caller).get(`${base(organizationId)}/${relationshipId}/prices`);

const remove = (
  relationshipId: string,
  variantId: string,
  caller = MANAGER,
  organizationId = SUPPLIER_ORG
) =>
  createAuthenticatedRequest(app, caller).delete(
    `${base(organizationId)}/${relationshipId}/prices/${variantId}`
  );

beforeEach(async () => {
  await seedPerson(OWNER, '+237600009601');
  await seedPerson(MANAGER, '+237600009602');
  await seedPerson(SELLER, '+237600009603');
  await seedPerson(DRIVER, '+237600009604');
  await seedPerson(CUSTOMER, '+237600009605');
  await seedPerson(OTHER_OWNER, '+237600009608');

  await prisma.organization.create({ data: { id: SUPPLIER_ORG, name: 'Supplier' } });
  await prisma.organization.create({ data: { id: OTHER_ORG, name: 'Other' } });
  await seedMember('c1', SUPPLIER_ORG, OWNER, 'OWNER');
  await seedMember('c2', SUPPLIER_ORG, MANAGER, 'MANAGER');
  await seedMember('c3', SUPPLIER_ORG, SELLER, 'SELLER');
  await seedMember('c4', SUPPLIER_ORG, DRIVER, 'DRIVER');
  await seedMember('c5', OTHER_ORG, OTHER_OWNER, 'OWNER');

  await seedProduct(prisma, {
    id: RICE,
    organizationId: SUPPLIER_ORG,
    name: 'Riz',
    unit: 'sac',
    price: 3000n,
  });
  await prisma.productVariant.create({
    data: {
      id: RICE_SACK,
      productId: RICE,
      organizationId: SUPPLIER_ORG,
      name: 'Parfumé',
      unit: 'kg',
      price: 900n,
      imageKeys: [],
    },
  });
  // First variant's price changed long after the price was set; the second one's never did.
  await prisma.productVariant.update({
    where: { id: RICE_BAG },
    data: { priceUpdatedAt: new Date('2026-03-01T08:00:00.000Z') },
  });
  await prisma.productVariant.update({
    where: { id: RICE_SACK },
    data: { priceUpdatedAt: OLD },
  });

  await seedRelationship(REL, CUSTOMER);
  await seedRelationship(REL_OWN, MANAGER);
  await seedRelationship(REL_FOREIGN, CUSTOMER, OTHER_ORG);
});

describe('negotiated prices listed by variant', () => {
  it('AC-1 lists labels and variant prices; only the older price is to review (C-11)', async () => {
    await seedPrice('e1', REL, RICE, RICE_BAG, 2800n, OLD);
    await seedPrice('e2', REL, RICE, RICE_SACK, 850n, FUTURE);

    const response = await list(REL, SELLER);

    expect(response.status).toBe(200);
    const page = bodyOf<Page>(response);
    expect(page.items).toHaveLength(2);
    const bag = page.items.find((item) => item.product_variant_id === RICE_BAG)!;
    const sack = page.items.find((item) => item.product_variant_id === RICE_SACK)!;
    expect(Object.keys(bag).sort()).toEqual([
      'label',
      'price',
      'product_variant_id',
      'set_at',
      'set_by_id',
      'to_review',
      'variant_price',
    ]);
    expect(bag).toMatchObject({
      label: 'Riz — sac',
      price: 2800,
      variant_price: 3000,
      set_by_id: OWNER,
      to_review: true,
    });
    expect(sack).toMatchObject({
      label: 'Riz — Parfumé (kg)',
      price: 850,
      variant_price: 900,
      to_review: false,
    });
  });

  it('AC-2 a MANAGER removes the first variant price: 204, listed once, repeat 404', async () => {
    await seedPrice('e1', REL, RICE, RICE_BAG, 2800n, OLD);
    await seedPrice('e2', REL, RICE, RICE_SACK, 850n, FUTURE);

    const response = await remove(REL, RICE_BAG, MANAGER);

    expect(response.status).toBe(204);
    const row = await prisma.customerPrice.findUniqueOrThrow({ where: { id: id('e1') } });
    expect(row.deletedAt).not.toBeNull();
    const page = bodyOf<Page>(await list(REL, SELLER));
    expect(page.items.map((item) => item.product_variant_id)).toEqual([RICE_SACK]);

    const repeat = await remove(REL, RICE_BAG, MANAGER);
    expect(repeat.status).toBe(404);
    expect(bodyOf<ErrorBody>(repeat).error.code).toBe('NOT_FOUND');
  });

  it('removing a variant price leaves the other variant of the product untouched and names the label', async () => {
    await seedPrice('e1', REL, RICE, RICE_BAG, 2800n, OLD);
    await seedPrice('e2', REL, RICE, RICE_SACK, 850n, FUTURE);

    expect((await remove(REL, RICE_SACK, OWNER)).status).toBe(204);

    const live = await prisma.customerPrice.findMany({ where: { deletedAt: null } });
    expect(live.map((row) => row.id)).toEqual([id('e1')]);
    const notifications = await prisma.notification.findMany({
      where: { sourceEvent: 'price.negotiated_changed' },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].recipientId).toBe(CUSTOMER);
    expect(notifications[0].content).toContain('Riz — Parfumé (kg)');
  });

  describe('AC-3 refusals', () => {
    it.each([
      ['a DRIVER lists', 'list', REL, DRIVER, 403, 'FORBIDDEN'],
      ['a SELLER deletes', 'remove', REL, SELLER, 403, 'FORBIDDEN'],
      ['the caller is the customer person', 'remove', REL_OWN, MANAGER, 403, 'OWN_RECORD'],
      ['the relationship is another business', 'remove', REL_FOREIGN, OWNER, 404, 'NOT_FOUND'],
    ])('%s', async (_name, action, relationshipId, caller, status, code) => {
      await seedPrice('e1', REL, RICE, RICE_BAG, 2800n, OLD);
      await seedPrice('e2', REL_OWN, RICE, RICE_BAG, 2800n, OLD);

      const response =
        action === 'list'
          ? await list(relationshipId, caller)
          : await remove(relationshipId, RICE_BAG, caller);

      expect(response.status).toBe(status);
      expect(bodyOf<ErrorBody>(response).error.code).toBe(code);
      expect(await prisma.customerPrice.count({ where: { deletedAt: null } })).toBe(2);
      expect(await prisma.notification.count()).toBe(0);
    });
  });

  it('AB-1 a member of A lists the prices of a relationship of B: 404, nothing returned', async () => {
    await seedProduct(prisma, {
      id: FOREIGN_PRODUCT,
      organizationId: OTHER_ORG,
      name: 'Sel',
      unit: 'sac',
      price: 9n,
    });
    await seedPrice('e1', REL_FOREIGN, FOREIGN_PRODUCT, FOREIGN_PRODUCT, 1n, OLD);

    const response = await list(REL_FOREIGN, OWNER);

    expect(response.status).toBe(404);
    expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
    expect(response.text).not.toContain('Sel');
  });

  it("a variant of another business can't be removed through one's own relationship (404)", async () => {
    await seedProduct(prisma, {
      id: FOREIGN_PRODUCT,
      organizationId: OTHER_ORG,
      name: 'Sel',
      unit: 'sac',
      price: 9n,
    });
    await seedPrice('e1', REL, RICE, RICE_BAG, 2800n, OLD);

    const response = await remove(REL, FOREIGN_PRODUCT, OWNER);

    expect(response.status).toBe(404);
    expect(await prisma.customerPrice.count({ where: { deletedAt: null } })).toBe(1);
  });
});
