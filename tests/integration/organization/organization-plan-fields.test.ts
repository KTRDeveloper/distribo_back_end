import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const ORG_A = '0199c020-0000-7000-8000-000000000001';
const ORG_B = '0199c020-0000-7000-8000-000000000002';
const IDS = [ORG_A, ORG_B];
const ALPHABET = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

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

async function cleanup(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ANY(${IDS}::uuid[])`;
}

beforeEach(cleanup);
afterAll(cleanup);

describe('organizations plan fields', () => {
  it('applies defaults and generates a payment code (AC-1)', async () => {
    await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_A}::uuid, 'Fixture A')`;
    const [row] = await prisma.$queryRaw<
      Array<{
        plan: string;
        max_collaborators: number | null;
        max_products: number | null;
        plan_ends_at: Date | null;
        grace_ends_at: Date | null;
        logo_key: string | null;
        payment_code: string;
      }>
    >`
      SELECT plan::text AS plan, max_collaborators, max_products, plan_ends_at,
             grace_ends_at, logo_key, payment_code
      FROM organizations WHERE id = ${ORG_A}::uuid
    `;
    expect(row).toMatchObject({
      plan: 'FREE',
      max_collaborators: 2,
      max_products: 30,
      plan_ends_at: null,
      grace_ends_at: null,
      logo_key: null,
    });
    expect(row.payment_code).toMatch(ALPHABET);
  });

  it('gives each row its own code (AC-2)', async () => {
    await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_A}::uuid, 'Fixture A')`;
    await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_B}::uuid, 'Fixture B')`;
    const rows = await prisma.$queryRaw<Array<{ payment_code: string }>>`
      SELECT payment_code FROM organizations WHERE id = ANY(${IDS}::uuid[])
    `;
    expect(rows).toHaveLength(2);
    expect(rows[0].payment_code).not.toBe(rows[1].payment_code);
  });

  it('generates codes only from the allowed alphabet', async () => {
    const rows = await prisma.$queryRaw<Array<{ code: string }>>`
      SELECT organization_payment_code() AS code FROM generate_series(1, 200)
    `;
    expect(rows).toHaveLength(200);
    for (const { code } of rows) expect(code).toMatch(ALPHABET);
  });

  describe('plan rules (AC-3)', () => {
    const endsAt = new Date('2030-01-10T00:00:00Z');
    const earlier = new Date('2030-01-05T00:00:00Z');

    it('accepts ESSENTIAL with plan_ends_at set', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO organizations (id, name, plan, plan_ends_at)
          VALUES (${ORG_A}::uuid, 'F', 'ESSENTIAL', ${endsAt})
        `,
      );
      expect(code).toBeUndefined();
    });

    it('rejects ESSENTIAL without plan_ends_at', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO organizations (id, name, plan) VALUES (${ORG_A}::uuid, 'F', 'ESSENTIAL')
        `,
      );
      expect(code).toBe('23514');
    });

    it('rejects FREE with plan_ends_at set', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO organizations (id, name, plan, plan_ends_at)
          VALUES (${ORG_A}::uuid, 'F', 'FREE', ${endsAt})
        `,
      );
      expect(code).toBe('23514');
    });

    it('rejects grace_ends_at before plan_ends_at', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO organizations (id, name, plan, plan_ends_at, grace_ends_at)
          VALUES (${ORG_A}::uuid, 'F', 'PRO', ${endsAt}, ${earlier})
        `,
      );
      expect(code).toBe('23514');
    });

    it('rejects grace_ends_at without plan_ends_at', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO organizations (id, name, grace_ends_at) VALUES (${ORG_A}::uuid, 'F', ${endsAt})
        `,
      );
      expect(code).toBe('23514');
    });

    it('accepts grace_ends_at after plan_ends_at', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO organizations (id, name, plan, plan_ends_at, grace_ends_at)
          VALUES (${ORG_A}::uuid, 'F', 'PRO', ${earlier}, ${endsAt})
        `,
      );
      expect(code).toBeUndefined();
    });

    it('rejects a negative max_collaborators', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO organizations (id, name, max_collaborators) VALUES (${ORG_A}::uuid, 'F', -1)
        `,
      );
      expect(code).toBe('23514');
    });

    it('rejects a negative max_products', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO organizations (id, name, max_products) VALUES (${ORG_A}::uuid, 'F', -1)
        `,
      );
      expect(code).toBe('23514');
    });

    it('accepts empty limits (no limit)', async () => {
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO organizations (id, name, max_collaborators, max_products)
          VALUES (${ORG_A}::uuid, 'F', NULL, NULL)
        `,
      );
      expect(code).toBeUndefined();
    });

    it('rejects an unknown plan', async () => {
      const code = await captureSqlCode(
        prisma.$executeRawUnsafe(
          `INSERT INTO organizations (id, name, plan) VALUES ('${ORG_A}'::uuid, 'F', 'GOLD')`,
        ),
      );
      expect(code).toBe('22P02');
    });
  });

  it('rejects a duplicate payment_code (AC-4)', async () => {
    await prisma.$executeRaw`
      INSERT INTO organizations (id, name, payment_code) VALUES (${ORG_A}::uuid, 'A', 'ABCD2345')
    `;
    const code = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO organizations (id, name, payment_code) VALUES (${ORG_B}::uuid, 'B', 'ABCD2345')
      `,
    );
    expect(code).toBe('23505');
  });

  it('rejects a duplicate logo_key but allows many empty ones (AC-5)', async () => {
    await prisma.$executeRaw`
      INSERT INTO organizations (id, name, logo_key) VALUES (${ORG_A}::uuid, 'A', 'logos/one.png')
    `;
    const code = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO organizations (id, name, logo_key) VALUES (${ORG_B}::uuid, 'B', 'logos/one.png')
      `,
    );
    expect(code).toBe('23505');

    await cleanup();
    await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_A}::uuid, 'A')`;
    const second = await captureSqlCode(
      prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_B}::uuid, 'B')`,
    );
    expect(second).toBeUndefined();
  });

  it('rejects a raw update to PRO without plan_ends_at (AB-1)', async () => {
    await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_A}::uuid, 'A')`;
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE organizations SET plan = 'PRO' WHERE id = ${ORG_A}::uuid`,
    );
    expect(code).toBe('23514');
  });
});
