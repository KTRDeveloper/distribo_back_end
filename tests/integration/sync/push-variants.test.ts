import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { variantsAdapter } from '../../../src/modules/sync/adapters/catalog.adapter.js';
import type { TableChange, Viewer } from '../../../src/modules/sync/sync.types.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const OWNER_A = '0199e032-0000-7000-8000-000000000001';
const OWNER_B = '0199e032-0000-7000-8000-000000000002';
const ORG_A = '0199e032-0000-7000-8000-0000000000a1';
const ORG_B = '0199e032-0000-7000-8000-0000000000b1';
const PRODUCT_A = '0199e032-0000-7000-8000-0000000000d1';
const PRODUCT_B = '0199e032-0000-7000-8000-0000000000d2';
const PRODUCT_GONE = '0199e032-0000-7000-8000-0000000000d3';
const VARIANT_A = '0199e032-0000-7000-8000-0000000000e1';
const VARIANT_A2 = '0199e032-0000-7000-8000-0000000000e2';
const VARIANT_B = '0199e032-0000-7000-8000-0000000000e3';
const NEW_1 = '0199e032-0000-7000-8000-000000000401';
const NEW_2 = '0199e032-0000-7000-8000-000000000402';
const NEW_3 = '0199e032-0000-7000-8000-000000000403';
const NEW_4 = '0199e032-0000-7000-8000-000000000404';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const OLD_PRICE_DATE = new Date('2026-03-01T00:00:00.000Z');

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
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

const ownerViewer: Viewer = {
  personId: OWNER_A,
  deviceId: 'device',
  memberships: [{ organizationId: ORG_A, role: 'OWNER', status: 'ACTIVE' }],
  scopeVersion: 0,
  isOnline: false,
};

/** Runs the variants adapter alone on already judged lines and returns its outcomes. */
function pushToAdapter(change: Partial<TableChange>) {
  return prisma.$transaction((tx) =>
    variantsAdapter.push(
      { viewer: ownerViewer, tx },
      { table: 'product_variants', created: [], updated: [], deleted: [], ...change }
    )
  );
}

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Variant Person',
      phoneNumber: phone,
      phoneVerifiedAt: LONG_AGO,
      email: `${phone.slice(1)}@example.test`,
      passwordHash: 'test-password-hash',
      registeredAt: LONG_AGO,
      preferredLanguage: 'FR',
      createdAt: LONG_AGO,
    },
  });
  devices[id] = `0199e032-0000-7000-8000-0000000007${phone.slice(-2)}`;
  await prisma.device.create({
    data: { id: devices[id], personId: id, platform: 'ANDROID', appVersion: '1.0.0' },
  });
}

async function seedMember(suffix: string, personId: string, org: string) {
  await prisma.collaboration.create({
    data: {
      id: `0199e032-0000-7000-8000-0000000001${suffix}`,
      personId,
      organizationId: org,
      role: 'OWNER',
      status: 'ACTIVE',
      invitedAt: LONG_AGO,
      acceptedAt: LONG_AGO,
    },
  });
}

