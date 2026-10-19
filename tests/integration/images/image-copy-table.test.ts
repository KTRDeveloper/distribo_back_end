import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const A = 'products/6f1c2a3e-4b5d-4c6e-8f70-81920a3b4c5d.webp';
const B = 'products/7a2d3b4f-5c6e-4d7f-9081-92a30b4c5d6e.webp';
const C = 'products/8b3e4c50-6d7f-4e80-a192-a3b41c5d6e7f.webp';
const D = 'products/9c4f5d61-7e80-4f91-b2a3-b4c52d6e7f80.webp';
const LOGO = 'logos/0d5a6e72-8f91-4aa2-83b4-c5d63e7f8091.webp';

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

/** Inserts a registry row as the application account. */
function insertCopy(copy: string | null, source: string | null, root: string | null) {
  return appPrisma.$executeRaw`
    INSERT INTO image_copies (copy_key, source_key, root_key)
    VALUES (${copy}, ${source}, ${root})
  `;
}

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('image_copies first copy (AC-1, C-56)', () => {
  it('stores a copy of an original with copied_at set to the insert time', async () => {
    await expect(insertCopy(B, A, A)).resolves.toBe(1);
    const rows = await appPrisma.$queryRaw<
      Array<{ copy_key: string; source_key: string; root_key: string; copied_at: Date }>
    >`SELECT copy_key, source_key, root_key, copied_at FROM image_copies WHERE copy_key = ${B}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ copy_key: B, source_key: A, root_key: A });
    expect(Math.abs(Date.now() - (rows[0]?.copied_at.getTime() ?? 0))).toBeLessThan(5_000);
  });
});

describe('image_copies copy of a copy (AC-2, C-56)', () => {
  it('returns B and C with one query on root A', async () => {
    await insertCopy(B, A, A);
    await expect(insertCopy(C, B, A)).resolves.toBe(1);
    const rows = await appPrisma.$queryRaw<Array<{ copy_key: string }>>`
      SELECT copy_key FROM image_copies WHERE root_key = ${A} ORDER BY copy_key
    `;
    expect(rows.map((r) => r.copy_key)).toEqual([B, C]);
  });
});

describe('image_copies wrong rows (AC-3, ImageCopy:required)', () => {
  it('refuses root B for a copy of the copy B with 23514', async () => {
    await insertCopy(B, A, A);
    expect(await captureSqlCode(insertCopy(C, B, B))).toBe('23514');
  });

  it('refuses root C for a copy of the original A with 23514', async () => {
    expect(await captureSqlCode(insertCopy(B, A, C))).toBe('23514');
  });

  it('refuses a copy equal to its source with 23514', async () => {
    expect(await captureSqlCode(insertCopy(A, A, A))).toBe('23514');
  });

  it('refuses a copy equal to its root with 23514', async () => {
    await insertCopy(B, A, A);
    expect(await captureSqlCode(insertCopy(A, B, A))).toBe('23514');
  });

  it('refuses a key under logos/ with 23514', async () => {
    expect(await captureSqlCode(insertCopy(B, LOGO, LOGO))).toBe('23514');
    expect(await captureSqlCode(insertCopy(LOGO, A, A))).toBe('23514');
  });

  it('refuses a null source, root or copy key with 23502', async () => {
    expect(await captureSqlCode(insertCopy(B, null, A))).toBe('23502');
    expect(await captureSqlCode(insertCopy(B, A, null))).toBe('23502');
    expect(await captureSqlCode(insertCopy(null, A, A))).toBe('23502');
  });

  it('refuses a copy_key that already exists with 23505', async () => {
    await insertCopy(B, A, A);
    expect(await captureSqlCode(insertCopy(B, A, A))).toBe('23505');
  });

  it('keeps a copy of a copy of a copy on the same root', async () => {
    await insertCopy(B, A, A);
    await insertCopy(C, B, A);
    expect(await captureSqlCode(insertCopy(D, C, C))).toBe('23514');
    await expect(insertCopy(D, C, A)).resolves.toBe(1);
  });
});

describe('image_copies insert only (AC-4, C-39)', () => {
  it('denies UPDATE, DELETE and TRUNCATE with 42501', async () => {
    await insertCopy(B, A, A);
    expect(
      await captureSqlCode(appPrisma.$executeRaw`UPDATE image_copies SET source_key = ${C}`)
    ).toBe('42501');
    expect(await captureSqlCode(appPrisma.$executeRaw`DELETE FROM image_copies`)).toBe('42501');
    expect(await captureSqlCode(appPrisma.$executeRaw`TRUNCATE TABLE image_copies`)).toBe(
      '42501'
    );
  });
});

describe('image_copies rewrite (AB-1, CWE-284)', () => {
  it('denies changing a root_key with 42501 and leaves the family unchanged', async () => {
    await insertCopy(B, A, A);
    await insertCopy(C, B, A);
    expect(
      await captureSqlCode(appPrisma.$executeRaw`
        UPDATE image_copies SET root_key = ${C} WHERE copy_key = ${B}
      `)
    ).toBe('42501');
    const rows = await prisma.$queryRaw<Array<{ copy_key: string }>>`
      SELECT copy_key FROM image_copies WHERE root_key = ${A} ORDER BY copy_key
    `;
    expect(rows.map((r) => r.copy_key)).toEqual([B, C]);
  });
});

describe('image_copies indexes', () => {
  it('has indexes on root_key and source_key', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'image_copies'
    `;
    expect(rows.some((r) => /\(root_key\)/.test(r.indexdef))).toBe(true);
    expect(rows.some((r) => /\(source_key\)/.test(r.indexdef))).toBe(true);
  });
});
