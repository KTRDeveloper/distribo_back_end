import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { simplifyText } from '../../../src/shared/variant';

const ORG = '0199c016-0000-7000-8000-0000000000a1';
const PRODUCT = '0199c016-0000-7000-8000-0000000000b1';
const FIRST = '0199c016-0000-7000-8000-0000000000c1';
const SECOND = '0199c016-0000-7000-8000-0000000000c2';

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
    DELETE FROM product_variants WHERE id IN (${FIRST}::uuid, ${SECOND}::uuid)
  `;
  await prisma.$executeRaw`DELETE FROM products WHERE id = ${PRODUCT}::uuid`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG}::uuid`;
}

function insertVariant(id: string, name: string | null, unit: string) {
  return prisma.$executeRaw`
    INSERT INTO product_variants (id, product_id, organization_id, name, unit, price)
    VALUES (${id}::uuid, ${PRODUCT}::uuid, ${ORG}::uuid, ${name}, ${unit}, 3000)
  `;
}

beforeEach(async () => {
  await cleanUp();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG}::uuid, 'Fixture Business')
  `;
  await prisma.$executeRaw`
    INSERT INTO products (id, organization_id, name)
    VALUES (${PRODUCT}::uuid, ${ORG}::uuid, 'Fixture Shirt')
  `;
});

afterAll(cleanUp);

describe('simplifyText agrees with the unique index of product variants', () => {
  // ASCII letters only: lower case of other letters depends on the collation.
  const texts: Array<string | null> = [
    null,
    '',
    ' ',
    'Sac 10 kg',
    'sac 10 kg',
    '  sac   10 kg ',
    'sac 10kg',
    '\tRiz\n\r',
    'riz',
    'RIZ',
    'a ',
    'a',
    ' a',
    'a \t b',
    'a b',
    'Rouge / L',
    'rouge  /  l',
  ];

  it('AC-3: the second insert fails with 23505 exactly when the simplified texts match', async () => {
    // Names and units are paired so each case varies the name or the unit in turn.
    const cases: Array<{ n1: string | null; u1: string; n2: string | null; u2: string }> = [];
    for (const a of texts) {
      for (const b of texts) {
        cases.push({ n1: a, u1: 'piece', n2: b, u2: 'piece' });
        cases.push({ n1: 'Rouge', u1: a ?? '', n2: 'rouge', u2: b ?? '' });
        cases.push({ n1: a, u1: a ?? '', n2: b, u2: b ?? '' });
        cases.push({ n1: a, u1: b ?? '', n2: b, u2: a ?? '' });
      }
    }
    const mismatches: unknown[] = [];
    for (const c of cases) {
      await cleanVariants();
      await insertVariant(FIRST, c.n1, c.u1);
      const code = await captureSqlCode(insertVariant(SECOND, c.n2, c.u2));
      const same =
        simplifyText(c.n1) === simplifyText(c.n2) && simplifyText(c.u1) === simplifyText(c.u2);
      if ((code === '23505') !== same || (code !== undefined && code !== '23505')) {
        mismatches.push({ ...c, code, same });
      }
    }
    expect(mismatches).toEqual([]);
  }, 120_000);

  it('AC-3: the rows of AC-2 give the same simplified text as the database', async () => {
    for (const text of texts) {
      const rows = await prisma.$queryRaw<Array<{ s: string }>>`
        SELECT lower(btrim(regexp_replace(coalesce(${text}::text, ''), '[ \t\r\n]+', ' ', 'g'))) AS s
      `;
      expect(simplifyText(text)).toBe(rows[0]?.s);
    }
  });
});

async function cleanVariants() {
  await prisma.$executeRaw`
    DELETE FROM product_variants WHERE id IN (${FIRST}::uuid, ${SECOND}::uuid)
  `;
}
