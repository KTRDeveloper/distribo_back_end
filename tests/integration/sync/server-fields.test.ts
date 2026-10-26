import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../src/app.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

const OWNER = '0199e041-0000-7000-8000-000000000001';
const DEVICE = '0199e041-0000-7000-8000-000000000701';
const ORG = '0199e041-0000-7000-8000-0000000000a1';
const PRODUCT = '0199e041-0000-7000-8000-0000000000d1';
const VARIANT = '0199e041-0000-7000-8000-0000000000e1';
const OTHER_VARIANT = '0199e041-0000-7000-8000-0000000000e2';
const CONTACT = '0199e041-0000-7000-8000-0000000000f1';
const NEW_PRODUCT = '0199e041-0000-7000-8000-000000000401';
const NEW_VARIANT = '0199e041-0000-7000-8000-000000000402';
const SEAT = '0199e041-0000-7000-8000-000000000101';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const PAUSED_AT = new Date('2026-02-01T00:00:00.000Z');
const CONTACT_VERIFIED_AT = new Date('2026-04-01T00:00:00.000Z');

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
};

const table = (part: Partial<{ created: unknown[]; updated: unknown[]; deleted: string[] }>) => ({
  created: [],
  updated: [],
  deleted: [],
  ...part,
});

const push = async (changes: unknown) =>
  createAuthenticatedRequest(app, OWNER, DEVICE)
    .post(`/api/v1/sync/push?last_pulled_at=${await pulledAtAfterSeeding()}`)
    .send({ changes });

const organization = () => prisma.organization.findUniqueOrThrow({ where: { id: ORG } });
const person = () => prisma.person.findUniqueOrThrow({ where: { id: OWNER } });
const contact = () => prisma.organizationContact.findUniqueOrThrow({ where: { id: CONTACT } });
const product = (id = PRODUCT) => prisma.product.findUniqueOrThrow({ where: { id } });
const variant = (id = VARIANT) => prisma.productVariant.findUniqueOrThrow({ where: { id } });

