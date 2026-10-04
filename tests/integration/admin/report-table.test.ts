import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const REPORTER_ID = '0199d003-0000-7000-8000-000000000001';
const GUEST_ID = '0199d003-0000-7000-8000-000000000002';
const TARGET_ID = '0199d003-0000-7000-8000-000000000003';
const ADMIN_PERSON_ID = '0199d003-0000-7000-8000-000000000004';
const ORG_ID = '0199d003-0000-7000-8000-000000000005';
const ADMIN_ID = '0199d003-0000-7000-8000-000000000011';
const UNKNOWN_ID = '0199d003-0000-7000-8000-0000000000ff';
const REPORT_ID = '0199d003-0000-7000-8000-000000000021';
const ACTION_ID = '0199d003-0000-7000-8000-000000000031';

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

type Row = {
  id?: string;
  reporterId?: string | null;
  person?: string | null;
  organization?: string | null;
  reason?: string | null;
  description?: string | null;
  status?: string | null;
  decision?: string | null;
  resolvedBy?: string | null;
};

/** Inserts a report as one auto-committed statement; defaults describe a report of a person. */
function insertReport(row: Row = {}): Promise<number> {
  const has = <K extends keyof Row>(key: K, fallback: Row[K]): Row[K] =>
    key in row ? row[key] : fallback;
  const status = has('status', 'PENDING');
  const decision = has('decision', null);
  return prisma.$executeRaw`
    INSERT INTO reports (
      id, reporter_id, target_person_id, target_organization_id, reason, description,
      status, decision, resolved_by_id
    ) VALUES (
      ${row.id ?? REPORT_ID}::uuid, ${has('reporterId', REPORTER_ID)}::uuid,
      ${has('person', TARGET_ID)}::uuid, ${has('organization', null)}::uuid,
      ${has('reason', 'abus')}, ${has('description', 'details')},
      ${status}::text::public."ReportStatus", ${decision}::text::public."ReportDecision",
      ${has('resolvedBy', null)}::uuid
    )
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
      {
        id: REPORTER_ID,
        fullName: 'Fixture Reporter',
        phoneNumber: '+2250700016001',
        ...registered,
      },
      { id: TARGET_ID, fullName: 'Fixture Target', phoneNumber: '+2250700016002', ...registered },
      {
        id: ADMIN_PERSON_ID,
        fullName: 'Fixture Admin',
        phoneNumber: '+2250700016003',
        ...registered,
      },
      { id: GUEST_ID, phoneNumber: '+2250700016004' },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Organization')
  `;
  await prisma.$executeRaw`
    INSERT INTO administrators (id, person_id, role, totp_secret)
    VALUES (${ADMIN_ID}::uuid, ${ADMIN_PERSON_ID}::uuid, 'MODERATOR', 'encrypted-secret')
  `;
});

describe('reports insert rules (AC-1, C-28, C-04)', () => {
  it('accepts a registered reporter and a person target', async () => {
    await expect(insertReport()).resolves.toBe(1);
  });

  it('accepts a registered reporter and an organization target', async () => {
    await expect(insertReport({ person: null, organization: ORG_ID })).resolves.toBe(1);
  });

  it('rejects both targets with 23514', async () => {
    expect(await captureSqlCode(insertReport({ organization: ORG_ID }))).toBe('23514');
  });

  it('rejects no target with 23514', async () => {
    expect(await captureSqlCode(insertReport({ person: null }))).toBe('23514');
  });

  it('rejects a guest reporter with 23514', async () => {
    expect(await captureSqlCode(insertReport({ reporterId: GUEST_ID }))).toBe('23514');
  });

  it('rejects the status OPEN', async () => {
    expect(await captureSqlCode(insertReport({ status: 'OPEN' }))).toBeDefined();
  });

  it('rejects the decision BAN', async () => {
    expect(await captureSqlCode(insertReport({ decision: 'BAN' }))).toBeDefined();
  });

  it('accepts the decisions DISMISSED and SUSPENSION', async () => {
    await expect(
      insertReport({ status: 'RESOLVED', decision: 'DISMISSED', resolvedBy: ADMIN_ID })
    ).resolves.toBe(1);
    await expect(
      insertReport({
        id: '0199d003-0000-7000-8000-000000000022',
        status: 'RESOLVED',
        decision: 'SUSPENSION',
        resolvedBy: ADMIN_ID,
      })
    ).resolves.toBe(1);
  });

  it('rejects a missing reporter, reason, description or status with 23502', async () => {
    expect(await captureSqlCode(insertReport({ reporterId: null }))).toBe('23502');
    expect(await captureSqlCode(insertReport({ reason: null }))).toBe('23502');
    expect(await captureSqlCode(insertReport({ description: null }))).toBe('23502');
    expect(await captureSqlCode(insertReport({ status: null }))).toBe('23502');
  });
});

