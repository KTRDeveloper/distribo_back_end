import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import {
  productsAdapter,
  variantsAdapter,
} from '../../../src/modules/sync/adapters/catalog.adapter.js';
import { ordersAdapter } from '../../../src/modules/sync/adapters/order.adapter.js';
import { customerPricesAdapter } from '../../../src/modules/sync/adapters/relationship.adapter.js';
import type { SyncAdapter, TableChange } from '../../../src/modules/sync/sync.types.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const OWNER_A = '0199e030-0000-7000-8000-000000000001';
const MANAGER = '0199e030-0000-7000-8000-000000000002';
const SELLER = '0199e030-0000-7000-8000-000000000003';
const DRIVER = '0199e030-0000-7000-8000-000000000004';
const OWNER_B = '0199e030-0000-7000-8000-000000000005';
const CUSTOMER = '0199e030-0000-7000-8000-000000000006';
const ORG_A = '0199e030-0000-7000-8000-0000000000a1';
const ORG_B = '0199e030-0000-7000-8000-0000000000b1';
const REL_A = '0199e030-0000-7000-8000-0000000000c1';
const REL_B = '0199e030-0000-7000-8000-0000000000c2';
const PRODUCT_A = '0199e030-0000-7000-8000-0000000000d1';
const PRODUCT_A2 = '0199e030-0000-7000-8000-0000000000d3';
const PRODUCT_B = '0199e030-0000-7000-8000-0000000000d2';
const VARIANT_A = '0199e030-0000-7000-8000-0000000000e1';
const VARIANT_B = '0199e030-0000-7000-8000-0000000000e2';
const PRICE_A = '0199e030-0000-7000-8000-0000000000f1';
const PRICE_B = '0199e030-0000-7000-8000-0000000000f2';
const NEW_PRODUCT = '0199e030-0000-7000-8000-000000000401';
const NEW_VARIANT = '0199e030-0000-7000-8000-000000000402';
const NEW_PRICE = '0199e030-0000-7000-8000-000000000403';
const NEW_ORDER = '0199e030-0000-7000-8000-000000000404';
const UNKNOWN_ID = '0199e030-0000-7000-8000-000000000999';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
  resync_required: boolean;
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

/** Replaces an adapter's push with one that accepts every line it receives and records the call. */
function acceptAll(adapter: SyncAdapter, calls: TableChange[] = []) {
  return vi.spyOn(adapter, 'push').mockImplementation((_ctx, change) => {
    calls.push(change);
    const ids = [...change.created, ...change.updated]
      .map((row) => String(row['id']))
      .concat(change.deleted);
    return Promise.resolve(
      ids.map((id) => ({ table: change.table, id, kind: 'accepted' as const }))
    );
  });
}

/** Spies the three catalog adapters and the orders adapter; the calls land in one shared list. */
function spyAll() {
  const calls: TableChange[] = [];
  for (const adapter of [productsAdapter, variantsAdapter, customerPricesAdapter, ordersAdapter]) {
    acceptAll(adapter, calls);
  }
  return calls;
}

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Catalog Person',
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${phone.slice(1)}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
  devices[id] = `0199e030-0000-7000-8000-0000000007${phone.slice(-2)}`;
  await prisma.device.create({
    data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
  });
}

