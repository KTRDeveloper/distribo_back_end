import { beforeEach, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../setup';
import { seedProduct } from '../../helpers/catalog-fixtures';
import { enforceLimits } from '../../../src/modules/billing/limits.service';
import type { OrganizationRights } from '../../../src/modules/billing/rights.service';
import { insertKeepChoiceEvent } from '../../../src/modules/billing/subscription.repository';

const NOW = new Date('2026-10-25T12:00:00.000Z');
const DAY = 86_400_000;
let organizationId: string;
let ownerId: string;
let phone = 0;

async function person(language: 'FR' | 'EN' = 'FR'): Promise<string> {
  const id = uuidv7();
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: `+22507008${String(++phone).padStart(5, '0')}`,
      phoneVerifiedAt: NOW,
      registeredAt: NOW,
      preferredLanguage: language,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    },
  });
  return id;
}

async function business(): Promise<string> {
  const id = uuidv7();
  await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${id}::uuid, 'Fixture Business')`;
  return id;
}

async function product(index: number, org = organizationId): Promise<string> {
  const id = uuidv7();
  const createdAt = new Date(NOW.getTime() - DAY + index * 1000);
  await seedProduct(prisma, {
    id,
    organizationId: org,
    name: 'Fixture Product',
    unit: 'box',
    price: 100n,
  });
  await prisma.$executeRaw`UPDATE products SET created_at = ${createdAt} WHERE id = ${id}::uuid`;
  return id;
}

async function demand(variantId: string, count: number, days = 1, org = organizationId) {
  const relationshipId = uuidv7();
  const customerId = await person();
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${relationshipId}::uuid, ${org}::uuid, ${customerId}::uuid, ${ownerId}::uuid)
  `;
  for (let index = 0; index < count; index++) {
    const orderId = uuidv7();
    const createdAt = new Date(NOW.getTime() - days * DAY);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id,
                            status, total_amount, delivery_cost, created_at)
        VALUES (${orderId}::uuid, ${relationshipId}::uuid, 'SUPPLIER', ${ownerId}::uuid,
                'CONFIRMED', 100, 0, ${createdAt})
      `;
      await tx.$executeRaw`
        INSERT INTO order_lines (id, order_id, product_variant_id, label_applied, quantity,
                                 reference_price, unit_price_applied, amount)
        VALUES (${uuidv7()}::uuid, ${orderId}::uuid, ${variantId}::uuid,
                'Fixture Product', 1, 100, 100, 100)
      `;
    });
  }
}

function rights(
  maxProducts: number | null,
  maxCollaborators: number | null = null
): OrganizationRights {
  return { plan: 'FREE', planEndsAt: null, graceEndsAt: null, maxCollaborators, maxProducts };
}

async function enforce(limit: number | null, seats: number | null = null) {
  return prisma.$transaction((tx) => enforceLimits(tx, organizationId, rights(limit, seats), NOW));
}

async function paused(ids: string[]): Promise<boolean[]> {
  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, pausedAt: true },
  });
  return ids.map((id) => rows.find((row) => row.id === id)!.pausedAt !== null);
}

async function events() {
  return prisma.$queryRaw<
    Array<{ kind: string; actor: string; details: unknown; occurred_at: Date }>
  >`
    SELECT kind::text, actor::text, details, occurred_at FROM subscription_events
    WHERE organization_id = ${organizationId}::uuid AND kind IN ('PAUSED', 'RESUMED')
    ORDER BY id
  `;
}

beforeEach(async () => {
  organizationId = await business();
  ownerId = await person();
  await prisma.$executeRaw`
    INSERT INTO collaborations (id, person_id, organization_id, role, status, accepted_at)
    VALUES (${uuidv7()}::uuid, ${ownerId}::uuid, ${organizationId}::uuid, 'OWNER', 'ACTIVE', ${NOW})
  `;
});

describe('enforceLimits', () => {
  it('most ordered: keeps the three most demanded products', async () => {
    const ids = [];
    for (const [index, count] of [9, 7, 5, 2, 0].entries()) {
      const id = await product(index);
      ids.push(id);
      if (count) await demand(id, count);
    }
    expect(await enforce(3)).toEqual({
      seats: { paused: [], resumed: [], deferred: [] },
      productsPaused: 2,
      productsResumed: 0,
    });
    expect(await paused(ids)).toEqual([false, false, false, true, true]);
  });

  it('ties: keeps the newer product and ignores orders older than 90 days', async () => {
    const older = await product(0);
    const newer = await product(1);
    const oldOrders = await product(2);
    await demand(older, 2);
    await demand(newer, 2);
    await demand(oldOrders, 3, 91);
    await enforce(1);
    expect(await paused([older, newer, oldOrders])).toEqual([true, false, true]);
  });

  it('choice: honors the latest explicit product order before demand', async () => {
    const popular = await product(0);
    const middle = await product(1);
    const chosen = await product(2);
    await demand(popular, 3);
    await demand(middle, 1);
    await prisma.$transaction(async (tx) => {
      await insertKeepChoiceEvent(tx, organizationId, ownerId, {
        collaboration_ids: [],
        product_ids: [middle],
      });
      await insertKeepChoiceEvent(tx, organizationId, ownerId, {
        collaboration_ids: [],
        product_ids: [chosen, popular],
      });
    });
    await enforce(2);
    expect(await paused([popular, middle, chosen])).toEqual([false, true, false]);
    await enforce(1);
    expect(await paused([popular, chosen])).toEqual([true, false]);
  });

  it.each([3, null])('return: resumes products by rank with limit %s', async (limit) => {
    const ids = [];
    for (let index = 0; index < 4; index++) ids.push(await product(index));
    await prisma.product.updateMany({
      where: { id: { in: ids.slice(0, 2) } },
      data: { pausedAt: NOW },
    });
    const result = await enforce(limit);
    expect(result.productsPaused).toBe(0);
    expect(result.productsResumed).toBe(limit === null ? 2 : 1);
    expect(await paused(ids)).toEqual(
      limit === null ? [false, false, false, false] : [true, false, false, false]
    );
  });

  it('seats: applies the collaborator limit and returns its outcome', async () => {
    const seatId = uuidv7();
    const personId = await person();
    await prisma.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status, accepted_at)
      VALUES (${seatId}::uuid, ${personId}::uuid, ${organizationId}::uuid, 'MANAGER', 'ACTIVE', ${NOW})
    `;
    expect(await enforce(null, 0)).toEqual({
      seats: { paused: [seatId], resumed: [], deferred: [] },
      productsPaused: 0,
      productsResumed: 0,
    });
    expect((await prisma.collaboration.findUniqueOrThrow({ where: { id: seatId } })).status).toBe(
      'PAUSED'
    );
  });

  it.each(['FR', 'EN'] as const)(
    'journal: aggregates count-only notices in %s and changes nothing on repeat',
    async (language) => {
      await prisma.person.update({ where: { id: ownerId }, data: { preferredLanguage: language } });
      const ids = [await product(0), await product(1), await product(2)];
      const result = await enforce(1);
      expect(result.productsPaused).toBe(2);
      expect(await events()).toEqual([
        {
          kind: 'PAUSED',
          actor: 'SYSTEM',
          details: { target: 'PRODUCTS', count: 2 },
          occurred_at: NOW,
        },
      ]);
      const notices = await prisma.notification.findMany({
        where: { organizationId },
        orderBy: { id: 'asc' },
      });
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        recipientId: ownerId,
        sourceEvent: 'subscription.products_paused',
      });
      expect(notices[0].content).toBe(
        language === 'FR'
          ? '2 produits mis en pause selon votre abonnement.'
          : '2 products paused under your subscription plan.'
      );
      expect(await enforce(1)).toMatchObject({ productsPaused: 0, productsResumed: 0 });
      expect(await events()).toHaveLength(1);
      expect(
        await prisma.notification.findMany({ where: { organizationId }, orderBy: { id: 'asc' } })
      ).toEqual(notices);
      expect(await paused(ids)).toEqual([true, true, false]);
      expect(await enforce(null)).toMatchObject({ productsPaused: 0, productsResumed: 2 });
      expect(await events()).toContainEqual({
        kind: 'RESUMED',
        actor: 'SYSTEM',
        details: { target: 'PRODUCTS', count: 2 },
        occurred_at: NOW,
      });
      const resumed = await prisma.notification.findFirstOrThrow({
        where: { sourceEvent: 'subscription.products_resumed', organizationId },
      });
      expect(resumed.recipientId).toBe(ownerId);
      expect(resumed.content).toBe(
        language === 'FR'
          ? '2 produits remis en vente selon votre abonnement.'
          : '2 products resumed under your subscription plan.'
      );
    }
  );

  it('other business: ignores foreign products, orders and chosen ids', async () => {
    const otherOrg = await business();
    const foreign = await product(2, otherOrg);
    await demand(foreign, 10, 1, otherOrg);
    const popular = await product(0);
    const newer = await product(1);
    await demand(popular, 1);
    await prisma.$transaction((tx) =>
      insertKeepChoiceEvent(tx, organizationId, ownerId, {
        collaboration_ids: [],
        product_ids: [foreign, uuidv7()],
      })
    );
    const before = await prisma.product.findUniqueOrThrow({ where: { id: foreign } });
    await enforce(1);
    expect(await paused([popular, newer])).toEqual([false, true]);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: foreign } })).toEqual(before);
    expect(await prisma.notification.count({ where: { organizationId: otherOrg } })).toBe(0);
    const foreignEvents = await prisma.$queryRaw<unknown[]>`
      SELECT id FROM subscription_events WHERE organization_id = ${otherOrg}::uuid
    `;
    expect(foreignEvents).toEqual([]);
  });

  it('sums demand across variants and includes the exact 90-day boundary', async () => {
    const combined = await product(0);
    const other = await product(1);
    const variantId = uuidv7();
    await prisma.$executeRaw`
      INSERT INTO product_variants (id, product_id, organization_id, unit, price)
      VALUES (${variantId}::uuid, ${combined}::uuid, ${organizationId}::uuid, 'pack', 100)
    `;
    await demand(combined, 1, 90);
    await demand(variantId, 2);
    await demand(other, 2);
    await enforce(1);
    expect(await paused([combined, other])).toEqual([false, true]);
  });

  it('uses the id to break identical creation-date and demand ties', async () => {
    const first = await product(0);
    const second = await product(0);
    await enforce(1);
    expect(await paused([first, second].sort())).toEqual([false, true]);
  });

  it('zero limit pauses every eligible product without deleting any', async () => {
    const ids = [await product(0), await product(1)];
    expect(await enforce(0)).toMatchObject({ productsPaused: 2, productsResumed: 0 });
    expect(await paused(ids)).toEqual([true, true]);
    expect(await prisma.product.count({ where: { organizationId, deletedAt: null } })).toBe(2);
  });

  it('ranks paused and on-sale products together and journals both transitions', async () => {
    const popular = await product(0);
    const lessPopular = await product(1);
    await demand(popular, 2);
    await demand(lessPopular, 1);
    await prisma.product.update({ where: { id: popular }, data: { pausedAt: NOW } });
    expect(await enforce(1)).toMatchObject({ productsPaused: 1, productsResumed: 1 });
    expect(await paused([popular, lessPopular])).toEqual([false, true]);
    expect(await events()).toEqual(
      expect.arrayContaining([
        {
          kind: 'PAUSED',
          actor: 'SYSTEM',
          details: { target: 'PRODUCTS', count: 1 },
          occurred_at: NOW,
        },
        {
          kind: 'RESUMED',
          actor: 'SYSTEM',
          details: { target: 'PRODUCTS', count: 1 },
          occurred_at: NOW,
        },
      ])
    );
    expect(
      await prisma.notification.count({ where: { organizationId, recipientId: ownerId } })
    ).toBe(2);
  });

  it('fails closed and rolls back when a product change has no active owner to notify', async () => {
    organizationId = await business();
    const id = await product(0);
    await expect(enforce(0)).rejects.toThrow('active owner');
    expect(await paused([id])).toEqual([false]);
    expect(await events()).toEqual([]);
    expect(await prisma.notification.count({ where: { organizationId } })).toBe(0);
  });

  it('rolls back product changes, events and notices with the caller transaction', async () => {
    const id = await product(0);
    await expect(
      prisma.$transaction(async (tx) => {
        await enforceLimits(tx, organizationId, rights(0), NOW);
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect(await paused([id])).toEqual([false]);
    expect(await events()).toEqual([]);
    expect(await prisma.notification.count({ where: { organizationId } })).toBe(0);
  });

  it('serializes simultaneous repeats without duplicate journals or notices', async () => {
    const id = await product(0);
    const results = await Promise.all([enforce(0), enforce(0)]);
    expect(results.map((result) => result.productsPaused).sort()).toEqual([0, 1]);
    expect(await paused([id])).toEqual([true]);
    expect(await events()).toHaveLength(1);
    expect(await prisma.notification.count({ where: { organizationId } })).toBe(1);
  });
});