describe('a phone cannot write the fields only the server writes (SYNC-041)', () => {
  beforeEach(async () => {
    await prisma.person.create({
      data: {
        id: OWNER,
        fullName: 'Server Owner',
        phoneNumber: '+237600004101',
        phoneVerifiedAt: LONG_AGO,
        email: 'server.owner@example.test',
        passwordHash: 'test-password-hash',
        registeredAt: LONG_AGO,
        preferredLanguage: 'FR',
        createdAt: LONG_AGO,
      },
    });
    await prisma.device.create({
      data: { id: DEVICE, personId: OWNER, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    await prisma.organization.create({
      data: { id: ORG, name: 'Org Server', createdAt: LONG_AGO },
    });
    await prisma.collaboration.create({
      data: {
        id: SEAT,
        personId: OWNER,
        organizationId: ORG,
        role: 'OWNER',
        status: 'ACTIVE',
        invitedAt: LONG_AGO,
        acceptedAt: LONG_AGO,
      },
    });
  });

  /** A product with a pause date and a photo, and a variant with its price date and a photo. */
  async function seedServerValues() {
    await prisma.product.create({
      data: {
        id: PRODUCT,
        organizationId: ORG,
        name: 'Riz',
        createdAt: LONG_AGO,
        pausedAt: PAUSED_AT,
        imageKeys: ['server-product-photo'],
      },
    });
    await prisma.productVariant.create({
      data: {
        id: VARIANT,
        productId: PRODUCT,
        organizationId: ORG,
        name: 'sac 5 kg',
        unit: 'sac',
        price: 8000n,
        imageKeys: ['server-variant-photo'],
      },
    });
  }

  /**
   * 30 newer products on sale fill the FREE plan, so the server ranking has no room to put the
   * older paused product back on sale.
   */
  async function seedFullPlan() {
    const ids = Array.from({ length: 30 }, (_, i) => ({
      product: `0199e041-0000-7000-8010-${String(i).padStart(12, '0')}`,
      variant: `0199e041-0000-7000-8020-${String(i).padStart(12, '0')}`,
    }));
    await prisma.product.createMany({
      data: ids.map(({ product: id }, i) => ({
        id,
        organizationId: ORG,
        name: `Produit ${i}`,
        createdAt: new Date(LONG_AGO.getTime() + (i + 1) * 1000),
      })),
    });
    await prisma.productVariant.createMany({
      data: ids.map(({ product, variant: id }) => ({
        id,
        productId: product,
        organizationId: ORG,
        name: 'unité',
        unit: 'pièce',
        price: 500n,
      })),
    });
  }

  it('drops the server fields of a created product and variant (AC-1, C-46, C-49)', async () => {
    const before = new Date();

    const response = await push({
      products: table({
        created: [
          {
            id: NEW_PRODUCT,
            organization_id: ORG,
            name: 'Huile',
            paused_at: Date.now(),
            image_keys: ['phone-product-photo'],
          },
        ],
      }),
      product_variants: table({
        created: [
          {
            id: NEW_VARIANT,
            product_id: NEW_PRODUCT,
            name: 'bidon 5 l',
            unit: 'bidon',
            price: 6000,
            status: 'ACTIVE',
            price_updated_at: LONG_AGO.getTime(),
            merged_into_id: VARIANT,
            image_keys: ['phone-variant-photo'],
          },
        ],
      }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
    expect(await product(NEW_PRODUCT)).toMatchObject({ pausedAt: null, imageKeys: [] });
    const stored = await variant(NEW_VARIANT);
    expect(stored).toMatchObject({ mergedIntoId: null, imageKeys: [] });
    expect(stored.priceUpdatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('keeps the stored server values when an update carries other ones (AC-2, C-46, C-49)', async () => {
    await seedServerValues();
    await seedFullPlan();
    await prisma.productVariant.create({
      data: {
        id: OTHER_VARIANT,
        productId: PRODUCT,
        organizationId: ORG,
        name: 'sac 25 kg',
        unit: 'sac',
        price: 30000n,
      },
    });
    // The database stamps the price date on insert, whatever the seed says: read it back.
    const seededPriceDate = (await variant()).priceUpdatedAt;

    const response = await push({
      products: table({
        updated: [
          {
            id: PRODUCT,
            organization_id: ORG,
            name: 'Riz parfumé',
            paused_at: null,
            image_keys: ['phone-product-photo'],
          },
        ],
      }),
      product_variants: table({
        updated: [
          {
            id: VARIANT,
            name: 'sac 5 kilos',
            unit: 'sac',
            price: 8000,
            status: 'ACTIVE',
            price_updated_at: Date.now(),
            merged_into_id: OTHER_VARIANT,
            image_keys: ['phone-variant-photo'],
          },
        ],
      }),
    });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 2, rejected: [], aside: 0 });
    expect(await product()).toMatchObject({
      name: 'Riz parfumé',
      pausedAt: PAUSED_AT,
      imageKeys: ['server-product-photo'],
    });
    const stored = await variant();
    expect(stored).toMatchObject({
      name: 'sac 5 kilos',
      mergedIntoId: null,
      imageKeys: ['server-variant-photo'],
    });
    expect(stored.priceUpdatedAt).toEqual(seededPriceDate);
  });

  it('forbids a line of a read-only table and leaves the stored rows unchanged (AC-3, C-41, C-49)', async () => {
    await prisma.organizationContact.create({
      data: {
        id: CONTACT,
        organizationId: ORG,
        kind: 'PHONE',
        slot: 1,
        value: '+237677000041',
        verifiedAt: CONTACT_VERIFIED_AT,
        verificationMethod: 'CODE',
        createdById: OWNER,
        createdAt: LONG_AGO,
      },
    });
    const [orgBefore, personBefore, contactBefore] = [
      await organization(),
      await person(),
      await contact(),
    ];

    const response = await push({
      organizations: table({
        updated: [
          {
            id: ORG,
            logo_key: 'phone-logo',
            payment_code: 'PHONE-CODE',
            plan: 'ENTERPRISE',
            plan_ends_at: Date.now() + 86_400_000,
            grace_ends_at: Date.now() + 172_800_000,
            max_collaborators: 999,
            max_products: 999,
          },
        ],
      }),
      people: table({ updated: [{ id: OWNER, avatar_key: 'phone-avatar' }] }),
      organization_contacts: table({
        updated: [{ id: CONTACT, verified_at: Date.now(), verification_method: 'OWNER_PHONE' }],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(response.status).toBe(200);
    expect(body.accepted).toBe(0);
    expect(body.rejected).toHaveLength(3);
    expect(body.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'organizations', id: ORG }),
        expect.objectContaining({ table: 'people', id: OWNER }),
        expect.objectContaining({ table: 'organization_contacts', id: CONTACT }),
      ])
    );
    expect(body.rejected.every((r) => r.code === 'SYNC_TABLE_READ_ONLY')).toBe(true);
    expect(await organization()).toEqual(orgBefore);
    expect(await person()).toEqual(personBefore);
    expect(await contact()).toEqual(contactBefore);
  });

  it('forbids a line naming the seat table, answers 200 and keeps the seat status (AC-4)', async () => {
    const response = await push({
      collaborations: table({ updated: [{ id: SEAT, status: 'PAUSED' }] }),
    });

    expect(response.status).toBe(200);
    expect(bodyOf<PushBody>(response)).toMatchObject({
      accepted: 0,
      rejected: [{ table: 'collaborations', id: SEAT, code: 'SYNC_TABLE_READ_ONLY' }],
      aside: 0,
    });
    const seat = await prisma.collaboration.findUniqueOrThrow({ where: { id: SEAT } });
    expect(seat.status).toBe('ACTIVE');
  });

  it('keeps the plan, the limits and the pause when a phone lifts them (AB-1, CWE-915, C-41, C-46)', async () => {
    await seedServerValues();
    await seedFullPlan();
    const orgBefore = await organization();
    expect(orgBefore).toMatchObject({ plan: 'FREE', maxProducts: 30, maxCollaborators: 2 });

    const response = await push({
      organizations: table({
        updated: [{ id: ORG, max_products: 999, max_collaborators: 999, plan: 'ENTERPRISE' }],
      }),
      products: table({
        updated: [{ id: PRODUCT, organization_id: ORG, name: 'Riz', paused_at: null }],
      }),
    });

    const body = bodyOf<PushBody>(response);
    expect(body.rejected).toEqual([
      expect.objectContaining({ table: 'organizations', code: 'SYNC_TABLE_READ_ONLY' }),
    ]);
    expect(await organization()).toEqual(orgBefore);
    expect((await product()).pausedAt).toEqual(PAUSED_AT);
    expect(await prisma.product.count({ where: { organizationId: ORG, pausedAt: null } })).toBe(30);
  });
});
