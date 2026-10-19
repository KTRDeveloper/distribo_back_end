import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../setup';

const ORG_ID = '0199c022-0000-7000-8000-000000000001';
const OWNER_ID = '0199c022-0000-7000-8000-000000000011';
const MEMBER_ID = '0199c022-0000-7000-8000-000000000012';
const OWNER_COLLAB_ID = '0199c022-0000-7000-8000-000000000021';
const MEMBER_COLLAB_ID = '0199c022-0000-7000-8000-000000000022';

type Tx = Prisma.TransactionClient;
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

function insertCollaboration(
  tx: Tx,
  values: { id: string; personId: string; role: string; status: string }
): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO collaborations (id, person_id, organization_id, role, status)
    VALUES (
      ${values.id}::uuid, ${values.personId}::uuid, ${ORG_ID}::uuid,
      ${values.role}::text::public."CollaborationRole",
      ${values.status}::text::public."CollaborationStatus"
    )
  `;
}

const insertActiveOwner = (tx: Tx) =>
  insertCollaboration(tx, {
    id: OWNER_COLLAB_ID,
    personId: OWNER_ID,
    role: 'OWNER',
    status: 'ACTIVE',
  });

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700022011', ...registered },
      { id: MEMBER_ID, fullName: 'Fixture Member', phoneNumber: '+2250700022012', ...registered },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
  `;
});

describe('paused collaborations', () => {
  it.each([
    { role: 'MANAGER', status: 'PAUSED', result: undefined },
    { role: 'SELLER', status: 'PAUSED', result: undefined },
    { role: 'OWNER', status: 'PAUSED', result: '23514' },
    { role: 'OWNER', status: 'ACTIVE', result: undefined },
  ])('role $role with status $status: $result', async ({ role, status, result }) => {
    const code = await captureSqlCode(
      prisma.$transaction(async (tx) => {
        if (role === 'OWNER') {
          return insertCollaboration(tx, {
            id: OWNER_COLLAB_ID,
            personId: OWNER_ID,
            role,
            status,
          });
        }
        await insertActiveOwner(tx);
        return insertCollaboration(tx, { id: MEMBER_COLLAB_ID, personId: MEMBER_ID, role, status });
      })
    );
    expect(code).toBe(result);
  });

  it('refuses to update an ACTIVE owner to PAUSED with 23514', async () => {
    await prisma.$transaction(insertActiveOwner);
    const code = await captureSqlCode(
      prisma.$executeRaw`
        UPDATE collaborations SET status = 'PAUSED' WHERE id = ${OWNER_COLLAB_ID}::uuid
      `
    );
    expect(code).toBe('23514');
    const [row] = await prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM collaborations WHERE id = ${OWNER_COLLAB_ID}::uuid
    `;
    expect(row.status).toBe('ACTIVE');
  });

  it('keeps exactly one ACTIVE owner when a manager is paused', async () => {
    await prisma.$transaction(async (tx) => {
      await insertActiveOwner(tx);
      await insertCollaboration(tx, {
        id: MEMBER_COLLAB_ID,
        personId: MEMBER_ID,
        role: 'MANAGER',
        status: 'PAUSED',
      });
    });
    const [row] = await prisma.$queryRaw<Array<{ owners: bigint; paused: bigint }>>`
      SELECT
        count(*) FILTER (WHERE role = 'OWNER' AND status = 'ACTIVE') AS owners,
        count(*) FILTER (WHERE status = 'PAUSED') AS paused
      FROM collaborations WHERE organization_id = ${ORG_ID}::uuid
    `;
    expect(row.owners).toBe(1n);
    expect(row.paused).toBe(1n);
  });

  it('lets an ACTIVE manager be paused and restored by update', async () => {
    await prisma.$transaction(async (tx) => {
      await insertActiveOwner(tx);
      await insertCollaboration(tx, {
        id: MEMBER_COLLAB_ID,
        personId: MEMBER_ID,
        role: 'MANAGER',
        status: 'ACTIVE',
      });
    });
    await expect(
      prisma.$executeRaw`
        UPDATE collaborations SET status = 'PAUSED' WHERE id = ${MEMBER_COLLAB_ID}::uuid
      `
    ).resolves.toBe(1);
    await expect(
      prisma.$executeRaw`
        UPDATE collaborations SET status = 'ACTIVE' WHERE id = ${MEMBER_COLLAB_ID}::uuid
      `
    ).resolves.toBe(1);
  });
});
