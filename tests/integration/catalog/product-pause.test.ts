import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import {
  listPausedProducts,
  listProductsOnSale,
  setProductsPaused,
} from '../../../src/modules/catalog/catalog.repository';

const ORG_A = '0199c040-0000-7000-8000-0000000000a1';
const ORG_B = '0199c040-0000-7000-8000-0000000000a2';
const PAUSE_AT = new Date('2026-10-12T09:00:00.000Z');
const OLD_PAUSE = new Date('2026-02-01T00:00:00.000Z');

let seq = 0;
/** A unique UUIDv7-shaped fixture id. */
function fixtureId(): string {
  seq += 1;
  return `0199c040-0000-7000-8000-${String(seq).padStart(12, '0')}`;
}

type VariantSeed = { status?: 'ACTIVE' | 'INACTIVE'; deleted?: boolean };
type ProductSeed = {
  deleted?: boolean;
  paused?: boolean;
  createdAt?: Date;
  variants?: VariantSeed[];
};

/** Inserts a product with its variants (one ACTIVE variant by default); returns the ids. */
async function seedProduct(
  organizationId: string,
  seed: ProductSeed = {}
): Promise<{ productId: string; variantIds: string[] }> {
  const productId = fixtureId();
  await prisma.product.create({
    data: {
      id: productId,
      organizationId,
      name: 'Fixture product',
      createdAt: seed.createdAt,
      deletedAt: seed.deleted ? new Date('2026-02-01T00:00:00.000Z') : null,
      pausedAt: seed.paused ? OLD_PAUSE : null,
    },
  });
  const variantIds: string[] = [];
  for (const variant of seed.variants ?? [{}]) {
    const id = fixtureId();
    variantIds.push(id);
    await prisma.productVariant.create({
      data: {
        id,
        productId,
        organizationId,
        name: `Variant ${seq}`,
        unit: 'kg',
        price: 100n,
        status: variant.status ?? 'ACTIVE',
        deletedAt: variant.deleted ? new Date('2026-02-01T00:00:00.000Z') : null,
      },
    });
  }
  return { productId, variantIds };
}

const onSale = (organizationId: string) =>
  prisma.$transaction((tx) => listProductsOnSale(tx, organizationId));
const paused = (organizationId: string) =>
  prisma.$transaction((tx) => listPausedProducts(tx, organizationId));
const setPaused = (organizationId: string, ids: string[], pause: boolean, now: Date) =>
  prisma.$transaction((tx) => setProductsPaused(tx, organizationId, ids, pause, now));
const readProduct = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  seq = 0;
  await prisma.organization.create({ data: { id: ORG_A, name: 'Fixture A' } });
  await prisma.organization.create({ data: { id: ORG_B, name: 'Fixture B' } });
});

describe('listProductsOnSale', () => {
  it('returns only the product with an ACTIVE variant, with all its live variant ids', async () => {
    const sold = await seedProduct(ORG_A, {
      variants: [{}, { status: 'INACTIVE' }, { deleted: true }],
    });
    await seedProduct(ORG_A, { variants: [{ status: 'INACTIVE' }, { status: 'INACTIVE' }] });
    await seedProduct(ORG_A, { deleted: true });
    await seedProduct(ORG_A, { paused: true });

    const items = await onSale(ORG_A);

    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe(sold.productId);
    expect(items[0].createdAt).toBeInstanceOf(Date);
    expect([...items[0].variantIds].sort()).toEqual(
      [sold.variantIds[0], sold.variantIds[1]].sort()
    );
  });

  it('lists newest first, then by id', async () => {
    const oldest = await seedProduct(ORG_A, { createdAt: new Date('2026-03-01T00:00:00.000Z') });
    const newest = await seedProduct(ORG_A, { createdAt: new Date('2026-05-01T00:00:00.000Z') });
    const middle = await seedProduct(ORG_A, { createdAt: new Date('2026-04-01T00:00:00.000Z') });

    const items = await onSale(ORG_A);

    expect(items.map((item) => item.productId)).toEqual([
      newest.productId,
      middle.productId,
      oldest.productId,
    ]);
  });

  it('breaks a tie on created_at by id', async () => {
    const same = new Date('2026-03-01T00:00:00.000Z');
    const first = await seedProduct(ORG_A, { createdAt: same });
    const second = await seedProduct(ORG_A, { createdAt: same });
    const items = await onSale(ORG_A);
    expect(items.map((item) => item.productId)).toEqual([first.productId, second.productId]);
  });
});

