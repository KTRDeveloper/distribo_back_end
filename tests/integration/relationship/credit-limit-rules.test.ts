import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const SUPPLIER_ORG_ID = '0199c00a-0000-7000-8000-000000000001';
const OWNER_ID = '0199c00a-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c00a-0000-7000-8000-000000000012';
const OTHER_ID = '0199c00a-0000-7000-8000-000000000013';
const GUEST_ID = '0199c00a-0000-7000-8000-000000000014';
const REL_ID = '0199c00a-0000-7000-8000-000000000021';

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
  /** Set to false for a counter (no customer). */
  customer?: boolean;
  creditLimit?: bigint | null;
  /** Omit to use the column default; pass null for an empty limit. */
  withLimit?: boolean;
  setById?: string | null;
  setAt?: Date | null;
};

/** Inserts a relationship with a customer person (or a counter); the limit is the column default unless withLimit. */
function insertRelationship(row: Row = {}): Promise<number> {
  const id = row.id ?? REL_ID;
  const customer = row.customer === false ? null : CUSTOMER_ID;
  const label = row.customer === false ? 'Client de passage' : null;
  if (row.withLimit) {
    return prisma.$executeRaw`
      INSERT INTO customer_relationships (
        id, supplier_organization_id, customer_person_id, customer_label, created_by_id,
        credit_limit, credit_limit_set_by_id, credit_limit_set_at
      ) VALUES (
        ${id}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${customer}::uuid, ${label}, ${OWNER_ID}::uuid,
        ${row.creditLimit ?? null}::bigint, ${row.setById ?? null}::uuid,
        ${row.setAt ?? null}::timestamptz
      )
    `;
  }
  return prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, customer_person_id, customer_label, created_by_id,
      credit_limit_set_by_id, credit_limit_set_at
    ) VALUES (
      ${id}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${customer}::uuid, ${label}, ${OWNER_ID}::uuid,
      ${row.setById ?? null}::uuid, ${row.setAt ?? null}::timestamptz
    )
  `;
}

type Journal = {
  customer_relationship_id: string;
  previous_limit: bigint | null;
  new_limit: bigint | null;
  set_by_id: string;
  set_at: Date;
};

function journal(relationshipId = REL_ID): Promise<Journal[]> {
  return prisma.$queryRaw<Journal[]>`
    SELECT customer_relationship_id, previous_limit, new_limit, set_by_id, set_at
    FROM credit_limit_changes WHERE customer_relationship_id = ${relationshipId}::uuid
    ORDER BY set_at
  `;
}

function readLimit(id = REL_ID) {
  return prisma.$queryRaw<
    Array<{
      credit_limit: bigint | null;
      credit_limit_set_by_id: string | null;
      credit_limit_set_at: Date | null;
    }>
  >`
    SELECT credit_limit, credit_limit_set_by_id, credit_limit_set_at
    FROM customer_relationships WHERE id = ${id}::uuid
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700010011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700010012',
        ...registered,
      },
      { id: OTHER_ID, fullName: 'Fixture Other', phoneNumber: '+2250700010013', ...registered },
      { id: GUEST_ID, phoneNumber: '+2250700010014' },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier')
  `;
});

describe('default (AC-1, C-10)', () => {
  it('starts at 0 with no journal row', async () => {
    await insertRelationship();
    const [row] = await readLimit();
    expect(row.credit_limit).toBe(0n);
    expect(row.credit_limit_set_by_id).toBeNull();
    expect(row.credit_limit_set_at).toBeNull();
    expect(await journal()).toHaveLength(0);
  });
});

describe('rules (AC-2, C-10)', () => {
  it('rejects a counter with credit_limit 10000 with 23514', async () => {
    expect(
      await captureSqlCode(
        insertRelationship({ customer: false, withLimit: true, creditLimit: 10000n })
      )
    ).toBe('23514');
  });

  it('rejects a counter with an empty credit_limit with 23514', async () => {
    expect(
      await captureSqlCode(
        insertRelationship({ customer: false, withLimit: true, creditLimit: null })
      )
    ).toBe('23514');
  });

  it('accepts a counter at the default 0', async () => {
    await expect(insertRelationship({ customer: false })).resolves.toBe(1);
  });

  it('rejects credit_limit -1 with 23514', async () => {
    expect(await captureSqlCode(insertRelationship({ withLimit: true, creditLimit: -1n }))).toBe(
      '23514'
    );
  });

  it('rejects an author without a time, and a time without an author, with 23514', async () => {
    expect(await captureSqlCode(insertRelationship({ setById: OWNER_ID }))).toBe('23514');
    expect(
      await captureSqlCode(insertRelationship({ setAt: new Date('2026-02-01T00:00:00.000Z') }))
    ).toBe('23514');
  });

  it('accepts an author together with a time', async () => {
    await expect(
      insertRelationship({ setById: OWNER_ID, setAt: new Date('2026-02-01T00:00:00.000Z') })
    ).resolves.toBe(1);
  });

  it('accepts an empty credit_limit (no ceiling) on a customer', async () => {
    await expect(insertRelationship({ withLimit: true, creditLimit: null })).resolves.toBe(1);
  });

  it('rejects raising a counter limit by update with 23514', async () => {
    await insertRelationship({ customer: false });
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          UPDATE customer_relationships SET credit_limit = 10000, credit_limit_set_by_id = ${OWNER_ID}::uuid
          WHERE id = ${REL_ID}::uuid
        `
      )
    ).toBe('23514');
    expect((await readLimit())[0].credit_limit).toBe(0n);
    expect(await journal()).toHaveLength(0);
  });
});

