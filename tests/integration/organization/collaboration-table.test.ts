import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../setup';
import { expectColumnType } from '../../helpers/db-schema';

const ORG_ID = '0199c003-0000-7000-8000-000000000001';
const OWNER_ID = '0199c003-0000-7000-8000-000000000011';
const MEMBER_ID = '0199c003-0000-7000-8000-000000000012';
const GUEST_ID = '0199c003-0000-7000-8000-000000000013';
const NO_NUMBER_ID = '0199c003-0000-7000-8000-000000000014';
const OWNER_COLLAB_ID = '0199c003-0000-7000-8000-000000000021';
const MEMBER_COLLAB_ID = '0199c003-0000-7000-8000-000000000022';

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

async function insertCollaboration(
  tx: Tx,
  values: {
    id: string;
    personId: string;
    role: string;
    status: string;
  }
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700003011', ...registered },
      { id: MEMBER_ID, fullName: 'Fixture Member', phoneNumber: '+2250700003012', ...registered },
      { id: GUEST_ID, phoneNumber: '+2250700003013' },
      {
        id: NO_NUMBER_ID,
        fullName: 'Fixture Released',
        releasedPhoneNumber: '+2250700003014',
        ...registered,
        phoneVerifiedAt: null,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')
  `;
});

describe('collaborations table rules', () => {
  it('rejects a second row for the same person and organization with 23505', async () => {
    const code = await captureSqlCode(
      prisma.$transaction(async (tx) => {
        await insertActiveOwner(tx);
        await insertCollaboration(tx, {
          id: MEMBER_COLLAB_ID,
          personId: OWNER_ID,
          role: 'MANAGER',
          status: 'ACTIVE',
        });
      })
    );
    expect(code).toBe('23505');
  });

  it('rejects status ACTIVE for a guest with 23514', async () => {
    const code = await captureSqlCode(
      prisma.$transaction(async (tx) => {
        await insertActiveOwner(tx);
        await insertCollaboration(tx, {
          id: MEMBER_COLLAB_ID,
          personId: GUEST_ID,
          role: 'SELLER',
          status: 'ACTIVE',
        });
      })
    );
    expect(code).toBe('23514');
  });

  it('accepts status INVITED for a guest', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await insertActiveOwner(tx);
        return insertCollaboration(tx, {
          id: MEMBER_COLLAB_ID,
          personId: GUEST_ID,
          role: 'SELLER',
          status: 'INVITED',
        });
      })
    ).resolves.toBe(1);
  });

  it('refuses to promote an INVITED guest to ACTIVE with 23514', async () => {
    await prisma.$transaction(async (tx) => {
      await insertActiveOwner(tx);
      await insertCollaboration(tx, {
        id: MEMBER_COLLAB_ID,
        personId: GUEST_ID,
        role: 'SELLER',
        status: 'INVITED',
      });
    });
    const code = await captureSqlCode(
      prisma.$executeRaw`
        UPDATE collaborations SET status = 'ACTIVE' WHERE id = ${MEMBER_COLLAB_ID}::uuid
      `
    );
    expect(code).toBe('23514');
  });

  it('rejects role BOSS with 22P02', async () => {
    const code = await captureSqlCode(
      prisma.$transaction(async (tx) => {
        await insertCollaboration(tx, {
          id: OWNER_COLLAB_ID,
          personId: OWNER_ID,
          role: 'BOSS',
          status: 'ACTIVE',
        });
      })
    );
    expect(code).toBe('22P02');
  });

  it('rejects status SUSPENDED with 22P02', async () => {
    const code = await captureSqlCode(
      prisma.$transaction(async (tx) => {
        await insertCollaboration(tx, {
          id: OWNER_COLLAB_ID,
          personId: OWNER_ID,
          role: 'OWNER',
          status: 'SUSPENDED',
        });
      })
    );
    expect(code).toBe('22P02');
  });

  it('rejects null required columns with 23502', async () => {
    for (const column of ['person_id', 'organization_id', 'role', 'status']) {
      const values: Record<string, string | null> = {
        person_id: OWNER_ID,
        organization_id: ORG_ID,
        role: 'OWNER',
        status: 'ACTIVE',
      };
      values[column] = null;
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO collaborations (id, person_id, organization_id, role, status)
          VALUES (
            ${OWNER_COLLAB_ID}::uuid, ${values.person_id}::uuid, ${values.organization_id}::uuid,
            ${values.role}::text::public."CollaborationRole",
            ${values.status}::text::public."CollaborationStatus"
          )
        `
      );
      expect(code, column).toBe('23502');
    }
  });

  it('rejects unknown person and organization with 23503', async () => {
    const unknown = '0199c003-0000-7000-8000-0000000009ff';
    const unknownPerson = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO collaborations (id, person_id, organization_id, role, status)
        VALUES (${OWNER_COLLAB_ID}::uuid, ${unknown}::uuid, ${ORG_ID}::uuid, 'OWNER', 'INVITED')
      `
    );
    expect(unknownPerson).toBe('23503');
    const unknownOrg = await captureSqlCode(
      prisma.$executeRaw`
        INSERT INTO collaborations (id, person_id, organization_id, role, status)
        VALUES (${OWNER_COLLAB_ID}::uuid, ${OWNER_ID}::uuid, ${unknown}::uuid, 'OWNER', 'INVITED')
      `
    );
    expect(unknownOrg).toBe('23503');
  });
});

describe('exactly one ACTIVE OWNER', () => {
  const seedOwnerAndManager = () =>
    prisma.$transaction(async (tx) => {
      await insertActiveOwner(tx);
      await insertCollaboration(tx, {
        id: MEMBER_COLLAB_ID,
        personId: MEMBER_ID,
        role: 'MANAGER',
        status: 'ACTIVE',
      });
    });

  it('refuses a second ACTIVE OWNER', async () => {
    await seedOwnerAndManager();
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE collaborations SET role = 'OWNER' WHERE id = ${MEMBER_COLLAB_ID}::uuid`
    );
    expect(code).toBe('23505');
  });

  it('refuses to commit when the only OWNER row becomes MANAGER', async () => {
    await seedOwnerAndManager();
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE collaborations SET role = 'MANAGER' WHERE id = ${OWNER_COLLAB_ID}::uuid`
    );
    expect(code).toBeDefined();
    const [row] = await prisma.$queryRaw<Array<{ role: string }>>`
      SELECT role::text AS role FROM collaborations WHERE id = ${OWNER_COLLAB_ID}::uuid
    `;
    expect(row.role).toBe('OWNER');
  });

  it('refuses to commit an organization whose first collaboration is not an ACTIVE OWNER', async () => {
    const code = await captureSqlCode(
      prisma.$transaction(async (tx) => {
        await insertCollaboration(tx, {
          id: MEMBER_COLLAB_ID,
          personId: MEMBER_ID,
          role: 'MANAGER',
          status: 'ACTIVE',
        });
      })
    );
    expect(code).toBeDefined();
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM collaborations WHERE organization_id = ${ORG_ID}::uuid
    `;
    expect(count).toBe(0n);
  });

  it('refuses to delete the OWNER row while other collaborations remain', async () => {
    await seedOwnerAndManager();
    const code = await captureSqlCode(
      prisma.$executeRaw`DELETE FROM collaborations WHERE id = ${OWNER_COLLAB_ID}::uuid`
    );
    expect(code).toBeDefined();
  });

  it('refuses to move the OWNER row to another organization while others remain', async () => {
    await seedOwnerAndManager();
    const otherOrg = '0199c003-0000-7000-8000-000000000002';
    await prisma.$executeRaw`INSERT INTO organizations (id, name) VALUES (${otherOrg}::uuid, 'Other')`;
    const code = await captureSqlCode(
      prisma.$executeRaw`
        UPDATE collaborations SET organization_id = ${otherOrg}::uuid WHERE id = ${OWNER_COLLAB_ID}::uuid
      `
    );
    expect(code).toBeDefined();
  });
});

