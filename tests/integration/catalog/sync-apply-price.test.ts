import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import {
  applyPriceFromSync,
  deletePriceFromSync,
  type PriceSyncInput,
} from '../../../src/modules/catalog/catalog.sync-writers';

const ORG_A = '0199c039-0000-7000-8000-000000000001';
const ORG_B = '0199c039-0000-7000-8000-000000000002';
const OWNER = '0199c039-0000-7000-8000-000000000011';
const CUSTOMER = '0199c039-0000-7000-8000-000000000012';
const CUSTOMER_2 = '0199c039-0000-7000-8000-000000000013';
const CUSTOMER_B = '0199c039-0000-7000-8000-000000000014';
const REL = '0199c039-0000-7000-8000-000000000021';
const REL_2 = '0199c039-0000-7000-8000-000000000022';
const REL_B = '0199c039-0000-7000-8000-000000000023';
const REL_DELETED = '0199c039-0000-7000-8000-000000000024';
const PRODUCT = '0199c039-0000-7000-8000-000000000031';
const PRODUCT_B = '0199c039-0000-7000-8000-000000000032';
const VARIANT = '0199c039-0000-7000-8000-000000000041';
const VARIANT_2 = '0199c039-0000-7000-8000-000000000042';
const VARIANT_MERGED = '0199c039-0000-7000-8000-000000000043';
const VARIANT_GONE = '0199c039-0000-7000-8000-000000000044';
const VARIANT_B = '0199c039-0000-7000-8000-000000000045';
const PRICE_A = '0199c039-0000-7000-8000-000000000051';
const PRICE_B = '0199c039-0000-7000-8000-000000000052';
const PRICE_DELETED = '0199c039-0000-7000-8000-000000000053';
const PRICE_FOREIGN = '0199c039-0000-7000-8000-000000000054';
const PRICE_OTHER_PAIR = '0199c039-0000-7000-8000-000000000055';
const UNKNOWN = '0199c039-0000-7000-8000-0000000000ff';

type PriceRow = {
  id: string;
  customer_relationship_id: string;
  product_id: string;
  product_variant_id: string;
  price: bigint;
  set_by_id: string;
  deleted_at: Date | null;
};

function input(overrides: Partial<PriceSyncInput> = {}): PriceSyncInput {
  return {
    id: PRICE_A,
    relationshipId: REL,
    variantId: VARIANT,
    price: 6000,
    setById: OWNER,
    ...overrides,
  };
}

function apply(data: PriceSyncInput, organizationId = ORG_A) {
  return prisma.$transaction((tx) => applyPriceFromSync(tx, organizationId, data, new Date()));
}

function remove(priceId: string, organizationId = ORG_A) {
  return prisma.$transaction((tx) => deletePriceFromSync(tx, organizationId, priceId, new Date()));
}

function allPrices() {
  return prisma.$queryRaw<PriceRow[]>`
    SELECT id::text, customer_relationship_id::text, product_id::text,
           product_variant_id::text, price, set_by_id::text, deleted_at
    FROM customer_prices ORDER BY id`;
}

async function readPrice(id: string): Promise<(PriceRow & { server_updated_at: Date }) | undefined> {
  const rows = await prisma.$queryRaw<Array<PriceRow & { server_updated_at: Date }>>`
    SELECT id::text, customer_relationship_id::text, product_id::text,
           product_variant_id::text, price, set_by_id::text, deleted_at, server_updated_at
    FROM customer_prices WHERE id = ${id}::uuid`;
  return rows[0];
}

async function livePricesOfPair(relationshipId: string, variantId: string) {
  return prisma.$queryRaw<Array<{ id: string; price: bigint }>>`
    SELECT id::text, price FROM customer_prices
    WHERE customer_relationship_id = ${relationshipId}::uuid
      AND product_variant_id = ${variantId}::uuid AND deleted_at IS NULL`;
}

