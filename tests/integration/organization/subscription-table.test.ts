import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const ORG_ID = '0199c012-0000-7000-8000-000000000001';
const SUB_1 = '0199c012-0000-7000-8000-0000000000a1';
const SUB_2 = '0199c012-0000-7000-8000-0000000000a2';
const UNKNOWN_ORG = '0199c012-0000-7000-8000-0000000000ff';

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
  await prisma.$executeRaw`DELETE FROM subscriptions WHERE organization_id = ${ORG_ID}::uuid`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`;
}

function insertSubscription(id: string, status: string, orgId: string = ORG_ID) {
  return prisma.$executeRaw`
    INSERT INTO subscriptions (id, organization_id, plan, status, starts_at, ends_at)
    VALUES (${id}::uuid, ${orgId}::uuid, 'BASIC', ${status}::text::public."SubscriptionStatus",
      '2026-01-01T00:00:00Z'::timestamptz, '2026-12-31T00:00:00Z'::timestamptz)
  `;
}

beforeEach(async () => {
  await cleanup();
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
  `;
});

afterAll(cleanup);

describe('subscriptions table', () => {
  it('stores a row and uses the expected column types', async () => {
    await expect(insertSubscription(SUB_1, 'ACTIVE')).resolves.toBe(1);

    const [row] = await prisma.$queryRaw<
      Array<{ plan: string; status: string; starts_at: Date; ends_at: Date }>
    >`
      SELECT plan, status::text AS status, starts_at, ends_at
      FROM subscriptions WHERE id = ${SUB_1}::uuid
    `;
    expect(row.plan).toBe('BASIC');
    expect(row.status).toBe('ACTIVE');
    expect(row.starts_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(row.ends_at.toISOString()).toBe('2026-12-31T00:00:00.000Z');

    const columns = await prisma.$queryRaw<
      Array<{ column_name: string; data_type: string; is_nullable: string }>
    >`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'subscriptions'
    `;
    const byName = Object.fromEntries(columns.map((column) => [column.column_name, column]));
    expect(byName.id?.data_type).toBe('uuid');
    expect(byName.organization_id?.data_type).toBe('uuid');
    for (const name of ['starts_at', 'ends_at']) {
      expect(byName[name]?.data_type).toBe('timestamp with time zone');
    }
    for (const name of ['organization_id', 'plan', 'status']) {
      expect(byName[name]?.is_nullable).toBe('NO');
    }
    expect(byName.server_updated_at).toBeUndefined();
    expect(byName.deleted_at).toBeUndefined();
  });

  it('accepts an ACTIVE subscription when the organization has none', async () => {
    await expect(insertSubscription(SUB_1, 'ACTIVE')).resolves.toBe(1);
  });

  it('rejects a second ACTIVE subscription with 23505', async () => {
    await insertSubscription(SUB_1, 'ACTIVE');
    expect(await captureSqlCode(insertSubscription(SUB_2, 'ACTIVE'))).toBe('23505');
  });

  it('accepts an ACTIVE subscription next to an EXPIRED one', async () => {
    await insertSubscription(SUB_1, 'EXPIRED');
    await expect(insertSubscription(SUB_2, 'ACTIVE')).resolves.toBe(1);
  });

  it('accepts an EXPIRED subscription next to an ACTIVE one', async () => {
    await insertSubscription(SUB_1, 'ACTIVE');
    await expect(insertSubscription(SUB_2, 'EXPIRED')).resolves.toBe(1);
  });

  it('rejects a null plan with 23502', async () => {
    const code = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO subscriptions (id, organization_id, plan, status)
        VALUES (${SUB_1}::uuid, ${ORG_ID}::uuid, NULL, 'ACTIVE'::public."SubscriptionStatus")
      `
    );
    expect(code).toBe('23502');
  });

  it('rejects the status PAUSED with 22P02', async () => {
    const code = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO subscriptions (id, organization_id, plan, status)
        VALUES (${SUB_1}::uuid, ${ORG_ID}::uuid, 'BASIC', 'PAUSED'::text::public."SubscriptionStatus")
      `
    );
    expect(code).toBe('22P02');
  });

  it('rejects an unknown organization with 23503', async () => {
    expect(await captureSqlCode(insertSubscription(SUB_1, 'ACTIVE', UNKNOWN_ORG))).toBe('23503');
  });
});
