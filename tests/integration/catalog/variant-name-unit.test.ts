import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const ORG = '0199c018-0000-7000-8000-0000000000a1';
const PRODUCT = '0199c018-0000-7000-8000-0000000000b1';
const OTHER_PRODUCT = '0199c018-0000-7000-8000-0000000000b2';
const FIRST = '0199c018-0000-7000-8000-0000000000c1';
const SECOND = '0199c018-0000-7000-8000-0000000000c2';
const THIRD = '0199c018-0000-7000-8000-0000000000c3';

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
    return sqlCode(error);
  }
  return undefined;
}

async function cleanUp() {
  await prisma.$executeRaw`
    UPDATE product_variants SET merged_into_id = NULL
    WHERE id IN (${FIRST}::uuid, ${SECOND}::uuid, ${THIRD}::uuid)
  `;
  await prisma.$executeRaw`
    DELETE FROM product_variants WHERE id IN (${FIRST}::uuid, ${SECOND}::uuid, ${THIRD}::uuid)
  `;
  await prisma.$executeRaw`
    DELETE FROM products WHERE id IN (${PRODUCT}::uuid, ${OTHER_PRODUCT}::uuid)
  `;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG}::uuid`;
}

function insertVariant(id: string, product: string, name: string | null, unit: string) {
  return prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price)
    VALUES (${id}::uuid, ${product}::uuid, ${ORG}::uuid, ${name}, ${unit}, 3000)
  `;
}

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG}::uuid, 'Fixture Business')
  `;
  // An empty unit marks a new-style product: no variant is mirrored from it (CAT-014).
  for (const id of [PRODUCT, OTHER_PRODUCT]) {
    await prisma.$executeRaw`
      INSERT INTO products (id, organization_id, name, unit, price)
      VALUES (${id}::uuid, ${ORG}::uuid, 'Fixture Shirt', '', 3000)
    `;
  }
});

afterAll(cleanUp);

describe('product variants: one name and unit per product', () => {
  const rows: Array<{
    n1: string | null;
    u1: string;
    product: string;
    n2: string | null;
    u2: string;
    code: string | undefined;
  }> = [
    { n1: null, u1: 'sac 10 kg', product: PRODUCT, n2: null, u2: 'Sac  10 kg', code: '23505' },
    { n1: 'Rouge / L', u1: 'piece', product: PRODUCT, n2: 'rouge / l', u2: 'PIECE', code: '23505' },
    { n1: null, u1: 'sac 10 kg', product: PRODUCT, n2: null, u2: 'sac 10kg', code: undefined },
    {
      n1: 'Rouge / L',
      u1: 'piece',
      product: PRODUCT,
      n2: 'Bleu / M',
      u2: 'piece',
      code: undefined,
    },
    {
      n1: 'Rouge / L',
      u1: 'piece',
      product: OTHER_PRODUCT,
      n2: 'Rouge / L',
      u2: 'piece',
      code: undefined,
    },
    { n1: null, u1: 'piece', product: PRODUCT, n2: '', u2: 'piece', code: '23505' },
    {
      n1: ' Rouge\t/  L ',
      u1: 'piece',
      product: PRODUCT,
      n2: 'rouge / l',
      u2: 'piece',
      code: '23505',
    },
  ];

  it.each(rows)(
    'name $n1 unit $u1 then $n2 unit $u2 on $product -> $code',
    async ({ n1, u1, product, n2, u2, code }) => {
      await insertVariant(FIRST, PRODUCT, n1, u1);
      expect(await captureSqlCode(insertVariant(SECOND, product, n2, u2))).toBe(code);
    }
  );

  it('rejects an update that makes two live variants look alike', async () => {
    await insertVariant(FIRST, PRODUCT, 'Rouge / L', 'piece');
    await insertVariant(SECOND, PRODUCT, 'Bleu / M', 'piece');
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE product_variants SET name = 'ROUGE / l' WHERE id = ${SECOND}::uuid`
    );
    expect(code).toBe('23505');
  });

  it('lets a deleted variant free its name and unit', async () => {
    await insertVariant(FIRST, PRODUCT, 'Rouge / L', 'piece');
    await prisma.$executeRaw`UPDATE product_variants SET deleted_at = now() WHERE id = ${FIRST}::uuid`;
    expect(await captureSqlCode(insertVariant(SECOND, PRODUCT, 'Rouge / L', 'piece'))).toBe(
      undefined
    );
  });

  it('allows several deleted variants with the same name and unit', async () => {
    await insertVariant(FIRST, PRODUCT, 'Rouge / L', 'piece');
    await prisma.$executeRaw`UPDATE product_variants SET deleted_at = now() WHERE id = ${FIRST}::uuid`;
    await insertVariant(SECOND, PRODUCT, 'Rouge / L', 'piece');
    expect(
      await captureSqlCode(
        prisma.$executeRaw`UPDATE product_variants SET deleted_at = now() WHERE id = ${SECOND}::uuid`
      )
    ).toBe(undefined);
  });
});