describe('journal from the database (AC-3, C-10)', () => {
  it('writes one row with previous, new, author and server time', async () => {
    await insertRelationship();
    await prisma.$executeRaw`
      UPDATE customer_relationships
      SET credit_limit = 50000, credit_limit_set_by_id = ${OWNER_ID}::uuid
      WHERE id = ${REL_ID}::uuid
    `;
    const rows = await journal();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customer_relationship_id: REL_ID,
      previous_limit: 0n,
      new_limit: 50000n,
      set_by_id: OWNER_ID,
    });
    expect(Math.abs(Date.now() - rows[0].set_at.getTime())).toBeLessThan(5_000);
    const [row] = await readLimit();
    expect(row.credit_limit).toBe(50000n);
    expect(row.credit_limit_set_by_id).toBe(OWNER_ID);
    expect(row.credit_limit_set_at?.getTime()).toBe(rows[0].set_at.getTime());
  });

  it('ignores a time chosen by the caller and uses the server time', async () => {
    await insertRelationship();
    await prisma.$executeRaw`
      UPDATE customer_relationships
      SET credit_limit = 50000, credit_limit_set_by_id = ${OWNER_ID}::uuid,
          credit_limit_set_at = '2020-01-01T00:00:00Z'::timestamptz
      WHERE id = ${REL_ID}::uuid
    `;
    const [row] = await readLimit();
    expect(Math.abs(Date.now() - (row.credit_limit_set_at as Date).getTime())).toBeLessThan(5_000);
    expect((await journal())[0].set_at.getTime()).toBe(row.credit_limit_set_at?.getTime());
  });

  it('journals a change to and from an empty (no ceiling) limit', async () => {
    await insertRelationship();
    await prisma.$executeRaw`
      UPDATE customer_relationships SET credit_limit = NULL, credit_limit_set_by_id = ${OWNER_ID}::uuid
      WHERE id = ${REL_ID}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE customer_relationships SET credit_limit = 100, credit_limit_set_by_id = ${OTHER_ID}::uuid
      WHERE id = ${REL_ID}::uuid
    `;
    const rows = await journal();
    expect(rows.map((r) => [r.previous_limit, r.new_limit, r.set_by_id])).toEqual(
      expect.arrayContaining([
        [0n, null, OWNER_ID],
        [null, 100n, OTHER_ID],
      ])
    );
    expect(rows).toHaveLength(2);
  });
});

describe('author must change with the value (AC-4)', () => {
  it('fails with 23514 and leaves the value unchanged', async () => {
    await insertRelationship();
    await prisma.$executeRaw`
      UPDATE customer_relationships SET credit_limit = 50000, credit_limit_set_by_id = ${OWNER_ID}::uuid
      WHERE id = ${REL_ID}::uuid
    `;
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          UPDATE customer_relationships SET credit_limit = 60000 WHERE id = ${REL_ID}::uuid
        `
      )
    ).toBe('23514');
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          UPDATE customer_relationships
          SET credit_limit = 60000, credit_limit_set_by_id = ${OWNER_ID}::uuid
          WHERE id = ${REL_ID}::uuid
        `
      )
    ).toBe('23514');
    expect((await readLimit())[0].credit_limit).toBe(50000n);
    expect(await journal()).toHaveLength(1);
  });

  it('fails with 23514 when a change erases the author', async () => {
    await insertRelationship();
    await prisma.$executeRaw`
      UPDATE customer_relationships SET credit_limit = 50000, credit_limit_set_by_id = ${OWNER_ID}::uuid
      WHERE id = ${REL_ID}::uuid
    `;
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          UPDATE customer_relationships SET credit_limit = 1, credit_limit_set_by_id = NULL
          WHERE id = ${REL_ID}::uuid
        `
      )
    ).toBe('23514');
    expect((await readLimit())[0].credit_limit).toBe(50000n);
  });

  it('rejects at commit a limit set by a guest with 23514', async () => {
    await insertRelationship();
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          UPDATE customer_relationships SET credit_limit = 5, credit_limit_set_by_id = ${GUEST_ID}::uuid
          WHERE id = ${REL_ID}::uuid
        `
      )
    ).toBe('23514');
    expect((await readLimit())[0].credit_limit).toBe(0n);
  });
});