describe('deleted rows (C-35)', () => {
  const seedOwnerAndManager = () =>
    prisma.$transaction(async (tx) => {
      await insertActiveOwner(tx);
      await insertCollaboration(tx, {
        id: MEMBER_COLLAB_ID,
        personId: MEMBER_ID,
        role: 'MANAGER',
        status: 'ACTIVE',
      });
    });

  it('accepts a new row for the same person and organization once the earlier one is deleted', async () => {
    await seedOwnerAndManager();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE collaborations SET deleted_at = now() WHERE id = ${MEMBER_COLLAB_ID}::uuid`;
      await insertCollaboration(tx, {
        id: '0199c003-0000-7000-8000-000000000023',
        personId: MEMBER_ID,
        role: 'SELLER',
        status: 'ACTIVE',
      });
    });
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM collaborations WHERE person_id = ${MEMBER_ID}::uuid
    `;
    expect(count).toBe(2n);
  });

  it('ignores a deleted OWNER row when another collaborator becomes OWNER', async () => {
    await seedOwnerAndManager();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE collaborations SET deleted_at = now() WHERE id = ${OWNER_COLLAB_ID}::uuid`;
      await tx.$executeRaw`UPDATE collaborations SET role = 'OWNER' WHERE id = ${MEMBER_COLLAB_ID}::uuid`;
    });
    const [row] = await prisma.$queryRaw<Array<{ role: string }>>`
      SELECT role::text AS role FROM collaborations WHERE id = ${MEMBER_COLLAB_ID}::uuid
    `;
    expect(row.role).toBe('OWNER');
  });

  it('refuses to commit when the only OWNER row is deleted while others remain', async () => {
    await seedOwnerAndManager();
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE collaborations SET deleted_at = now() WHERE id = ${OWNER_COLLAB_ID}::uuid`
    );
    expect(code).toBeDefined();
    const [row] = await prisma.$queryRaw<Array<{ deleted_at: Date | null }>>`
      SELECT deleted_at FROM collaborations WHERE id = ${OWNER_COLLAB_ID}::uuid
    `;
    expect(row.deleted_at).toBeNull();
  });
});