describe('reports defaults and keys (AC-2, Report:fk)', () => {
  it('starts PENDING with reported_at and server_updated_at set and no resolution', async () => {
    await prisma.$executeRaw`
      INSERT INTO reports (id, reporter_id, target_person_id, reason, description)
      VALUES (${REPORT_ID}::uuid, ${REPORTER_ID}::uuid, ${TARGET_ID}::uuid, 'abus', 'details')
    `;
    const rows = await prisma.$queryRaw<
      Array<{
        status: string;
        reported_at: Date;
        resolved_at: Date | null;
        server_updated_at: Date;
        decision: string | null;
        resolved_by_id: string | null;
      }>
    >`SELECT status::text AS status, reported_at, resolved_at, server_updated_at,
             decision::text AS decision, resolved_by_id::text AS resolved_by_id
      FROM reports`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('PENDING');
    expect(Math.abs(Date.now() - (rows[0]?.reported_at.getTime() ?? 0))).toBeLessThan(5_000);
    expect(Math.abs(Date.now() - (rows[0]?.server_updated_at.getTime() ?? 0))).toBeLessThan(5_000);
    expect(rows[0]?.resolved_at).toBeNull();
    expect(rows[0]?.decision).toBeNull();
    expect(rows[0]?.resolved_by_id).toBeNull();
  });

  it('refreshes server_updated_at on update', async () => {
    await insertReport();
    await prisma.$executeRaw`
      UPDATE reports SET server_updated_at = '2020-01-01T00:00:00Z' WHERE id = ${REPORT_ID}::uuid
    `;
    const rows = await prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
      SELECT server_updated_at FROM reports WHERE id = ${REPORT_ID}::uuid
    `;
    expect(rows[0]?.server_updated_at.getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it('accepts resolved_by_id only for an existing administrator', async () => {
    await expect(insertReport({ resolvedBy: ADMIN_ID })).resolves.toBe(1);
    expect(
      await captureSqlCode(
        insertReport({ id: '0199d003-0000-7000-8000-000000000022', resolvedBy: UNKNOWN_ID })
      )
    ).toBe('23503');
    // A registered person who is not an administrator is not accepted either.
    expect(
      await captureSqlCode(
        insertReport({ id: '0199d003-0000-7000-8000-000000000023', resolvedBy: TARGET_ID })
      )
    ).toBe('23503');
  });

  it('rejects an unknown reporter, person target or organization target with 23503', async () => {
    expect(await captureSqlCode(insertReport({ reporterId: UNKNOWN_ID }))).toBe('23503');
    expect(await captureSqlCode(insertReport({ person: UNKNOWN_ID }))).toBe('23503');
    expect(await captureSqlCode(insertReport({ person: null, organization: UNKNOWN_ID }))).toBe(
      '23503'
    );
  });

  it('lets admin_actions.report_id reference only an existing report', async () => {
    const insertAction = (reportId: string) => prisma.$executeRaw`
      INSERT INTO admin_actions (id, administrator_id, action, target_person_id, report_id, reason)
      VALUES (${ACTION_ID}::uuid, ${ADMIN_ID}::uuid, 'DISMISS_REPORT', ${TARGET_ID}::uuid,
              ${reportId}::uuid, 'sans suite')
    `;
    expect(await captureSqlCode(insertAction(UNKNOWN_ID))).toBe('23503');
    await insertReport();
    await expect(insertAction(REPORT_ID)).resolves.toBe(1);
  });
});

describe('reports tampering (AB-1, CWE-20)', () => {
  it('refuses two targets written by a crafted statement and stores nothing', async () => {
    expect(
      await captureSqlCode(
        prisma.$executeRawUnsafe(
          `INSERT INTO reports (id, reporter_id, target_person_id, target_organization_id, reason, description)
         VALUES ('${REPORT_ID}', '${REPORTER_ID}', '${TARGET_ID}', '${ORG_ID}', 'abus', 'details')`
        )
      )
    ).toBe('23514');
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM reports`;
    expect(rows).toEqual([]);
  });

  it('refuses an update that adds a second target', async () => {
    await insertReport();
    expect(
      await captureSqlCode(prisma.$executeRaw`
        UPDATE reports SET target_organization_id = ${ORG_ID}::uuid WHERE id = ${REPORT_ID}::uuid
      `)
    ).toBe('23514');
  });
});