describe('same value is no change (AC-5)', () => {
  it('adds no journal row and keeps the author and time', async () => {
    await insertRelationship();
    await prisma.$executeRaw`
      UPDATE customer_relationships SET credit_limit = 50000, credit_limit_set_by_id = ${OWNER_ID}::uuid
      WHERE id = ${REL_ID}::uuid
    `;
    const before = (await readLimit())[0];
    await prisma.$executeRaw`
      UPDATE customer_relationships SET credit_limit = 50000 WHERE id = ${REL_ID}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE customer_relationships SET credit_limit = 50000, credit_limit_set_by_id = ${OTHER_ID}::uuid
      WHERE id = ${REL_ID}::uuid
    `;
    expect(await journal()).toHaveLength(1);
    expect((await readLimit())[0].credit_limit_set_at).toEqual(before.credit_limit_set_at);
  });

  it('adds no journal row when the update does not touch the limit', async () => {
    await insertRelationship();
    await prisma.$executeRaw`UPDATE customer_relationships SET balance = 5 WHERE id = ${REL_ID}::uuid`;
    expect(await journal()).toHaveLength(0);
  });
});

describe('same transaction (AC-6, CWE-362)', () => {
  it('leaves neither the limit nor the journal row after a rollback', async () => {
    await insertRelationship();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE customer_relationships SET credit_limit = 50000, credit_limit_set_by_id = ${OWNER_ID}::uuid
          WHERE id = ${REL_ID}::uuid
        `;
        const inside = await tx.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM credit_limit_changes WHERE customer_relationship_id = ${REL_ID}::uuid
        `;
        expect(inside[0].n).toBe(1n);
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');
    expect((await readLimit())[0].credit_limit).toBe(0n);
    expect(await journal()).toHaveLength(0);
  });
});

describe('silent change (AB-1, CWE-778)', () => {
  it('cannot change a limit through an upsert without a journal row or a new author', async () => {
    await insertRelationship();
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id, credit_limit)
          VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid, 99999)
          ON CONFLICT (id) DO UPDATE SET credit_limit = EXCLUDED.credit_limit
        `
      )
    ).toBe('23514');
    expect((await readLimit())[0].credit_limit).toBe(0n);
    expect(await journal()).toHaveLength(0);
  });

  it('journals a limit raised through an upsert that also changes the author', async () => {
    await insertRelationship();
    await prisma.$executeRaw`
      INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
      VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
      ON CONFLICT (id) DO UPDATE
      SET credit_limit = 99999, credit_limit_set_by_id = ${OWNER_ID}::uuid
    `;
    const rows = await journal();
    expect(rows).toHaveLength(1);
    expect(rows[0].new_limit).toBe(99999n);
  });

  it('never leaves a changed limit without a matching journal row', async () => {
    await insertRelationship();
    const attempts = [
      prisma.$executeRaw`UPDATE customer_relationships SET credit_limit = 10 WHERE id = ${REL_ID}::uuid`,
      prisma.$executeRaw`
        UPDATE customer_relationships SET credit_limit = 10, credit_limit_set_by_id = ${OWNER_ID}::uuid
        WHERE id = ${REL_ID}::uuid`,
    ];
    const codes: Array<string | undefined> = [];
    for (const attempt of attempts) codes.push(await captureSqlCode(attempt));
    const [row] = await readLimit();
    const rows = await journal();
    // Either the update failed, or the journal holds the matching row.
    expect(codes[0]).toBe('23514');
    expect(codes[1]).toBeUndefined();
    expect(row.credit_limit).toBe(rows[rows.length - 1].new_limit);
  });
});