describe('the owner pushes variants (SYNC-032)', () => {
  beforeEach(async () => {
    await seedPerson(OWNER_A, '+237600003201');
    await seedPerson(OWNER_B, '+237600003202');
    for (const [id, name] of [
      [ORG_A, 'Org A'],
      [ORG_B, 'Org B'],
    ]) {
      await prisma.organization.create({ data: { id, name, createdAt: LONG_AGO } });
    }
    await seedMember('01', OWNER_A, ORG_A);
    await seedMember('02', OWNER_B, ORG_B);
    await prisma.product.create({
      data: { id: PRODUCT_A, organizationId: ORG_A, name: 'Riz' },
    });
    await prisma.product.create({
      data: { id: PRODUCT_GONE, organizationId: ORG_A, name: 'Huile', deletedAt: LONG_AGO },
    });
    await prisma.product.create({
      data: { id: PRODUCT_B, organizationId: ORG_B, name: 'Jus' },
    });
    await prisma.productVariant.create({
      data: {
        id: VARIANT_A,
        productId: PRODUCT_A,
        organizationId: ORG_A,
        name: 'sac 5 kg',
        unit: 'sac',
        price: 8000n,
        priceUpdatedAt: OLD_PRICE_DATE,
      },
    });
    await prisma.productVariant.create({
      data: {
        id: VARIANT_A2,
        productId: PRODUCT_A,
        organizationId: ORG_A,
        name: 'sac 25 kg',
        unit: 'sac',
        price: 30000n,
        priceUpdatedAt: OLD_PRICE_DATE,
      },
    });
    await prisma.productVariant.create({
      data: {
        id: VARIANT_B,
        productId: PRODUCT_B,
        organizationId: ORG_B,
        name: 'carton',
        unit: 'carton',
        price: 5000n,
        priceUpdatedAt: OLD_PRICE_DATE,
      },
    });
    await sleep(5);
  });

  it('stores a new variant with its price and a price date set by the server (AC-1)', async () => {
    const before = new Date();
    const response = await push(OWNER_A, {
      product_variants: table({
        created: [
          {
            id: NEW_1,
            product_id: PRODUCT_A,
            name: 'sac 10 kg',
            unit: 'sac',
            price: 15000,
            min_order_quantity: '2.5',
            status: 'ACTIVE',
          },
        ],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toBe(1);
    const stored = await prisma.productVariant.findUniqueOrThrow({ where: { id: NEW_1 } });
    expect(stored).toMatchObject({
      organizationId: ORG_A,
      productId: PRODUCT_A,
      name: 'sac 10 kg',
      unit: 'sac',
      price: 15000n,
      status: 'ACTIVE',
      deletedAt: null,
      mergedIntoId: null,
    });
    expect(stored.minOrderQuantity?.toString()).toBe('2.5');
    expect(stored.priceUpdatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('changes the price and its date on an edit, and keeps the product on a rename (AC-2)', async () => {
    const response = await push(OWNER_A, {
      product_variants: table({
        updated: [{ id: VARIANT_A, name: 'sac 5 kg', unit: 'sac', price: 8500, status: 'ACTIVE' }],
      }),
    });
    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, rejected: [] });
    const priced = await prisma.productVariant.findUniqueOrThrow({ where: { id: VARIANT_A } });
    expect(priced.price).toBe(8500n);
    expect(priced.priceUpdatedAt.getTime()).toBeGreaterThan(OLD_PRICE_DATE.getTime());

    const renamed = await push(OWNER_A, {
      product_variants: table({
        updated: [
          { id: VARIANT_A, name: 'sac 5 kilos', unit: 'sachet', price: 8500, status: 'ACTIVE' },
        ],
      }),
    });
    expect(bodyOf<PushBody>(renamed)).toMatchObject({ accepted: 1, rejected: [] });
    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: VARIANT_A } });
    expect(after).toMatchObject({ name: 'sac 5 kilos', unit: 'sachet', productId: PRODUCT_A });
  });

  it('leaves a repeated edit unchanged (C-36)', async () => {
    const edit = { id: VARIANT_A, name: 'sac 5 kg', unit: 'sac', price: 8000, status: 'ACTIVE' };
    const before = await prisma.productVariant.findUniqueOrThrow({ where: { id: VARIANT_A } });

    const outcomes = await pushToAdapter({ updated: [{ ...edit, organization_id: ORG_A }] });

    expect(outcomes).toEqual([{ table: 'product_variants', id: VARIANT_A, kind: 'accepted' }]);
    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: VARIANT_A } });
    expect(after.serverUpdatedAt).toEqual(before.serverUpdatedAt);
    expect(after.priceUpdatedAt).toEqual(before.priceUpdatedAt);
  });

  it('merges a variant created twice into the first one, which keeps its price (AC-3, C-47)', async () => {
    await prisma.productVariant.create({
      data: {
        id: NEW_2,
        productId: PRODUCT_A,
        organizationId: ORG_A,
        name: 'sac 10 kg',
        unit: 'sac',
        price: 14000n,
      },
    });

    const outcomes = await pushToAdapter({
      created: [
        {
          id: NEW_3,
          organization_id: ORG_A,
          product_id: PRODUCT_A,
          name: ' Sac 10  KG ',
          unit: 'SAC',
          price: 16000,
          status: 'ACTIVE',
        },
      ],
    });
    expect(outcomes).toEqual([
      {
        table: 'product_variants',
        id: NEW_3,
        kind: 'issue',
        code: 'MERGED',
        message: 'Riz — sac 10 kg (sac) ajouté deux fois : variantes réunies',
        mergedInto: NEW_2,
      },
    ]);
    const first = await prisma.productVariant.findUniqueOrThrow({ where: { id: NEW_2 } });
    expect(first).toMatchObject({ price: 14000n, deletedAt: null, mergedIntoId: null });
    const folded = await prisma.productVariant.findUniqueOrThrow({ where: { id: NEW_3 } });
    expect(folded.mergedIntoId).toBe(NEW_2);
    expect(folded.deletedAt).not.toBeNull();
  });

  it('sets aside a price of 0, an edit that makes a twin and a deleted product, and lets the rest pass (AC-4)', async () => {
    const response = await push(OWNER_A, {
      product_variants: table({
        created: [
          {
            id: NEW_1,
            product_id: PRODUCT_A,
            name: 'zéro',
            unit: 'sac',
            price: 0,
            status: 'ACTIVE',
          },
          {
            id: NEW_2,
            product_id: PRODUCT_GONE,
            name: 'bidon',
            unit: 'bidon',
            price: 1000,
            status: 'ACTIVE',
          },
          {
            id: NEW_3,
            product_id: PRODUCT_A,
            name: 'sac 1 kg',
            unit: 'sac',
            price: 1500,
            status: 'ACTIVE',
          },
        ],
        updated: [
          // Renames the 25 kg variant to the 5 kg one: a twin (C-47).
          { id: VARIANT_A2, name: 'SAC 5 KG', unit: 'sac', price: 30000, status: 'ACTIVE' },
        ],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body).toMatchObject({ accepted: 1, aside: 3, rejected: [] });
    expect(await prisma.productVariant.findUnique({ where: { id: NEW_1 } })).toBeNull();
    expect(await prisma.productVariant.findUnique({ where: { id: NEW_2 } })).toBeNull();
    expect(await prisma.productVariant.findUnique({ where: { id: NEW_3 } })).not.toBeNull();
    const untouched = await prisma.productVariant.findUniqueOrThrow({ where: { id: VARIANT_A2 } });
    expect(untouched.name).toBe('sac 25 kg');
  });

  it('answers each refusal with its own code, field names only (AC-4, v5.0.0-2.2.1)', async () => {
    const outcomes = await pushToAdapter({
      created: [
        {
          id: NEW_1,
          organization_id: ORG_A,
          product_id: PRODUCT_A,
          name: 'zéro',
          unit: 'sac',
          price: 0,
          status: 'ACTIVE',
        },
        {
          id: NEW_2,
          organization_id: ORG_A,
          product_id: PRODUCT_GONE,
          name: 'bidon',
          unit: 'bidon',
          price: 1000,
          status: 'ACTIVE',
        },
        {
          id: NEW_3,
          organization_id: ORG_A,
          product_id: PRODUCT_A,
          name: 'x',
          unit: 12,
          price: '1000',
          min_order_quantity: 3,
          status: 'ACTIVE',
        },
        {
          id: NEW_4,
          organization_id: ORG_A,
          product_id: 'not-a-uuid',
          name: 'x',
          unit: 'sac',
          price: 1000,
          status: 'ACTIVE',
        },
      ],
      updated: [
        {
          id: VARIANT_A2,
          organization_id: ORG_A,
          name: 'sac 5 kg',
          unit: 'sac',
          price: 30000,
          status: 'ACTIVE',
        },
      ],
    });

    expect(outcomes.map((o) => [o.id, o.kind, o.code])).toEqual([
      [NEW_1, 'aside', 'INVALID'],
      [NEW_2, 'aside', 'NO_PRODUCT'],
      [NEW_3, 'aside', 'INVALID'],
      [NEW_4, 'aside', 'NO_PRODUCT'],
      [VARIANT_A2, 'aside', 'VARIANT_EXISTS'],
    ]);
    expect(outcomes[0]?.message).toContain('price');
    expect(outcomes[2]?.message).toContain('unit');
    expect(outcomes[2]?.message).toContain('price');
    expect(outcomes[2]?.message).toContain('minOrderQuantity');
  });

  it('sets aside an edit of a deleted variant as GONE', async () => {
    await prisma.productVariant.update({ where: { id: VARIANT_A }, data: { deletedAt: LONG_AGO } });

    const outcomes = await pushToAdapter({
      updated: [
        {
          id: VARIANT_A,
          organization_id: ORG_A,
          name: 'sac 5 kg',
          unit: 'sac',
          price: 9000,
          status: 'ACTIVE',
        },
      ],
    });

    expect(outcomes).toEqual([
      expect.objectContaining({ id: VARIANT_A, kind: 'aside', code: 'GONE' }),
    ]);
  });

  it('forbids a variant slipped into a product of another business (AB-1)', async () => {
    const response = await push(OWNER_A, {
      product_variants: table({
        created: [
          {
            id: NEW_1,
            product_id: PRODUCT_B,
            name: 'Volé',
            unit: 'carton',
            price: 1,
            status: 'ACTIVE',
          },
        ],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.accepted).toBe(0);
    expect(body.rejected).toEqual([
      expect.objectContaining({ table: 'product_variants', id: NEW_1, code: 'OUT_OF_SCOPE' }),
    ]);
    expect(await prisma.productVariant.findUnique({ where: { id: NEW_1 } })).toBeNull();
    expect(await prisma.productVariant.count({ where: { productId: PRODUCT_B } })).toBe(1);
  });

  it('answers FOREIGN as forbidden OUT_OF_SCOPE when a row names a variant of B (AB-1)', async () => {
    const outcomes = await pushToAdapter({
      updated: [
        {
          id: VARIANT_B,
          organization_id: ORG_A,
          name: 'Volé',
          unit: 'carton',
          price: 1,
          status: 'ACTIVE',
        },
      ],
    });

    expect(outcomes).toEqual([
      expect.objectContaining({ id: VARIANT_B, kind: 'forbidden', code: 'OUT_OF_SCOPE' }),
    ]);
    const other = await prisma.productVariant.findUniqueOrThrow({ where: { id: VARIANT_B } });
    expect(other).toMatchObject({ name: 'carton', price: 5000n, organizationId: ORG_B });
  });

  it('never reads the merge link, the price date or the photos (v5.0.0-15.3.3)', async () => {
    const response = await push(OWNER_A, {
      product_variants: table({
        created: [
          {
            id: NEW_1,
            product_id: PRODUCT_A,
            name: 'sac 10 kg',
            unit: 'sac',
            price: 15000,
            status: 'ACTIVE',
            merged_into_id: VARIANT_A,
            price_updated_at: 5,
            image_keys: ['k1'],
          },
        ],
      }),
    });

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    const stored = await prisma.productVariant.findUniqueOrThrow({ where: { id: NEW_1 } });
    expect(stored).toMatchObject({ mergedIntoId: null, deletedAt: null, imageKeys: [] });
    expect(stored.priceUpdatedAt.getFullYear()).toBeGreaterThan(2000);
  });
});
