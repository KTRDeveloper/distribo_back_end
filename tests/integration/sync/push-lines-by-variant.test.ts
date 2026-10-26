import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { seedProduct } from '../../helpers/catalog-fixtures';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const SELLER = '0199e029-0000-7000-8000-000000000001';
const OWNER_A = '0199e029-0000-7000-8000-000000000002';
const OWNER_B = '0199e029-0000-7000-8000-000000000003';
const CUSTOMER = '0199e029-0000-7000-8000-000000000004';
const DEVICE = '0199e029-0000-7000-8000-000000000005';
const ORG_A = '0199e029-0000-7000-8000-0000000000a1';
const ORG_B = '0199e029-0000-7000-8000-0000000000b1';
const REL = '0199e029-0000-7000-8000-0000000000c1';
const RICE = '0199e029-0000-7000-8000-0000000000d1';
const RICE_SURVIVOR = '0199e029-0000-7000-8000-0000000000d2';
const RICE_WITHDRAWN = '0199e029-0000-7000-8000-0000000000d3';
const RICE_DELETED = '0199e029-0000-7000-8000-0000000000d4';
const SUGAR_B = '0199e029-0000-7000-8000-0000000000d5';
const SUGAR_B_DELETED = '0199e029-0000-7000-8000-0000000000d6';
const PAUSED = '0199e029-0000-7000-8000-0000000000d7';
const ORDER = '0199e029-0000-7000-8000-000000000501';
const LINE = '0199e029-0000-7000-8000-000000000601';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const RETIRED_NOTE = 'Produit retiré de la vente depuis la saisie';

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
  issues?: Array<{ table: string; id: string; code: string; message: string }>;
};

const push = async (changes: unknown) =>
  createAuthenticatedRequest(app, SELLER, DEVICE)
    .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
    .send({ changes });

const table = (part: Partial<{ created: unknown[] }>) => ({
  created: [],
  updated: [],
  deleted: [],
  ...part,
});

const lineRow = (extra: Record<string, unknown> = {}) => ({
  id: LINE,
  order_id: ORDER,
  product_variant_id: RICE,
  quantity: '4',
  reference_price: 3000,
  unit_price_applied: 3000,
  ...extra,
});

/** One order of one line, in the shape a phone sends it. */
const batch = (line: Record<string, unknown>) => ({
  orders: table({
    created: [
      {
        id: ORDER,
        customer_relationship_id: REL,
        delivery_address_applied: 'Rue 1',
        delivery_cost: 0,
        created_at: Date.parse('2026-09-30T08:00:00.000Z'),
      },
    ],
  }),
  order_lines: table({ created: [line] }),
});

const storedLine = () => prisma.orderLine.findUnique({ where: { id: LINE } });
const variantOf = (id: string) => prisma.productVariant.findUniqueOrThrow({ where: { id } });

