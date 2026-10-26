import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { customerPricesAdapter } from '../../../src/modules/sync/adapters/relationship.adapter.js';
import type { Viewer } from '../../../src/modules/sync/sync.types.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const OWNER_A = '0199e034-0000-7000-8000-000000000001';
const OWNER_B = '0199e034-0000-7000-8000-000000000002';
const CUSTOMER = '0199e034-0000-7000-8000-000000000003';
const CUSTOMER_B = '0199e034-0000-7000-8000-000000000004';
const ORG_A = '0199e034-0000-7000-8000-0000000000a1';
const ORG_B = '0199e034-0000-7000-8000-0000000000b1';
const PRODUCT_A = '0199e034-0000-7000-8000-0000000000d1';
const PRODUCT_B = '0199e034-0000-7000-8000-0000000000d2';
const VARIANT_1 = '0199e034-0000-7000-8000-0000000000e1';
const VARIANT_2 = '0199e034-0000-7000-8000-0000000000e2';
const VARIANT_B = '0199e034-0000-7000-8000-0000000000e4';
const REL = '0199e034-0000-7000-8000-000000000021';
const REL_DELETED = '0199e034-0000-7000-8000-000000000022';
const REL_B = '0199e034-0000-7000-8000-000000000023';
const PRICE_1 = '0199e034-0000-7000-8000-000000000041';
const PRICE_2 = '0199e034-0000-7000-8000-000000000042';
const PRICE_3 = '0199e034-0000-7000-8000-000000000043';
const PRICE_B = '0199e034-0000-7000-8000-000000000044';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type PushBody = {
  accepted: number;
  aside: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
};

const devices: Record<string, string> = {};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const push = async (personId: string, changes: unknown) =>
  createAuthenticatedRequest(app, personId, devices[personId])
    .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
    .send({ changes });

const table = (part: Partial<{ created: unknown[]; updated: unknown[]; deleted: string[] }>) => ({
  created: [],
  updated: [],
  deleted: [],
  ...part,
});

const priceRow = (id: string, variantId: string, price: number, relationshipId = REL) => ({
  id,
  customer_relationship_id: relationshipId,
  product_variant_id: variantId,
  price,
});

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Price Person',
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${phone.slice(1)}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
  devices[id] = `0199e034-0000-7000-8000-0000000007${phone.slice(-2)}`;
  await prisma.device.create({
    data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
  });
}

async function seedOwner(suffix: string, personId: string, org: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e034-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

async function seedPrice(id: string, relationshipId: string, variantId: string, price: bigint) {
  const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  await prisma.customerPrice.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      productId: variant.productId,
      productVariantId: variantId,
      price,
      setById: relationshipId === REL_B ? OWNER_B : OWNER_A,
    },
  });
}

const priceRowOf = (id: string) => prisma.customerPrice.findUniqueOrThrow({ where: { id } });
const livePricesOf = (relationshipId: string, variantId: string) =>
  prisma.customerPrice.findMany({
    where: { customerRelationshipId: relationshipId, productVariantId: variantId, deletedAt: null },
  });