describe('product variants: a merged variant is deleted', () => {
  beforeEach(async () => {
    await insertVariant(FIRST, PRODUCT, 'Rouge / L', 'piece');
  });

  it('accepts merged_into_id set with deleted_at set', async () => {
    const code = await captureSqlCode(prisma.$executeRaw`
      INSERT INTO product_variants
        (id, product_id, organization_id, name, unit, price, deleted_at, merged_into_id)
      VALUES (${SECOND}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Bleu / M', 'piece', 3000, now(),
        ${FIRST}::uuid)
    `);
    expect(code).toBe(undefined);
  });

  it('rejects merged_into_id set with deleted_at empty (23514)', async () => {
    const code = await captureSqlCode(prisma.$executeRaw`
      INSERT INTO product_variants
        (id, product_id, organization_id, name, unit, price, merged_into_id)
      VALUES (${SECOND}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Bleu / M', 'piece', 3000,
        ${FIRST}::uuid)
    `);
    expect(code).toBe('23514');
  });

  it('accepts merged_into_id empty with deleted_at empty', async () => {
    expect(await captureSqlCode(insertVariant(SECOND, PRODUCT, 'Bleu / M', 'piece'))).toBe(
      undefined
    );
  });

  it('rejects pointing a live variant at another without deleting it (23514)', async () => {
    await insertVariant(SECOND, PRODUCT, 'Bleu / M', 'piece');
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE product_variants SET merged_into_id = ${FIRST}::uuid WHERE id = ${SECOND}::uuid`
    );
    expect(code).toBe('23514');
  });

  it('rejects undeleting a merged variant (23514)', async () => {
    await prisma.$executeRaw`
      INSERT INTO product_variants
        (id, product_id, organization_id, name, unit, price, deleted_at, merged_into_id)
      VALUES (${SECOND}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, 'Bleu / M', 'piece', 3000, now(),
        ${FIRST}::uuid)
    `;
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE product_variants SET deleted_at = NULL WHERE id = ${SECOND}::uuid`
    );
    expect(code).toBe('23514');
  });
});

describe('product variants: concurrent writes (AB-1)', () => {
  it('lets exactly one of two parallel inserts of the same name and unit succeed', async () => {
    const codes = await Promise.all([
      captureSqlCode(insertVariant(FIRST, PRODUCT, 'Rouge / L', 'piece')),
      captureSqlCode(insertVariant(SECOND, PRODUCT, 'ROUGE / L', 'Piece')),
    ]);
    expect(codes.filter((code) => code === '23505')).toHaveLength(1);
    expect(codes.filter((code) => code === undefined)).toHaveLength(1);
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM product_variants
      WHERE product_id = ${PRODUCT}::uuid AND id IN (${FIRST}::uuid, ${SECOND}::uuid)
    `;
    expect(Number(count)).toBe(1);
  });
});
