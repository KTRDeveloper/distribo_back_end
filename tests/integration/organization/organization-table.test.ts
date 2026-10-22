import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const ORG_ID = '0199c001-0000-7000-8000-000000000001';

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

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`;
});

describe('organizations table', () => {
  it('applies defaults and uses the expected column types', async () => {
    await prisma.$executeRaw`
      INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
    `;

    const [row] = await prisma.$queryRaw<
      Array<{
        status: string;
        description: string | null;
        created_at: Date;
        server_updated_at: Date;
        deleted_at: Date | null;
      }>
    >`
      SELECT status::text AS status, description, created_at, server_updated_at, deleted_at
      FROM organizations WHERE id = ${ORG_ID}::uuid
    `;
    expect(row).toMatchObject({
      status: 'ACTIVE',
      description: null,
      deleted_at: null,
    });
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.server_updated_at).toBeInstanceOf(Date);

    const columns = await prisma.$queryRaw<
      Array<{ column_name: string; data_type: string; is_nullable: string }>
    >`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'organizations'
    `;
    const byName = Object.fromEntries(columns.map((column) => [column.column_name, column]));
    expect(byName.id?.data_type).toBe('uuid');
    for (const name of ['created_at', 'server_updated_at', 'deleted_at']) {
      expect(byName[name]?.data_type).toBe('timestamp with time zone');
    }
    for (const name of ['name', 'status', 'created_at']) {
      expect(byName[name]?.is_nullable).toBe('NO');
    }
    for (const name of ['description', 'deleted_at']) {
      expect(byName[name]?.is_nullable).toBe('YES');
    }
  });

  it('rejects a null name with 23502', async () => {
    const code = await captureSqlCode(
      prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, NULL)`
    );
    expect(code).toBe('23502');
  });

  it.each(['SUSPENDED', 'CLOSED'])('accepts status %s', async (status) => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO organizations (id, name, status)
        VALUES (${ORG_ID}::uuid, 'Fixture Business', ${status}::text::public."OrganizationStatus")
      `
    ).resolves.toBe(1);
  });

  it('rejects status DELETED with 22P02', async () => {
    const code = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO organizations (id, name, status)
        VALUES (${ORG_ID}::uuid, 'Fixture Business', 'DELETED'::text::public."OrganizationStatus")
      `
    );
    expect(code).toBe('22P02');
  });

  it('moves server_updated_at forward on update', async () => {
    await prisma.$executeRaw`
      INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
    `;
    const read = () =>
      prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
        SELECT server_updated_at FROM organizations WHERE id = ${ORG_ID}::uuid
      `;
    const [before] = await read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await prisma.$executeRaw`UPDATE organizations SET name = 'Renamed' WHERE id = ${ORG_ID}::uuid`;
    const [after] = await read();
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
  });
});