async function insertPrice(
  id: string,
  options: {
    relationship?: string;
    variant?: string;
    product?: string;
    price?: number;
    deleted?: boolean;
  } = {}
) {
  const deletedAt = options.deleted ? new Date('2026-02-01T00:00:00Z') : null;
  await prisma.$executeRaw`
    INSERT INTO customer_prices (
      id, customer_relationship_id, product_id, product_variant_id, price, set_by_id, deleted_at
    )
    VALUES (${id}::uuid, ${options.relationship ?? REL}::uuid, ${options.product ?? PRODUCT}::uuid,
            ${options.variant ?? VARIANT}::uuid, ${options.price ?? 6000}::bigint,
            ${OWNER}::uuid, ${deletedAt}::timestamptz)`;
}

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: OWNER, fullName: 'Fixture Owner', phoneNumber: '+2250700039011', ...registered },
      { id: CUSTOMER, fullName: 'Fixture Customer', phoneNumber: '+2250700039012', ...registered },
      { id: CUSTOMER_2, fullName: 'Fixture Customer 2', phoneNumber: '+2250700039013', ...registered },
      { id: CUSTOMER_B, fullName: 'Fixture Customer B', phoneNumber: '+2250700039014', ...registered },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${ORG_A}::uuid, 'Fixture Business A'), (${ORG_B}::uuid, 'Fixture Business B')`;
  // The mirror triggers would give each product a variant of its own id, so they are off while seeding.
  await prisma.$executeRaw`ALTER TABLE products DISABLE TRIGGER USER`;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name, unit, price)
    VALUES (${PRODUCT}::uuid, ${ORG_A}::uuid, 'Fixture Rice', 'sack', 3000),
           (${PRODUCT_B}::uuid, ${ORG_B}::uuid, 'Fixture Oil', 'can', 1500)`;
  await prisma.$executeRaw`ALTER TABLE products ENABLE TRIGGER USER`;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, status)
    VALUES (${VARIANT}::uuid, ${PRODUCT}::uuid, ${ORG_A}::uuid, NULL, 'sack', 3000, 'ACTIVE'),
           (${VARIANT_2}::uuid, ${PRODUCT}::uuid, ${ORG_A}::uuid, 'Small', 'bag', 800, 'ACTIVE'),
           (${VARIANT_B}::uuid, ${PRODUCT_B}::uuid, ${ORG_B}::uuid, NULL, 'can', 1500, 'ACTIVE')`;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, status, deleted_at)
    VALUES (${VARIANT_GONE}::uuid, ${PRODUCT}::uuid, ${ORG_A}::uuid, 'Big', 'drum', 9000, 'ACTIVE', now())`;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price, status, deleted_at, merged_into_id)
    VALUES (${VARIANT_MERGED}::uuid, ${PRODUCT}::uuid, ${ORG_A}::uuid, NULL, 'SACK ', 100, 'ACTIVE', now(), ${VARIANT}::uuid)`;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL}::uuid, ${ORG_A}::uuid, ${CUSTOMER}::uuid, ${OWNER}::uuid),
           (${REL_2}::uuid, ${ORG_A}::uuid, ${CUSTOMER_2}::uuid, ${OWNER}::uuid),
           (${REL_B}::uuid, ${ORG_B}::uuid, ${CUSTOMER_B}::uuid, ${OWNER}::uuid)`;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_label, created_by_id, deleted_at)
    VALUES (${REL_DELETED}::uuid, ${ORG_A}::uuid, 'Fixture Counter', ${OWNER}::uuid, now())`;
});

describe('negotiated price sent by a phone (CAT-039)', () => {
  it('AC-1 creates a price with its variant and product, written by the given person', async () => {
    expect(await apply(input())).toEqual({ result: 'CREATED' });

    const row = await readPrice(PRICE_A);
    expect(row).toMatchObject({
      customer_relationship_id: REL,
      product_variant_id: VARIANT,
      product_id: PRODUCT,
      price: 6000n,
      set_by_id: OWNER,
      deleted_at: null,
    });
  });

  it('AC-2 a price entered twice under two ids keeps one live price, the last', async () => {
    await insertPrice(PRICE_A, { price: 6000 });

    expect(await apply(input({ id: PRICE_B, price: 6500 }))).toEqual({ result: 'CREATED' });

    expect((await readPrice(PRICE_A))?.deleted_at).not.toBeNull();
    const live = await livePricesOfPair(REL, VARIANT);
    expect(live).toEqual([{ id: PRICE_B, price: 6500n }]);
  });

  it('AC-3 an edit answers UPDATED, then UNCHANGED, and the pair does not change', async () => {
    await insertPrice(PRICE_A, { price: 6000 });

    expect(await apply(input({ price: 7000 }))).toEqual({ result: 'UPDATED' });
    const first = await readPrice(PRICE_A);
    expect(first).toMatchObject({
      price: 7000n,
      customer_relationship_id: REL,
      product_variant_id: VARIANT,
    });

    expect(await apply(input({ price: 7000 }))).toEqual({ result: 'UNCHANGED' });
    const second = await readPrice(PRICE_A);
    expect(second?.server_updated_at.getTime()).toBe(first?.server_updated_at.getTime());
  });

  it('AC-4 a merged variant is written on the survivor, a deleted one is brought back off sale', async () => {
    expect(await apply(input({ variantId: VARIANT_MERGED }))).toEqual({ result: 'CREATED' });
    expect((await readPrice(PRICE_A))?.product_variant_id).toBe(VARIANT);

    expect(await apply(input({ id: PRICE_B, variantId: VARIANT_GONE, price: 4000 }))).toEqual({
      result: 'CREATED',
    });
    expect((await readPrice(PRICE_B))?.product_variant_id).toBe(VARIANT_GONE);
    const variant = await prisma.$queryRaw<Array<{ status: string; deleted_at: Date | null }>>`
      SELECT status::text AS status, deleted_at FROM product_variants WHERE id = ${VARIANT_GONE}::uuid`;
    expect(variant[0]).toEqual({ status: 'INACTIVE', deleted_at: null });
  });

  describe('AC-5 nothing written', () => {
    beforeEach(async () => {
      await insertPrice(PRICE_DELETED, { variant: VARIANT_2, deleted: true });
      await prisma.$executeRaw`
        INSERT INTO customer_prices (id, customer_relationship_id, product_id, product_variant_id, price, set_by_id)
        VALUES (${PRICE_FOREIGN}::uuid, ${REL_B}::uuid, ${PRODUCT_B}::uuid, ${VARIANT_B}::uuid, 1500, ${OWNER}::uuid)`;
    });

    async function expectNothingWritten(data: PriceSyncInput, expected: object) {
      const before = await allPrices();
      const variantsBefore = await prisma.$queryRaw`
        SELECT id::text, status::text, deleted_at FROM product_variants ORDER BY id`;
      expect(await apply(data)).toEqual(expected);
      expect(await allPrices()).toEqual(before);
      expect(
        await prisma.$queryRaw`SELECT id::text, status::text, deleted_at FROM product_variants ORDER BY id`
      ).toEqual(variantsBefore);
    }

    it.each([0, 12.5, -3, Number.NaN, 2 ** 60])('refuses the price %s as INVALID', async (price) => {
      await expectNothingWritten(input({ price }), { result: 'INVALID', invalidFields: ['price'] });
    });

    it('a variant brought back is not written when the price is invalid', async () => {
      await expectNothingWritten(input({ variantId: VARIANT_GONE, price: 0 }), {
        result: 'INVALID',
        invalidFields: ['price'],
      });
    });

    it('refuses a relationship of another organization as NO_RELATIONSHIP', async () => {
      await expectNothingWritten(input({ relationshipId: REL_B }), { result: 'NO_RELATIONSHIP' });
    });

    it('refuses an unknown relationship and a deleted one as NO_RELATIONSHIP', async () => {
      await expectNothingWritten(input({ relationshipId: UNKNOWN }), { result: 'NO_RELATIONSHIP' });
      await expectNothingWritten(input({ relationshipId: REL_DELETED }), {
        result: 'NO_RELATIONSHIP',
      });
    });

    it('refuses an unknown variant and another business variant as NO_VARIANT', async () => {
      await expectNothingWritten(input({ variantId: UNKNOWN }), { result: 'NO_VARIANT' });
      await expectNothingWritten(input({ variantId: VARIANT_B }), { result: 'NO_VARIANT' });
    });

    it('refuses the id of a deleted price as GONE', async () => {
      await expectNothingWritten(input({ id: PRICE_DELETED, variantId: VARIANT_2 }), {
        result: 'GONE',
      });
    });

    it('refuses the id of another business price as FOREIGN', async () => {
      await expectNothingWritten(input({ id: PRICE_FOREIGN, price: 1 }), { result: 'FOREIGN' });
    });
  });

  it('AC-6 a removal answers DELETED, ALREADY and NOT_FOUND, and sets deleted_at once', async () => {
    await insertPrice(PRICE_A);

    expect(await remove(PRICE_A)).toBe('DELETED');
    const first = (await readPrice(PRICE_A))?.deleted_at;
    expect(first).not.toBeNull();

    expect(await remove(PRICE_A)).toBe('ALREADY');
    expect((await readPrice(PRICE_A))?.deleted_at).toEqual(first);

    expect(await remove(UNKNOWN)).toBe('NOT_FOUND');
  });

  it('a removal of another business price answers NOT_FOUND and keeps it', async () => {
    await insertPrice(PRICE_FOREIGN, { relationship: REL_B, variant: VARIANT_B, product: PRODUCT_B });

    expect(await remove(PRICE_FOREIGN)).toBe('NOT_FOUND');
    expect((await readPrice(PRICE_FOREIGN))?.deleted_at).toBeNull();
  });

  it('AB-1 business A sending a price for a relationship of business B writes nothing', async () => {
    const before = await allPrices();

    expect(await apply(input({ relationshipId: REL_B }))).toEqual({ result: 'NO_RELATIONSHIP' });
    expect(await allPrices()).toEqual(before);
  });

  it('AB-2 the id of a live price sent with another pair moves only the price', async () => {
    await insertPrice(PRICE_A, { price: 6000 });
    await insertPrice(PRICE_OTHER_PAIR, { relationship: REL_2, variant: VARIANT_2, price: 800 });

    expect(
      await apply(input({ relationshipId: REL_2, variantId: VARIANT_2, price: 9000 }))
    ).toEqual({ result: 'UPDATED' });

    expect(await readPrice(PRICE_A)).toMatchObject({
      customer_relationship_id: REL,
      product_variant_id: VARIANT,
      price: 9000n,
    });
    expect(await readPrice(PRICE_OTHER_PAIR)).toMatchObject({ price: 800n });
  });

  it('AB-2 an unchanged price is also UNCHANGED when sent with another pair', async () => {
    await insertPrice(PRICE_A, { price: 6000 });

    expect(
      await apply(input({ relationshipId: REL_2, variantId: VARIANT_2, price: 6000 }))
    ).toEqual({ result: 'UNCHANGED' });
  });

  it('two pushes of the same pair at once leave one live price', async () => {
    const results = await Promise.all([
      apply(input({ id: PRICE_A, price: 6000 })),
      apply(input({ id: PRICE_B, price: 6500 })),
    ]);

    expect(results.map(({ result }) => result)).toEqual(['CREATED', 'CREATED']);
    expect(await livePricesOfPair(REL, VARIANT)).toHaveLength(1);
  });

  it('the same new id pushed twice at once creates it once and repeats as UNCHANGED', async () => {
    const results = await Promise.all([apply(input()), apply(input())]);

    expect(results.map(({ result }) => result).sort()).toEqual(['CREATED', 'UNCHANGED']);
    expect(await livePricesOfPair(REL, VARIANT)).toEqual([{ id: PRICE_A, price: 6000n }]);
  });
});
