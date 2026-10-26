import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf, type ErrorBody } from '../../helpers/body.js';
import { createAuthenticatedRequest } from '../../helpers/request.js';
import { prisma } from '../../setup.js';

const id = (n: string) => `0199c0c8-0000-7000-8000-0000000000${n}`;

const SUPPLIER_OWNER = id('01');
const CUSTOMER_A = id('02');
const CUSTOMER_B = id('03');
const BUYER_MANAGER = id('04');
const BUYER_SELLER = id('05');
const BUYER_OWNER = id('06');

const SUPPLIER_ORG = id('a1');
const BUYER_ORG = id('a2');

const P_RICE = id('b1'); // two ACTIVE variants and one INACTIVE
const P_OIL = id('b2'); // all variants INACTIVE
const P_SOAP = id('b3'); // paused
const P_SALT = id('b4'); // deleted
const P_FLOUR = id('b5'); // a deleted variant and an ACTIVE one

const V_RICE_50 = id('c1');
const V_RICE_25 = id('c2');
const V_RICE_OLD = id('c3');
const V_OIL = id('c4');
const V_SOAP = id('c5');
const V_SALT = id('c6');
const V_FLOUR_DELETED = id('c7');
const V_FLOUR_LIVE = id('c8');

const REG = new Date('2026-01-01T00:00:00.000Z');

type Variant = {
  id: string;
  name: string | null;
  unit: string;
  label: string;
  price: number;
  min_order_quantity: string | null;
  price_is_negotiated: boolean;
  image_urls: string[];
};
type Item = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  image_urls: string[];
  variants: Variant[];
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

async function seedProduct(
  productId: string,
  name: string,
  createdAt: string,
  extra: { pausedAt?: Date; deletedAt?: Date } = {}
) {
  await prisma.product.create({
    data: {
      id: productId,
      organizationId: SUPPLIER_ORG,
      name,
      category: 'Epicerie',
      createdAt: new Date(createdAt),
      pausedAt: extra.pausedAt ?? null,
      deletedAt: extra.deletedAt ?? null,
    },
  });
}