describe('ownership swap', () => {
  it('commits when one transaction demotes the OWNER and promotes another ACTIVE collaborator', async () => {
    await prisma.$transaction(async (tx) => {
      await insertActiveOwner(tx);
      await insertCollaboration(tx, {
        id: MEMBER_COLLAB_ID,
        personId: MEMBER_ID,
        role: 'MANAGER',
        status: 'ACTIVE',
      });
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE collaborations SET role = 'MANAGER' WHERE id = ${OWNER_COLLAB_ID}::uuid`;
      await tx.$executeRaw`UPDATE collaborations SET role = 'OWNER' WHERE id = ${MEMBER_COLLAB_ID}::uuid`;
    });

    const rows = await prisma.$queryRaw<Array<{ id: string; role: string }>>`
      SELECT id::text AS id, role::text AS role FROM collaborations
      WHERE organization_id = ${ORG_ID}::uuid ORDER BY id
    `;
    expect(rows).toEqual([
      { id: OWNER_COLLAB_ID, role: 'MANAGER' },
      { id: MEMBER_COLLAB_ID, role: 'OWNER' },
    ]);
  });
});

describe('column types and defaults', () => {
  it('uses the expected types and defaults', async () => {
    await expectColumnType('collaborations', 'id', 'uuid');
    await expectColumnType('collaborations', 'person_id', 'uuid');
    await expectColumnType('collaborations', 'organization_id', 'uuid');
    await expectColumnType('collaborations', 'amount_held', 'bigint');
    for (const column of ['invited_at', 'accepted_at', 'server_updated_at', 'deleted_at']) {
      await expectColumnType('collaborations', column, 'timestamptz');
    }

    await prisma.$transaction((tx) => insertActiveOwner(tx));
    const [row] = await prisma.$queryRaw<
      Array<{
        amount_held: bigint;
        invited_at: Date;
        accepted_at: Date | null;
        server_updated_at: Date;
        deleted_at: Date | null;
      }>
    >`
      SELECT amount_held, invited_at, accepted_at, server_updated_at, deleted_at
      FROM collaborations WHERE id = ${OWNER_COLLAB_ID}::uuid
    `;
    expect(row.amount_held).toBe(0n);
    expect(row.invited_at).toBeInstanceOf(Date);
    expect(row.server_updated_at).toBeInstanceOf(Date);
    expect(row.accepted_at).toBeNull();
    expect(row.deleted_at).toBeNull();

    const nullable = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'collaborations'
    `;
    const byName = Object.fromEntries(nullable.map((c) => [c.column_name, c.is_nullable]));
    for (const name of [
      'person_id',
      'organization_id',
      'role',
      'status',
      'invited_at',
      'amount_held',
    ]) {
      expect(byName[name], name).toBe('NO');
    }
    expect(byName.accepted_at).toBe('YES');
  });

  it('moves server_updated_at forward on update', async () => {
    await prisma.$transaction((tx) => insertActiveOwner(tx));
    const read = () =>
      prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
        SELECT server_updated_at FROM collaborations WHERE id = ${OWNER_COLLAB_ID}::uuid
      `;
    const [before] = await read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await prisma.$executeRaw`UPDATE collaborations SET amount_held = 5 WHERE id = ${OWNER_COLLAB_ID}::uuid`;
    const [after] = await read();
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
  });
});

describe('crafted owner removal (AB-1)', () => {
  it.each(['REVOKED', 'INVITED'])('refuses to commit the only OWNER set to %s', async (status) => {
    await prisma.$transaction((tx) => insertActiveOwner(tx));

    const code = await captureSqlCode(
      prisma.$executeRaw`
        UPDATE collaborations SET status = ${status}::text::public."CollaborationStatus"
        WHERE id = ${OWNER_COLLAB_ID}::uuid
      `
    );
    expect(code).toBeDefined();

    const [row] = await prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM collaborations WHERE id = ${OWNER_COLLAB_ID}::uuid
    `;
    expect(row.status).toBe('ACTIVE');
  });

  it('refuses to commit when the OWNER is revoked inside an explicit transaction', async () => {
    await prisma.$transaction((tx) => insertActiveOwner(tx));
    const code = await captureSqlCode(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE collaborations SET status = 'REVOKED' WHERE id = ${OWNER_COLLAB_ID}::uuid`;
      })
    );
    expect(code).toBeDefined();
  });
});
