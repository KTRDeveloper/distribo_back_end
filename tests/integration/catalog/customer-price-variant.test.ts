import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { upsertCustomerPrice } from '../../../src/modules/catalog/catalog.repository';

const ORG_A = '0199c015-0000-7000-8000-000000000001';
const ORG_B = '0199c015-0000-7000-8000-000000000002';
const OWNER = '0199c015-0000-7000-8000-000000000011';
const CUSTOMER = '0199c015-0000-7000-8000-000000000012';
const REL_A = '0199c015-0000-7000-8000-000000000021';
const REL_PERSON = '0199c015-0000-7000-8000-000000000022';
const PRODUCT = '0199c015-0000-7000-8000-000000000031';
const PRODUCT_B = '0199c015-0000-7000-8000-000000000033';
const VARIANT = PRODUCT; // CAT-013: the first variant has the id of its product
const VARIANT_2 = '0199c015-0000-7000-8000-000000000041';
const VARIANT_B = PRODUCT_B;
const PRICE_1 = '0199c015-0000-7000-8000-000000000051';
const PRICE_2 = '0199c015-0000-7000-8000-000000000052';
const PRICE_3 = '0199c015-0000-7000-8000-000000000053';
const UNKNOWN_ID = '0199c015-0000-7000-8000-0000000009ff';

type SqlError = {
  code?: string;
  message?: string;
  meta?: {
    code?: string;
    driverAdapterError?: {
      cause?: { code?: string; originalCode?: string; message?: string };
    };
  };
};

/** Extracts the PostgreSQL code wrapped by the Prisma driver adapter. */
function sqlCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as SqlError;
  const cause = candidate.meta?.driverAdapterError?.cause;
  const message = [candidate.message, cause?.message].filter(Boolean).join(' ');
  return (
    cause?.code ??
    cause?.originalCode ??
    candidate.meta?.code ??
    candidate.code ??
    message.match(/Code:\s*(\w+)/)?.[1]
  );
}

async function captureSqlCode(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation;
  } catch (error) {
    return sqlCode(error) ?? 'UNKNOWN';
  }
  return undefined;
}

/** Inserts a price for a variant. */
function insertPrice(
  id: string,
  options: {
    variant?: string;
    relationship?: string;
    deletedAt?: Date | null;
    price?: number;
  } = {}
): Promise<number> {
  const variant = options.variant ?? VARIANT;
  const relationship = options.relationship ?? REL_A;
  const price = options.price ?? 2500;
  const deletedAt = options.deletedAt ?? null;
  return prisma.$executeRaw`
    INSERT INTO customer_prices (
      id, customer_relationship_id, product_variant_id, price, set_by_id, deleted_at
    )
    VALUES (${id}::uuid, ${relationship}::uuid, ${variant}::uuid,
            ${price}::bigint, ${OWNER}::uuid, ${deletedAt}::timestamptz)
  `;
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
      { id: OWNER, fullName: 'Fixture Owner', phoneNumber: '+2250700015011', ...registered },
      { id: CUSTOMER, fullName: 'Fixture Customer', phoneNumber: '+2250700015012', ...registered },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${ORG_A}::uuid, 'Fixture Business A'), (${ORG_B}::uuid, 'Fixture Business B')
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name)
    VALUES
      (${PRODUCT}::uuid, ${ORG_A}::uuid, 'Fixture Rice'),
      (${PRODUCT_B}::uuid, ${ORG_B}::uuid, 'Fixture Oil')
  `;
  await prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price)
    VALUES
      (${VARIANT}::uuid, ${PRODUCT}::uuid, ${ORG_A}::uuid, NULL, 'sack', 3000),
      (${VARIANT_2}::uuid, ${PRODUCT}::uuid, ${ORG_A}::uuid, 'Small', 'bag', 800),
      (${VARIANT_B}::uuid, ${PRODUCT_B}::uuid, ${ORG_B}::uuid, NULL, 'can', 1500)
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_A}::uuid, ${ORG_A}::uuid, ${CUSTOMER}::uuid, ${OWNER}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_person_id, customer_person_id, created_by_id, status
    )
    VALUES (${REL_PERSON}::uuid, ${OWNER}::uuid, ${CUSTOMER}::uuid, ${CUSTOMER}::uuid, 'PENDING')
  `;
});

describe('customer price variant', () => {
  describe('AC-3 one live price per customer and variant', () => {
    it('rejects the same variant while the first price is live (23505)', async () => {
      await insertPrice(PRICE_1, { variant: VARIANT });
      expect(await captureSqlCode(insertPrice(PRICE_2, { variant: VARIANT }))).toBe('23505');
    });

    it('accepts the same variant when the first price is deleted', async () => {
      await insertPrice(PRICE_1, { variant: VARIANT, deletedAt: new Date('2026-02-01T00:00:00Z') });
      await expect(insertPrice(PRICE_2, { variant: VARIANT })).resolves.toBe(1);
    });

    it('accepts another variant of the same product while the first price is live', async () => {
      await insertPrice(PRICE_1, { variant: VARIANT });
      await expect(insertPrice(PRICE_2, { variant: VARIANT_2 })).resolves.toBe(1);
    });

  });

  it('AC-4 replace: upserting the same pair twice keeps one row with the new price', async () => {
    await prisma.$transaction((tx) =>
      upsertCustomerPrice(tx, {
        id: PRICE_1,
        relationshipId: REL_A,
        variantId: VARIANT,
        price: 2800n,
        setById: OWNER,
      })
    );
    await prisma.$transaction((tx) =>
      upsertCustomerPrice(tx, {
        id: PRICE_2,
        relationshipId: REL_A,
        variantId: VARIANT,
        price: 3200n,
        setById: OWNER,
      })
    );

        const rows = await prisma.$queryRaw<Array<{ id: string; price: bigint }>>`
      SELECT id::text, price FROM customer_prices
      WHERE customer_relationship_id = ${REL_A}::uuid AND deleted_at IS NULL
    `;
    expect(rows).toEqual([{ id: PRICE_1, price: 3200n }]);
  });

  it('AC-5 keys: an unknown variant is rejected (23503)', async () => {
    expect(await captureSqlCode(insertPrice(PRICE_1, { variant: UNKNOWN_ID }))).toBe('23503');
  });
});

describe('customer price variant, security', () => {
  it('AB-1 crafted write: a variant of another business is rejected (23514)', async () => {
    expect(await captureSqlCode(insertPrice(PRICE_1, { variant: VARIANT_B }))).toBe('23514');
  });

  it('crafted write: moving a price to another business variant is rejected (23514)', async () => {
    await insertPrice(PRICE_1, { variant: VARIANT });
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          UPDATE customer_prices SET product_variant_id = ${VARIANT_B}::uuid WHERE id = ${PRICE_1}::uuid
        `
      )
    ).toBe('23514');
  });

  it('crafted write: a relationship supplied by a person holds no variant price (23514)', async () => {
    expect(
      await captureSqlCode(insertPrice(PRICE_3, { variant: VARIANT, relationship: REL_PERSON }))
    ).toBe('23514');
  });
});