describe('listPausedProducts', () => {
  it('returns the paused products that still have an ACTIVE variant', async () => {
    const pausedSold = await seedProduct(ORG_A, { paused: true });
    await seedProduct(ORG_A, { paused: true, variants: [{ status: 'INACTIVE' }] });
    await seedProduct(ORG_A, { paused: true, deleted: true });
    await seedProduct(ORG_A);

    const items = await paused(ORG_A);

    expect(items.map((item) => item.productId)).toEqual([pausedSold.productId]);
    expect(items[0].variantIds).toEqual(pausedSold.variantIds);
  });
});

describe('setProductsPaused', () => {
  it('pauses two products at the given instant and moves them to the paused list', async () => {
    const one = await seedProduct(ORG_A);
    const two = await seedProduct(ORG_A);
    const kept = await seedProduct(ORG_A);
    const before = await readProduct(one.productId);

    const changed = await setPaused(ORG_A, [one.productId, two.productId], true, PAUSE_AT);

    expect([...changed].sort()).toEqual([one.productId, two.productId].sort());
    const after = await readProduct(one.productId);
    expect(after.pausedAt).toEqual(PAUSE_AT);
    // The database sets server_updated_at itself (C-35), so the phones see the change.
    expect(after.serverUpdatedAt.getTime()).toBeGreaterThanOrEqual(
      before.serverUpdatedAt.getTime()
    );
    expect((await readProduct(two.productId)).pausedAt).toEqual(PAUSE_AT);
    expect((await onSale(ORG_A)).map((item) => item.productId)).toEqual([kept.productId]);
    expect((await paused(ORG_A)).map((item) => item.productId).sort()).toEqual(
      [one.productId, two.productId].sort()
    );
  });

  it('resumes a paused product and moves its server_updated_at forward', async () => {
    const product = await seedProduct(ORG_A, { paused: true });
    const before = await readProduct(product.productId);

    const changed = await setPaused(ORG_A, [product.productId], false, PAUSE_AT);

    expect(changed).toEqual([product.productId]);
    const after = await readProduct(product.productId);
    expect(after.pausedAt).toBeNull();
    expect(after.serverUpdatedAt.getTime()).toBeGreaterThan(before.serverUpdatedAt.getTime());
    expect((await onSale(ORG_A)).map((item) => item.productId)).toEqual([product.productId]);
  });

  it('leaves a deleted product unchanged and does not return it', async () => {
    const product = await seedProduct(ORG_A, { deleted: true });
    expect(await setPaused(ORG_A, [product.productId], true, PAUSE_AT)).toEqual([]);
    expect((await readProduct(product.productId)).pausedAt).toBeNull();
  });

  it('keeps the first paused_at of an already paused product and does not return it', async () => {
    const product = await seedProduct(ORG_A, { paused: true });
    expect(await setPaused(ORG_A, [product.productId], true, PAUSE_AT)).toEqual([]);
    expect((await readProduct(product.productId)).pausedAt).toEqual(OLD_PAUSE);
  });

  it('does not return a product that is already on sale when resuming', async () => {
    const product = await seedProduct(ORG_A);
    expect(await setPaused(ORG_A, [product.productId], false, PAUSE_AT)).toEqual([]);
  });

  it('returns an empty list for an empty list of ids', async () => {
    await seedProduct(ORG_A);
    expect(await setPaused(ORG_A, [], true, PAUSE_AT)).toEqual([]);
    expect(await onSale(ORG_A)).toHaveLength(1);
  });

  it('rolls back with the caller transaction', async () => {
    const product = await seedProduct(ORG_A);
    await expect(
      prisma.$transaction(async (tx) => {
        await setProductsPaused(tx, ORG_A, [product.productId], true, PAUSE_AT);
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect((await readProduct(product.productId)).pausedAt).toBeNull();
  });
});

describe('another business', () => {
  it("leaves business B's product unchanged and does not return its id", async () => {
    const mine = await seedProduct(ORG_A);
    const theirs = await seedProduct(ORG_B);

    const changed = await setPaused(ORG_A, [mine.productId, theirs.productId], true, PAUSE_AT);

    expect(changed).toEqual([mine.productId]);
    expect((await readProduct(theirs.productId)).pausedAt).toBeNull();
  });

  it("does not resume business B's paused product", async () => {
    const theirs = await seedProduct(ORG_B, { paused: true });
    expect(await setPaused(ORG_A, [theirs.productId], false, PAUSE_AT)).toEqual([]);
    expect((await readProduct(theirs.productId)).pausedAt).toEqual(OLD_PAUSE);
  });

  it("leaves business B's products out of the lists", async () => {
    await seedProduct(ORG_B);
    await seedProduct(ORG_B, { paused: true });
    expect(await onSale(ORG_A)).toEqual([]);
    expect(await paused(ORG_A)).toEqual([]);
  });
});
