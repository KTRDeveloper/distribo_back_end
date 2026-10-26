import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../src/app.js';
import { enforceLimits } from '../../../src/modules/billing/limits.service.js';
import { bodyOf } from '../../helpers/body';
import { createAuthenticatedRequest } from '../../helpers/request';
import { pulledAtAfterSeeding } from '../../helpers/sync-clock';
import { prisma } from '../../setup.js';

vi.mock('../../../src/modules/billing/limits.service.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/modules/billing/limits.service.js')>();
  return { ...actual, enforceLimits: vi.fn(actual.enforceLimits) };
});

const OWNER = '0199e035-0000-7000-8000-000000000001';
const ORG = '0199e035-0000-7000-8000-0000000000a1';
const DEVICE = '0199e035-0000-7000-8000-000000000701';
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const PAUSED_AT = new Date('2026-02-01T00:00:00.000Z');

type PushBody = {
  accepted: number;
  rejected: Array<{ table: string; id: string; code: string; message: string }>;
  aside: number;
};

const id = (kind: number, index: number) =>
  `0199e035-0000-7000-80${String(kind).padStart(2, '0')}-${String(index).padStart(12, '0')}`;
const existingProduct = (index: number) => id(1, index);
const existingVariant = (index: number) => id(2, index);
const newProduct = (index: number) => id(3, index);
const newVariant = (index: number) => id(4, index);

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

/** Pushes `count` new products, each with one ACTIVE variant. */
const pushNewProducts = (count: number) =>
  push({
    products: table({
      created: Array.from({ length: count }, (_, i) => ({
        id: newProduct(i),
        organization_id: ORG,
        name: `Nouveau ${i}`,
      })),
    }),
    product_variants: table({
      created: Array.from({ length: count }, (_, i) => ({
        id: newVariant(i),
        product_id: newProduct(i),
        name: `Variante ${i}`,
        unit: 'sac',
        price: 1000 + i,
        status: 'ACTIVE',
      })),
    }),
  });

/** Seeds `count` products on sale, plus `pausedCount` paused ones, each with one ACTIVE variant. */
async function seedCatalog(count: number, pausedCount = 0) {
  const total = count + pausedCount;
  await prisma.product.createMany({
    data: Array.from({ length: total }, (_, i) => ({
      id: existingProduct(i),
      organizationId: ORG,
      name: `Produit ${i}`,
      createdAt: new Date(LONG_AGO.getTime() + i * 1000),
      pausedAt: i >= count ? PAUSED_AT : null,
    })),
  });
  await prisma.productVariant.createMany({
    data: Array.from({ length: total }, (_, i) => ({
      id: existingVariant(i),
      productId: existingProduct(i),
      organizationId: ORG,
      name: 'unité',
      unit: 'pièce',
      price: 500n,
    })),
  });
}

const onSale = () =>
  prisma.product.count({ where: { organizationId: ORG, deletedAt: null, pausedAt: null } });
const paused = () =>
  prisma.product.count({
    where: { organizationId: ORG, deletedAt: null, pausedAt: { not: null } },
  });
const notices = () =>
  prisma.notification.count({
    where: { recipientId: OWNER, sourceEvent: 'subscription.products_paused' },
  });

describe('products added beyond the plan are paused after a push (SYNC-035)', () => {
  beforeEach(async () => {
    vi.mocked(enforceLimits).mockClear();
    await prisma.person.create({
      data: {
        id: OWNER,
        fullName: 'Plan Owner',
        phoneNumber: '+237600003501',
        phoneVerifiedAt: LONG_AGO,
        email: 'plan.owner@example.test',
        passwordHash: 'test-password-hash',
        registeredAt: LONG_AGO,
        preferredLanguage: 'FR',
        createdAt: LONG_AGO,
      },
    });
    await prisma.device.create({
      data: { id: DEVICE, personId: OWNER, platform: 'ANDROID', appVersion: '1.0.0' },
    });
    await prisma.organization.create({ data: { id: ORG, name: 'Org Plan', createdAt: LONG_AGO } });
    await prisma.collaboration.create({
      data: {
        id: '0199e035-0000-7000-8000-000000000101',
        personId: OWNER,
        organizationId: ORG,
        role: 'OWNER',
        status: 'ACTIVE',
        invitedAt: LONG_AGO,
        acceptedAt: LONG_AGO,
      },
    });
  });

  it('pauses what exceeds the plan and tells the owner once (AC-1, C-46)', async () => {
    await seedCatalog(30);

    const response = await pushNewProducts(3);

    const body = bodyOf<PushBody>(response);
    expect(body).toMatchObject({ accepted: 6, rejected: [], aside: 0 });
    expect(await prisma.product.count({ where: { id: { in: [0, 1, 2].map(newProduct) } } })).toBe(
      3
    );
    expect(
      await prisma.productVariant.count({ where: { id: { in: [0, 1, 2].map(newVariant) } } })
    ).toBe(3);
    expect(await onSale()).toBe(30);
    expect(await paused()).toBe(3);
    expect(await notices()).toBe(1);
  });

  it('pauses nothing and sends no notice when the products fit the plan (AC-2)', async () => {
    await seedCatalog(10);

    const response = await pushNewProducts(3);

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 6, rejected: [] });
    expect(await onSale()).toBe(13);
    expect(await paused()).toBe(0);
    expect(await notices()).toBe(0);
  });

  it('puts a paused product back on sale when a deletion frees room (AC-3)', async () => {
    await seedCatalog(30, 1);

    const response = await push({ products: table({ deleted: [existingProduct(0)] }) });

    expect(bodyOf<PushBody>(response)).toMatchObject({ accepted: 1, rejected: [] });
    expect(await onSale()).toBe(30);
    expect(await paused()).toBe(0);
    const back = await prisma.product.findUniqueOrThrow({ where: { id: existingProduct(30) } });
    expect(back.pausedAt).toBeNull();
  });

  it('does not call billing for a batch without a catalog line (AC-4)', async () => {
    await seedCatalog(2);

    const response = await push({ customer_relationships: table({}) });

    expect(response.status).toBe(200);
    expect(enforceLimits).not.toHaveBeenCalled();
  });

  it('calls billing once for an organization whose catalog changed', async () => {
    await seedCatalog(2);

    await pushNewProducts(2);

    expect(enforceLimits).toHaveBeenCalledTimes(1);
  });

  it('refuses no line of a flood of 40 products and keeps 30 on sale (AB-1, T11, CWE-770)', async () => {
    const response = await pushNewProducts(40);

    const body = bodyOf<PushBody>(response);
    expect(body).toMatchObject({ accepted: 80, rejected: [], aside: 0 });
    expect(await prisma.product.count({ where: { organizationId: ORG } })).toBe(40);
    expect(await onSale()).toBe(30);
    expect(await paused()).toBe(10);
  });
});