async function seedVariant(
  variantId: string,
  productId: string,
  data: {
    name: string | null;
    unit: string;
    price: bigint;
    createdAt: string;
    status?: 'ACTIVE' | 'INACTIVE';
    deletedAt?: Date;
  }
) {
  await prisma.productVariant.create({
    data: {
      id: variantId,
      productId,
      organizationId: SUPPLIER_ORG,
      name: data.name,
      unit: data.unit,
      price: data.price,
      status: data.status ?? 'ACTIVE',
      createdAt: new Date(data.createdAt),
      deletedAt: data.deletedAt ?? null,
      imageKeys: [],
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

async function seedNegotiated(
  n: string,
  relId: string,
  productId: string,
  variantId: string,
  price: bigint
) {
  await prisma.customerPrice.create({
    data: {
      id: id(n),
      customerRelationshipId: relId,
      productVariantId: variantId,
      price,
      setById: SUPPLIER_OWNER,
    },
  });
}

function browse(personId: string, query = '') {
  return createAuthenticatedRequest(app, personId).get(
    `/api/v1/organizations/${SUPPLIER_ORG}/catalog${query}`
  );
}

const itemOf = (page: Page, productId: string) => page.items.find((item) => item.id === productId);

beforeEach(async () => {
  await seedPerson(SUPPLIER_OWNER, '+237600009401');
  await seedPerson(CUSTOMER_A, '+237600009402');
  await seedPerson(CUSTOMER_B, '+237600009403');
  await seedPerson(BUYER_MANAGER, '+237600009404');
  await seedPerson(BUYER_SELLER, '+237600009405');
  await prisma.organization.create({ data: { id: SUPPLIER_ORG, name: 'Supplier' } });
  await prisma.organization.create({ data: { id: BUYER_ORG, name: 'Buyer' } });
  await seedPerson(BUYER_OWNER, '+237600009406');
  await prisma.collaboration.create({
    data: {
      id: id('d3'),
      personId: BUYER_OWNER,
      organizationId: BUYER_ORG,
      role: 'OWNER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await prisma.collaboration.create({
    data: {
      id: id('d1'),
      personId: BUYER_MANAGER,
      organizationId: BUYER_ORG,
      role: 'MANAGER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });
  await prisma.collaboration.create({
    data: {
      id: id('d2'),
      personId: BUYER_SELLER,
      organizationId: BUYER_ORG,
      role: 'SELLER',
      status: 'ACTIVE',
      acceptedAt: REG,
    },
  });

  await seedProduct(P_RICE, 'Riz', '2026-02-01T00:00:00Z');
  await seedProduct(P_OIL, 'Huile', '2026-02-02T00:00:00Z');
  await seedProduct(P_SOAP, 'Savon', '2026-02-03T00:00:00Z', { pausedAt: REG });
  await seedProduct(P_SALT, 'Sel', '2026-02-04T00:00:00Z', { deletedAt: REG });
  await seedProduct(P_FLOUR, 'Farine', '2026-02-05T00:00:00Z');

  // The 25 kg bag is older than the 50 kg bag: variants come oldest first.
  await seedVariant(V_RICE_25, P_RICE, {
    name: '25 kg',
    unit: 'sac',
    price: 1600n,
    createdAt: '2026-02-01T00:00:00Z',
  });
  await seedVariant(V_RICE_50, P_RICE, {
    name: '50 kg',
    unit: 'sac',
    price: 3000n,
    createdAt: '2026-02-01T00:00:01Z',
  });
  await seedVariant(V_RICE_OLD, P_RICE, {
    name: 'vrac',
    unit: 'kg',
    price: 100n,
    createdAt: '2026-02-01T00:00:02Z',
    status: 'INACTIVE',
  });
  await seedVariant(V_OIL, P_OIL, {
    name: null,
    unit: 'bidon',
    price: 1500n,
    createdAt: '2026-02-02T00:00:00Z',
    status: 'INACTIVE',
  });
  await seedVariant(V_SOAP, P_SOAP, {
    name: null,
    unit: 'carton',
    price: 500n,
    createdAt: '2026-02-03T00:00:00Z',
  });
  await seedVariant(V_SALT, P_SALT, {
    name: null,
    unit: 'sac',
    price: 200n,
    createdAt: '2026-02-04T00:00:00Z',
    deletedAt: REG,
  });
  await seedVariant(V_FLOUR_DELETED, P_FLOUR, {
    name: '10 kg',
    unit: 'sac',
    price: 900n,
    createdAt: '2026-02-05T00:00:00Z',
    deletedAt: REG,
  });
  await seedVariant(V_FLOUR_LIVE, P_FLOUR, {
    name: '5 kg',
    unit: 'sac',
    price: 500n,
    createdAt: '2026-02-05T00:00:01Z',
  });
});

describe('GET /api/v1/organizations/:organizationId/catalog by product and variant', () => {
  it('AC-1 a product appears once with its ACTIVE variants, oldest first, and their labels', async () => {
    const response = await browse(CUSTOMER_A);

    expect(response.status).toBe(200);
    const page = bodyOf<Page>(response);
    const rice = itemOf(page, P_RICE)!;
    expect(Object.keys(rice).sort()).toEqual(
      ['category', 'description', 'id', 'image_urls', 'name', 'variants'].sort()
    );
    expect(rice.variants.map((v) => v.id)).toEqual([V_RICE_25, V_RICE_50]);
    expect(rice.variants.map((v) => v.label)).toEqual(['Riz — 25 kg (sac)', 'Riz — 50 kg (sac)']);
    expect(Object.keys(rice.variants[0]).sort()).toEqual(
      [
        'id',
        'image_urls',
        'label',
        'min_order_quantity',
        'name',
        'price',
        'price_is_negotiated',
        'unit',
      ].sort()
    );
    expect(page.items.filter((item) => item.id === P_RICE)).toHaveLength(1);
    expect(page.items.map((item) => item.id)).toEqual([P_FLOUR, P_RICE]);
    expect(page.next_cursor).toBeNull();
  });

  it('AC-1 a variant image_urls holds its own photos only', async () => {
    await prisma.productVariant.update({
      where: { id: V_RICE_50 },
      data: { imageKeys: ['products/1b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp'] },
    });
    await prisma.product.update({
      where: { id: P_RICE },
      data: { imageKeys: ['products/0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.webp'] },
    });

    const rice = itemOf(bodyOf<Page>(await browse(CUSTOMER_A)), P_RICE)!;

    expect(rice.image_urls).toHaveLength(1);
    expect(rice.variants[0].image_urls).toEqual([]);
    expect(rice.variants[1].image_urls).toHaveLength(1);
    expect(rice.variants[1].image_urls[0]).not.toBe(rice.image_urls[0]);
  });

  it('AC-2 CM-11 my negotiated price shows on its variant only', async () => {
    await seedRelationship(id('e1'), { personId: CUSTOMER_A });
    await seedNegotiated('f1', id('e1'), P_RICE, V_RICE_50, 2800n);

    const rice = itemOf(bodyOf<Page>(await browse(CUSTOMER_A)), P_RICE)!;

    const first = rice.variants.find((v) => v.id === V_RICE_50)!;
    const second = rice.variants.find((v) => v.id === V_RICE_25)!;
    expect(first).toMatchObject({ price: 2800, price_is_negotiated: true });
    expect(second).toMatchObject({ price: 1600, price_is_negotiated: false });
  });

  it('AC-2 CM-11 a negotiated price above the variant price still shows', async () => {
    await seedRelationship(id('e1'), { personId: CUSTOMER_A });
    await seedNegotiated('f1', id('e1'), P_RICE, V_RICE_50, 3500n);

    const rice = itemOf(bodyOf<Page>(await browse(CUSTOMER_A)), P_RICE)!;

    expect(rice.variants.find((v) => v.id === V_RICE_50)).toMatchObject({
      price: 3500,
      price_is_negotiated: true,
    });
  });

  it('AC-3 left out: all variants INACTIVE, paused, deleted product, deleted variant', async () => {
    const page = bodyOf<Page>(await browse(CUSTOMER_A));
    const ids = page.items.map((item) => item.id);

    expect(ids).not.toContain(P_OIL);
    expect(ids).not.toContain(P_SOAP);
    expect(ids).not.toContain(P_SALT);
    const flour = itemOf(page, P_FLOUR)!;
    expect(flour.variants.map((v) => v.id)).toEqual([V_FLOUR_LIVE]);
    const rice = itemOf(page, P_RICE)!;
    expect(rice.variants.map((v) => v.id)).not.toContain(V_RICE_OLD);
  });

  it('AC-3 a negotiated price on a withdrawn variant does not bring it back', async () => {
    await seedRelationship(id('e1'), { personId: CUSTOMER_A });
    await seedNegotiated('f1', id('e1'), P_OIL, V_OIL, 1200n);

    const page = bodyOf<Page>(await browse(CUSTOMER_A));

    expect(page.items.map((item) => item.id)).not.toContain(P_OIL);
  });

  it('AC-2 a deleted negotiated price is ignored', async () => {
    await seedRelationship(id('e1'), { personId: CUSTOMER_A });
    await prisma.customerPrice.create({
      data: {
        id: id('f1'),
        customerRelationshipId: id('e1'),
        productVariantId: V_RICE_50,
        price: 2800n,
        setById: SUPPLIER_OWNER,
        deletedAt: REG,
      },
    });

    const rice = itemOf(bodyOf<Page>(await browse(CUSTOMER_A)), P_RICE)!;

    expect(rice.variants.find((v) => v.id === V_RICE_50)).toMatchObject({
      price: 3000,
      price_is_negotiated: false,
    });
  });

  it('AC-2 a MANAGER on behalf of the organization gets the organization relationship prices', async () => {
    await seedRelationship(id('e2'), { organizationId: BUYER_ORG });
    await seedRelationship(id('e3'), { personId: BUYER_MANAGER });
    await seedNegotiated('f1', id('e2'), P_RICE, V_RICE_50, 2700n);
    await seedNegotiated('f2', id('e3'), P_RICE, V_RICE_50, 2000n);

    const onBehalf = itemOf(
      bodyOf<Page>(await browse(BUYER_MANAGER, `?as_organization_id=${BUYER_ORG}`)),
      P_RICE
    )!;
    const asPerson = itemOf(bodyOf<Page>(await browse(BUYER_MANAGER)), P_RICE)!;

    expect(onBehalf.variants.find((v) => v.id === V_RICE_50)?.price).toBe(2700);
    expect(asPerson.variants.find((v) => v.id === V_RICE_50)?.price).toBe(2000);
  });

  it('AC-4 as_organization_id the caller is not MANAGER or OWNER of answers 404', async () => {
    await seedRelationship(id('e2'), { organizationId: BUYER_ORG });
    await seedNegotiated('f1', id('e2'), P_RICE, V_RICE_50, 2700n);

    const seller = await browse(BUYER_SELLER, `?as_organization_id=${BUYER_ORG}`);
    const stranger = await browse(CUSTOMER_A, `?as_organization_id=${BUYER_ORG}`);

    for (const response of [seller, stranger]) {
      expect(response.status).toBe(404);
      expect(bodyOf<ErrorBody>(response).error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain('2700');
    }
  });

  it('pages are of products, newest first, with no overlap', async () => {
    const first = bodyOf<Page>(await browse(CUSTOMER_A, '?limit=1'));
    expect(first.items.map((item) => item.id)).toEqual([P_FLOUR]);
    expect(first.next_cursor).not.toBeNull();

    const second = bodyOf<Page>(
      await browse(CUSTOMER_A, `?limit=1&cursor=${encodeURIComponent(first.next_cursor!)}`)
    );
    expect(second.items.map((item) => item.id)).toEqual([P_RICE]);
    expect(second.items[0].variants).toHaveLength(2);
    expect(second.next_cursor).toBeNull();
  });

  it('AB-1 another customer negotiated price appears in no field', async () => {
    await seedRelationship(id('e1'), { personId: CUSTOMER_A });
    await seedRelationship(id('e4'), { personId: CUSTOMER_B });
    await seedNegotiated('f1', id('e1'), P_RICE, V_RICE_50, 2811n);
    await seedNegotiated('f2', id('e4'), P_RICE, V_RICE_50, 2622n);

    const a = await browse(CUSTOMER_A);
    const b = await browse(CUSTOMER_B);

    const priceA = itemOf(bodyOf<Page>(a), P_RICE)!.variants.find((v) => v.id === V_RICE_50);
    const priceB = itemOf(bodyOf<Page>(b), P_RICE)!.variants.find((v) => v.id === V_RICE_50);
    expect(priceA?.price).toBe(2811);
    expect(priceB?.price).toBe(2622);
    expect(JSON.stringify(a.body)).not.toContain('2622');
    expect(JSON.stringify(b.body)).not.toContain('2811');
  });
});