async function seedMember(suffix: string, personId: string, org: string, role: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e030-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: role as 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

describe('the judge knows products, variants and negotiated prices (SYNC-030)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER_A, '+237600003001');
    await seedPerson(MANAGER, '+237600003002');
    await seedPerson(SELLER, '+237600003003');
    await seedPerson(DRIVER, '+237600003004');
    await seedPerson(OWNER_B, '+237600003005');
    await seedPerson(CUSTOMER, '+237600003006');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('01', OWNER_A, ORG_A, 'OWNER');
    await seedMember('02', MANAGER, ORG_A, 'MANAGER');
    await seedMember('03', SELLER, ORG_A, 'SELLER');
    await seedMember('04', DRIVER, ORG_A, 'DRIVER');
    await seedMember('05', OWNER_B, ORG_B, 'OWNER');
    for (const [id, org, person, label] of [
      [REL_A, ORG_A, CUSTOMER, 'Chez Mama'],
      [REL_B, ORG_B, null, 'Client B'],
    ] as const) {
      await prisma.customerRelationship.create({
        data: {
          id,
          createdById: org === ORG_A ? OWNER_A : OWNER_B,
          createdAt: LONG_AGO,
          supplierOrganizationId: org,
          customerPersonId: person,
          customerLabel: label,
          creditLimit: person === null ? 0n : 50000n,
          balance: 0n,
        },
      });
    }
    for (const [id, org] of [
      [PRODUCT_A, ORG_A],
      [PRODUCT_A2, ORG_A],
      [PRODUCT_B, ORG_B],
    ]) {
      await prisma.product.create({
        data: { id, organizationId: org, name: 'Eau' },
      });
    }
    for (const [id, product, org] of [
      [VARIANT_A, PRODUCT_A, ORG_A],
      [VARIANT_B, PRODUCT_B, ORG_B],
    ]) {
      await prisma.productVariant.create({
        data: { id, productId: product, organizationId: org, unit: 'carton', price: 5000n },
      });
    }
    for (const [id, rel, product, variant, author] of [
      [PRICE_A, REL_A, PRODUCT_A, VARIANT_A, OWNER_A],
      [PRICE_B, REL_B, PRODUCT_B, VARIANT_B, OWNER_B],
    ]) {
      await prisma.customerPrice.create({
        data: {
          id,
          customerRelationshipId: rel,
          productId: product,
          productVariantId: variant,
          price: 4000n,
          setById: author,
        },
      });
    }
    await sleep(5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets the OWNER push a product, a variant and a price in table order (AC-1)', async () => {
    const order: string[] = [];
    // The products adapter stores its row, as the real one will: the variant's parent is read from the database.
    vi.spyOn(productsAdapter, 'push').mockImplementation(async (ctx, change) => {
      order.push(change.table);
      for (const row of change.created) {
        await ctx.tx.product.create({
          data: {
            id: String(row['id']),
            organizationId: String(row['organization_id']),
            name: 'Jus',
          },
        });
      }
      return change.created.map((row) => ({
        table: change.table,
        id: String(row['id']),
        kind: 'accepted' as const,
      }));
    });
    for (const adapter of [variantsAdapter, customerPricesAdapter, ordersAdapter]) {
      vi.spyOn(adapter, 'push').mockImplementation((_ctx, change) => {
        order.push(change.table);
        return Promise.resolve(
          change.created.map((row) => ({
            table: change.table,
            id: String(row['id']),
            kind: 'accepted' as const,
          }))
        );
      });
    }

    const response = await push(OWNER_A, {
      orders: table({ created: [{ id: NEW_ORDER, customer_relationship_id: REL_A }] }),
      customer_prices: table({
        created: [
          {
            id: NEW_PRICE,
            customer_relationship_id: REL_A,
            product_variant_id: NEW_VARIANT,
            price: 900,
          },
        ],
      }),
      product_variants: table({
        created: [{ id: NEW_VARIANT, product_id: NEW_PRODUCT, unit: 'carton', price: 1000 }],
      }),
      products: table({
        created: [{ id: NEW_PRODUCT, organization_id: ORG_A, name: 'Jus', price: 1000 }],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toBe(4);
    expect(order).toEqual(['products', 'product_variants', 'customer_prices', 'orders']);
  });

  it.each([
    ['MANAGER', MANAGER],
    ['SELLER', SELLER],
    ['DRIVER', DRIVER],
  ])(
    'forbids a %s a product creation, a variant update and a price deletion (AC-2)',
    async (_, person) => {
      const calls = spyAll();

      const response = await push(person, {
        products: table({ created: [{ id: NEW_PRODUCT, organization_id: ORG_A, name: 'Jus' }] }),
        product_variants: table({ updated: [{ id: VARIANT_A, price: 7000 }] }),
        customer_prices: table({ deleted: [PRICE_A] }),
      });

      const body = bodyOf<PushBody>(response);
      expect(body.accepted).toBe(0);
      expect(body.rejected).toEqual([
        expect.objectContaining({ table: 'products', id: NEW_PRODUCT, code: 'FIELD_NOT_ALLOWED' }),
        expect.objectContaining({
          table: 'product_variants',
          id: VARIANT_A,
          code: 'FIELD_NOT_ALLOWED',
        }),
        expect.objectContaining({
          table: 'customer_prices',
          id: PRICE_A,
          code: 'FIELD_NOT_ALLOWED',
        }),
      ]);
      expect(calls).toEqual([]);
    }
  );

  it('removes the computed fields and stamps the author and the organization (AC-3, CM-27)', async () => {
    const calls = spyAll();

    const response = await push(OWNER_A, {
      products: table({
        created: [
          {
            id: NEW_PRODUCT,
            organization_id: ORG_A,
            name: 'Jus',
            paused_at: 5,
            image_keys: ['k1'],
            image_urls: ['http://localhost:3000/k1'],
            price_updated_at: 7,
            server_updated_at: 8,
          },
        ],
      }),
      product_variants: table({
        created: [
          {
            id: NEW_VARIANT,
            product_id: PRODUCT_A,
            organization_id: ORG_B,
            unit: 'bouteille',
            price: 300,
            merged_into_id: VARIANT_A,
            image_keys: ['k2'],
            image_urls: ['http://localhost:3000/k2'],
            price_updated_at: 9,
          },
        ],
      }),
      customer_prices: table({
        created: [
          {
            id: NEW_PRICE,
            customer_relationship_id: REL_A,
            product_variant_id: VARIANT_A,
            price: 800,
            set_at: 11,
            set_by_id: MANAGER,
          },
        ],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const created = (name: string) =>
      calls.filter((c) => c.table === name).flatMap((c) => c.created);
    expect(created('products')).toEqual([{ id: NEW_PRODUCT, organization_id: ORG_A, name: 'Jus' }]);
    expect(created('product_variants')).toEqual([
      {
        id: NEW_VARIANT,
        product_id: PRODUCT_A,
        organization_id: ORG_A,
        unit: 'bouteille',
        price: 300,
      },
    ]);
    expect(created('customer_prices')).toEqual([
      {
        id: NEW_PRICE,
        customer_relationship_id: REL_A,
        product_variant_id: VARIANT_A,
        price: 800,
        set_by_id: OWNER_A,
      },
    ]);
  });

  it('answers OUT_OF_SCOPE alike for a foreign and an unknown id (AC-4)', async () => {
    const calls = spyAll();
    const lines = (foreign: boolean) => ({
      products: table({
        created: [{ id: NEW_PRODUCT, organization_id: foreign ? ORG_B : UNKNOWN_ID, name: 'Jus' }],
        updated: [{ id: foreign ? PRODUCT_B : UNKNOWN_ID, name: 'Vol' }],
        deleted: [foreign ? PRODUCT_B : UNKNOWN_ID],
      }),
      product_variants: table({
        created: [
          { id: NEW_VARIANT, product_id: foreign ? PRODUCT_B : UNKNOWN_ID, unit: 'u', price: 1 },
        ],
        updated: [{ id: foreign ? VARIANT_B : UNKNOWN_ID, price: 9 }],
        deleted: [foreign ? VARIANT_B : UNKNOWN_ID],
      }),
      customer_prices: table({
        created: [
          {
            id: NEW_PRICE,
            customer_relationship_id: foreign ? REL_B : UNKNOWN_ID,
            product_variant_id: VARIANT_A,
            price: 1,
          },
        ],
        updated: [{ id: foreign ? PRICE_B : UNKNOWN_ID, price: 9 }],
        deleted: [foreign ? PRICE_B : UNKNOWN_ID],
      }),
    });

    const foreign = bodyOf<PushBody>(await push(OWNER_A, lines(true)));
    const unknown = bodyOf<PushBody>(await push(OWNER_A, lines(false)));

    expect(foreign.accepted).toBe(0);
    expect(foreign.rejected).toHaveLength(9);
    expect(foreign.rejected.every((r) => r.code === 'OUT_OF_SCOPE')).toBe(true);
    const shape = (b: PushBody) => b.rejected.map((r) => [r.table, r.code, r.message]);
    expect(shape(unknown)).toEqual(shape(foreign));
    expect(calls).toEqual([]);
  });

  it('keeps a price on a relationship the customer holds outside the supplier staff (AC-4, ASVS 8.2.2)', async () => {
    const calls = spyAll();

    const response = await push(CUSTOMER, {
      customer_prices: table({
        created: [
          {
            id: NEW_PRICE,
            customer_relationship_id: REL_A,
            product_variant_id: VARIANT_A,
            price: 1,
          },
        ],
        updated: [{ id: PRICE_A, price: 1 }],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected.map((r) => r.code)).toEqual([
      'OUT_OF_SCOPE',
      'OUT_OF_SCOPE',
    ]);
    expect(calls).toEqual([]);
  });

  it('refuses the fields the catalog list does not hold (AC-5)', async () => {
    const calls = spyAll();

    const response = await push(OWNER_A, {
      product_variants: table({ updated: [{ id: VARIANT_A, product_id: PRODUCT_A2 }] }),
      products: table({ updated: [{ id: PRODUCT_A, organization_id: ORG_B }] }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([
      expect.objectContaining({ table: 'products', id: PRODUCT_A, code: 'FIELD_NOT_ALLOWED' }),
      expect.objectContaining({
        table: 'product_variants',
        id: VARIANT_A,
        code: 'FIELD_NOT_ALLOWED',
      }),
    ]);
    expect(calls).toEqual([]);
  });

  it('lets the OWNER update a listed field of a variant (AC-5 control)', async () => {
    const calls = spyAll();

    const response = await push(OWNER_A, {
      product_variants: table({ updated: [{ id: VARIANT_A, price: 5500, unit: 'carton' }] }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect(calls.flatMap((c) => c.updated)).toEqual([
      { id: VARIANT_A, price: 5500, unit: 'carton', organization_id: ORG_A },
    ]);
  });

  it('stores nothing and tells the sender when a SELLER or a DRIVER edits the catalog (AB-1, CWE-269)', async () => {
    const calls = spyAll();

    const seller = bodyOf<PushBody>(
      await push(SELLER, {
        products: table({ created: [{ id: NEW_PRODUCT, organization_id: ORG_A, name: 'Jus' }] }),
      })
    );
    const driver = bodyOf<PushBody>(
      await push(DRIVER, {
        customer_prices: table({ updated: [{ id: PRICE_A, price: 1 }] }),
      })
    );

    expect(seller.rejected).toEqual([
      expect.objectContaining({ id: NEW_PRODUCT, code: 'FIELD_NOT_ALLOWED' }),
    ]);
    expect(driver.rejected).toEqual([
      expect.objectContaining({ id: PRICE_A, code: 'FIELD_NOT_ALLOWED' }),
    ]);
    expect(seller.resync_required).toBe(true);
    expect(driver.resync_required).toBe(true);
    expect(calls).toEqual([]);
    expect(await prisma.product.count({ where: { id: NEW_PRODUCT } })).toBe(0);
    expect((await prisma.customerPrice.findUniqueOrThrow({ where: { id: PRICE_A } })).price).toBe(
      4000n
    );
    for (const person of [SELLER, DRIVER]) {
      expect(
        await prisma.notification.count({
          where: { recipientId: person, sourceEvent: 'sync.refused' },
        })
      ).toBe(1);
    }
  });

  it('writes the OWNER as the author of a price whatever the phone sent (AB-2, CWE-290)', async () => {
    const calls = spyAll();

    await push(OWNER_A, {
      customer_prices: table({
        created: [
          {
            id: NEW_PRICE,
            customer_relationship_id: REL_A,
            product_variant_id: VARIANT_A,
            price: 700,
            set_by_id: OWNER_B,
          },
        ],
      }),
    });

    const received = calls.flatMap((c) => c.created);
    expect(received).toHaveLength(1);
    expect(received[0]?.['set_by_id']).toBe(OWNER_A);
  });
});