describe('push of order lines by variant (SYNC-029)', () => {
  beforeEach(async () => {
    for (const [id, phone, registered] of [
      [SELLER, '+237600002901', true],
      [OWNER_A, '+237600002902', true],
      [OWNER_B, '+237600002903', true],
      [CUSTOMER, '+237600002904', false],
    ] as const) {
      await prisma.person.create({
        data: {
          id,
          fullName: 'Fixture Person',
          phoneNumber: phone,
          phoneVerifiedAt: LONG_AGO,
          ...(registered
            ? {
                email: `${phone.slice(1)}@example.test`,
                passwordHash: 'test-password-hash',
                registeredAt: LONG_AGO,
              }
            : {}),
          preferredLanguage: 'FR',
          createdAt: LONG_AGO,
        },
      });
    }
    await prisma.device.create({
      data: { id: DEVICE, personId: SELLER, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    await prisma.organization.createMany({
      data: [
        { id: ORG_A, name: 'Org A', createdAt: LONG_AGO },
        { id: ORG_B, name: 'Org B', createdAt: LONG_AGO },
      ],
    });
    for (const [suffix, personId, org, role] of [
      ['02', OWNER_A, ORG_A, 'OWNER'],
      ['03', OWNER_B, ORG_B, 'OWNER'],
      ['01', SELLER, ORG_A, 'SELLER'],
    ] as const) {
      await prisma.collaboration.create({
        data: {
          id: `0199e029-0000-7000-8000-0000000001${suffix}`,
          personId,
          organizationId: org,
          role,
          status: 'ACTIVE',
          invitedAt: LONG_AGO,
          acceptedAt: LONG_AGO,
        },
      });
    }
    await prisma.customerRelationship.create({
      data: {
        id: REL,
        supplierOrganizationId: ORG_A,
        customerPersonId: CUSTOMER,
        createdById: OWNER_A,
        createdAt: LONG_AGO,
        deliveryAddress: 'Rue 1',
      },
    });
    // The variant "sac 10 kg" of "Riz parfumé" and a few states of its siblings.
    await seedProduct(prisma, {
      id: RICE,
      organizationId: ORG_A,
      name: 'Riz parfumé',
      unit: 'sac 10 kg',
      price: 3000n,
    });
    await prisma.productVariant.createMany({
      data: [
        { id: RICE_SURVIVOR, unit: 'sac 25 kg', price: 3000n },
        { id: RICE_WITHDRAWN, unit: 'sac 50 kg', price: 3000n, status: 'INACTIVE' },
        { id: RICE_DELETED, unit: 'sac 100 kg', price: 3000n, deletedAt: LONG_AGO },
      ].map((variant) => ({ ...variant, productId: RICE, organizationId: ORG_A })),
    });
    await seedProduct(prisma, {
      id: PAUSED,
      organizationId: ORG_A,
      name: 'Huile',
      unit: 'litre',
      price: 3000n,
      pausedAt: LONG_AGO,
    });
    await seedProduct(prisma, {
      id: SUGAR_B,
      organizationId: ORG_B,
      name: 'Sucre',
      unit: 'kg',
      price: 700n,
    });
    await prisma.productVariant.create({
      data: {
        id: SUGAR_B_DELETED,
        productId: SUGAR_B,
        organizationId: ORG_B,
        unit: 'sac',
        price: 700n,
        deletedAt: LONG_AGO,
      },
    });
  });

  it('stores a line by variant, with its product, its label and the computed amount (AC-1, CM-27)', async () => {
    const response = await push(batch(lineRow({ amount: 1, label_applied: 'Forged' })));

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
    expect(await storedLine()).toMatchObject({
      productVariantId: RICE,
      productId: RICE,
      labelApplied: 'Riz parfumé — sac 10 kg',
      amount: 12000n,
    });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: ORDER } })).syncIssue).toBeNull();
  });

  it('puts the line of a merged variant on the surviving one (AC-2)', async () => {
    await prisma.productVariant.update({
      where: { id: RICE_DELETED },
      data: { mergedIntoId: RICE_SURVIVOR },
    });

    const response = await push(batch(lineRow({ product_variant_id: RICE_DELETED })));

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
    expect(await storedLine()).toMatchObject({
      productVariantId: RICE_SURVIVOR,
      labelApplied: 'Riz parfumé — sac 25 kg',
    });
    expect((await variantOf(RICE_DELETED)).deletedAt).not.toBeNull();
  });

  it('stores the line of a withdrawn variant and flags the order (AC-3)', async () => {
    const response = await push(batch(lineRow({ product_variant_id: RICE_WITHDRAWN })));

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([]);
    expect(await storedLine()).toMatchObject({ productVariantId: RICE_WITHDRAWN });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: ORDER } });
    expect(order.syncIssue).toBe(RETIRED_NOTE);
    expect(order.totalAmount).toBe(12000n);
  });

  it('flags the order of a line whose product is paused (AC-3)', async () => {
    const response = await push(batch(lineRow({ product_variant_id: PAUSED })));

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect(await storedLine()).toMatchObject({ productVariantId: PAUSED });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: ORDER } })).syncIssue).toBe(
      RETIRED_NOTE
    );
  });

  it('brings a deleted variant back off sale and stores the line (AC-4, C-48)', async () => {
    const response = await push(batch(lineRow({ product_variant_id: RICE_DELETED })));

    expect(bodyOf<PushBody>(response).rejected).toEqual([]);
    expect(await storedLine()).toMatchObject({ productVariantId: RICE_DELETED });
    expect(await variantOf(RICE_DELETED)).toMatchObject({ status: 'INACTIVE', deletedAt: null });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: ORDER } })).syncIssue).toBe(
      RETIRED_NOTE
    );
  });

  it('sets aside a line that sends the old key and stores nothing (AC-5)', async () => {
    const response = await push(
      batch({
        id: LINE,
        order_id: ORDER,
        product_id: RICE,
        quantity: '4',
        reference_price: 3000,
        unit_price_applied: 3000,
      })
    );

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, aside: 1 });
    expect(await storedLine()).toBeNull();
    expect(await prisma.orderLine.count()).toBe(0);
  });

  it('sets aside a line whose variant key is not a UUID (v5.0.0-2.2.1)', async () => {
    const response = await push(batch(lineRow({ product_variant_id: 'not-a-uuid' })));

    expect(bodyOf<PushBody>(response)).toMatchObject({ aside: 1 });
    expect(await storedLine()).toBeNull();
  });

  it.each([
    ['a live variant', 'SUGAR_B'],
    ['a deleted variant', 'SUGAR_B_DELETED'],
  ])('refuses a line naming %s of another business and writes nothing (AB-1)', async (_n, key) => {
    const variantId = key === 'SUGAR_B' ? SUGAR_B : SUGAR_B_DELETED;

    const response = await push(batch(lineRow({ product_variant_id: variantId })));

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([
      expect.objectContaining({ table: 'order_lines', id: LINE, code: 'OUT_OF_SCOPE' }),
    ]);
    expect(await storedLine()).toBeNull();
    expect(await variantOf(SUGAR_B_DELETED)).toMatchObject({ deletedAt: LONG_AGO });
    expect(await prisma.orderLine.count()).toBe(0);
  });
});