describe('the owner sets and removes negotiated prices (SYNC-034)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER_A, '+237600003401');
    await seedPerson(OWNER_B, '+237600003402');
    for (const [id, phone] of [
      [CUSTOMER, '+237600003403'],
      [CUSTOMER_B, '+237600003404'],
    ]) {
      await prisma.person.create({
        data: {
          id,
          fullName: 'Customer Person',
          phoneNumber: phone,
          phoneVerifiedAt: LONG_AGO,
          passwordHash: 'test-password-hash',
          registeredAt: LONG_AGO,
        },
      });
    }
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedOwner('01', OWNER_A, ORG_A);
    await seedOwner('02', OWNER_B, ORG_B);
    await prisma.customerRelationship.create({
      data: {
        id: REL,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        createdById: OWNER_A,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        id: REL_DELETED,
        supplierOrganizationId: ORG_A,
        customerLabel: 'Gone',
        createdById: OWNER_A,
        deletedAt: LONG_AGO,
      },
    });
    await prisma.customerRelationship.create({
      data: {
        id: REL_B,
        supplierOrganizationId: ORG_B,
        customerPersonId: CUSTOMER_B,
        createdById: OWNER_B,
      },
    });
    await prisma.product.create({ data: { id: PRODUCT_A, organizationId: ORG_A, name: 'Riz' } });
    await prisma.product.create({ data: { id: PRODUCT_B, organizationId: ORG_B, name: 'Jus' } });
    for (const [id, name] of [
      [VARIANT_1, 'sac 5 kg'],
      [VARIANT_2, 'sac 25 kg'],
    ]) {
      await prisma.productVariant.create({
        data: { id, productId: PRODUCT_A, organizationId: ORG_A, name, unit: 'sac', price: 8000n },
      });
    }
    await prisma.productVariant.create({
      data: {
        id: VARIANT_B,
        productId: PRODUCT_B,
        organizationId: ORG_B,
        name: 'carton',
        unit: 'carton',
        price: 5000n,
      },
    });
    await sleep(5);
  });

  it('stores a new price for the pair, authored by the owner (AC-1)', async () => {
    const response = await push(OWNER_A, {
      customer_prices: table({ created: [priceRow(PRICE_1, VARIANT_1, 6000)] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, aside: 0, rejected: [] });
    expect(await priceRowOf(PRICE_1)).toMatchObject({
      customerRelationshipId: REL,
      productVariantId: VARIANT_1,
      price: 6000n,
      setById: OWNER_A,
      deletedAt: null,
    });
  });

  it('keeps one live price when the pair was entered on two phones (AC-2, C-11)', async () => {
    await seedPrice(PRICE_2, REL, VARIANT_1, 5000n);

    const response = await push(OWNER_A, {
      customer_prices: table({ created: [priceRow(PRICE_1, VARIANT_1, 6000)] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, aside: 0, rejected: [] });
    const live = await livePricesOf(REL, VARIANT_1);
    expect(live.map((p) => [p.id, p.price])).toEqual([[PRICE_1, 6000n]]);
    expect((await priceRowOf(PRICE_2)).deletedAt).not.toBeNull();
  });

  it('changes then deletes a price, and the repeat changes nothing (AC-3)', async () => {
    await seedPrice(PRICE_1, REL, VARIANT_1, 5000n);

    const changed = await push(OWNER_A, {
      customer_prices: table({ updated: [priceRow(PRICE_1, VARIANT_1, 7000)] }),
    });
    expect(bodyOf<PushBody>(changed)).toMatchObject({ accepted: 1, aside: 0, rejected: [] });
    expect(await priceRowOf(PRICE_1)).toMatchObject({ price: 7000n, deletedAt: null });
    await sleep(5);

    const removed = await push(OWNER_A, { customer_prices: table({ deleted: [PRICE_1] }) });
    expect(bodyOf<PushBody>(removed)).toMatchObject({ accepted: 1, aside: 0, rejected: [] });
    const afterRemoval = await priceRowOf(PRICE_1);
    expect(afterRemoval.deletedAt).not.toBeNull();
    await sleep(5);

    const again = await push(OWNER_A, { customer_prices: table({ deleted: [PRICE_1] }) });
    expect(bodyOf<PushBody>(again)).toMatchObject({ accepted: 1, aside: 0, rejected: [] });
    const afterRepeat = await priceRowOf(PRICE_1);
    expect(afterRepeat.deletedAt).toEqual(afterRemoval.deletedAt);
    expect(afterRepeat.serverUpdatedAt).toEqual(afterRemoval.serverUpdatedAt);
  });

  it('accepts the same value again without moving any date (AC-3)', async () => {
    await seedPrice(PRICE_1, REL, VARIANT_1, 5000n);
    const before = await priceRowOf(PRICE_1);
    await sleep(5);

    const response = await push(OWNER_A, {
      customer_prices: table({ updated: [priceRow(PRICE_1, VARIANT_1, 5000)] }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, aside: 0, rejected: [] });
    expect((await priceRowOf(PRICE_1)).serverUpdatedAt).toEqual(before.serverUpdatedAt);
  });

  it('sets aside a zero price, a deleted relationship and a foreign variant, and passes the rest (AC-4)', async () => {
    const response = await push(OWNER_A, {
      customer_prices: table({
        created: [
          priceRow(PRICE_1, VARIANT_1, 0),
          priceRow(PRICE_2, VARIANT_1, 6000, REL_DELETED),
          priceRow(PRICE_3, VARIANT_B, 6000),
          priceRow('0199e034-0000-7000-8000-000000000045', VARIANT_2, 4500),
        ],
      }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, aside: 3, rejected: [] });
    for (const id of [PRICE_1, PRICE_2, PRICE_3]) {
      expect(await prisma.customerPrice.findUnique({ where: { id } })).toBeNull();
    }
    expect(await livePricesOf(REL, VARIANT_2)).toHaveLength(1);
  });

  it('gives each aside line its code (AC-4)', async () => {
    const viewer: Viewer = {
      personId: OWNER_A,
      deviceId: 'device',
      memberships: [{ organizationId: ORG_A, role: 'OWNER', status: 'ACTIVE' }],
      scopeVersion: 0,
      isOnline: false,
    };

    const outcomes = await prisma.$transaction((tx) =>
      customerPricesAdapter.push(
        { viewer, tx },
        {
          table: 'customer_prices',
          created: [
            priceRow(PRICE_1, VARIANT_1, 0),
            priceRow(PRICE_2, VARIANT_1, 6000, REL_DELETED),
            priceRow(PRICE_3, VARIANT_B, 6000),
          ],
          updated: [],
          deleted: ['0199e034-0000-7000-8000-000000000099'],
        }
      )
    );

    expect(outcomes.map((o) => [o.id, o.kind, o.code])).toEqual([
      [PRICE_1, 'aside', 'INVALID'],
      [PRICE_2, 'aside', 'NO_RELATIONSHIP'],
      [PRICE_3, 'aside', 'NO_VARIANT'],
      ['0199e034-0000-7000-8000-000000000099', 'aside', 'NOT_FOUND'],
    ]);
  });

  it('sets aside a change to a price deleted since, as GONE (AC-4)', async () => {
    await seedPrice(PRICE_1, REL, VARIANT_1, 5000n);
    await prisma.customerPrice.update({ where: { id: PRICE_1 }, data: { deletedAt: LONG_AGO } });
    const viewer: Viewer = {
      personId: OWNER_A,
      deviceId: 'device',
      memberships: [{ organizationId: ORG_A, role: 'OWNER', status: 'ACTIVE' }],
      scopeVersion: 0,
      isOnline: false,
    };

    const outcomes = await prisma.$transaction((tx) =>
      customerPricesAdapter.push(
        { viewer, tx },
        {
          table: 'customer_prices',
          created: [],
          updated: [priceRow(PRICE_1, VARIANT_1, 9000)],
          deleted: [],
        }
      )
    );

    expect(outcomes).toEqual([
      expect.objectContaining({ id: PRICE_1, kind: 'aside', code: 'GONE' }),
    ]);
    expect((await priceRowOf(PRICE_1)).price).toBe(5000n);
  });

  it("forbids a price on another supplier's customer and its deletion, B unchanged (AB-1)", async () => {
    await seedPrice(PRICE_B, REL_B, VARIANT_B, 5000n);

    const response = await push(OWNER_A, {
      customer_prices: table({
        created: [priceRow(PRICE_1, VARIANT_1, 6000, REL_B)],
        updated: [priceRow(PRICE_B, VARIANT_B, 1, REL_B)],
      }),
    });
    const deletion = await push(OWNER_A, { customer_prices: table({ deleted: [PRICE_B] }) });

    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(0);
    expect(body.rejected.map((r) => [r.id, r.code])).toEqual(
      expect.arrayContaining([
        [PRICE_1, 'OUT_OF_SCOPE'],
        [PRICE_B, 'OUT_OF_SCOPE'],
      ])
    );
    expect(bodyOf<PushBody>(deletion).rejected.map((r) => r.code)).toEqual(['OUT_OF_SCOPE']);
    expect(await priceRowOf(PRICE_B)).toMatchObject({ price: 5000n, deletedAt: null });
    expect(await prisma.customerPrice.findUnique({ where: { id: PRICE_1 } })).toBeNull();
  });

  it('writes the session person as author whatever set_by_id the row carries (v5.0.0-15.3.3)', async () => {
    await push(OWNER_A, {
      customer_prices: table({
        created: [{ ...priceRow(PRICE_1, VARIANT_1, 6000), set_by_id: OWNER_B }],
      }),
    });

    expect((await priceRowOf(PRICE_1)).setById).toBe(OWNER_A);
  });
});
