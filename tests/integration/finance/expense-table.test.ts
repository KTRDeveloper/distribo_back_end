import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();

const ORG_ID = '0199c031-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199c031-0000-7000-8000-000000000002';
const OWNER_ID = '0199c031-0000-7000-8000-000000000011';
const REVOKED_ID = '0199c031-0000-7000-8000-000000000012';
const STRANGER_ID = '0199c031-0000-7000-8000-000000000013';
const GUEST_ID = '0199c031-0000-7000-8000-000000000014';
const OTHER_OWNER_ID = '0199c031-0000-7000-8000-000000000015';
const FIRST_ID = '0199c031-0000-7000-8000-000000000031';
const SECOND_ID = '0199c031-0000-7000-8000-000000000032';

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

type ExpenseRow = {
  id?: string;
  organizationId?: string;
  paidBy?: string;
  amount?: number;
  category?: string | null;
  recordedBy?: string;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
};

/** Inserts an expense; defaults describe 5000 XAF paid by the owner, recorded by the owner. */
function insertExpense(row: ExpenseRow = {}): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO expenses (
      id, organization_id, paid_by_id, amount, category, recorded_by_id,
      occurred_at, cancelled_at, cancelled_by_id
    ) VALUES (
      ${row.id ?? FIRST_ID}::uuid, ${row.organizationId ?? ORG_ID}::uuid,
      ${row.paidBy ?? OWNER_ID}::uuid, ${row.amount ?? 5000}::bigint,
      ${row.category ?? null}, ${row.recordedBy ?? OWNER_ID}::uuid, now(),
      ${row.cancelledAt ?? null}::timestamptz, ${row.cancelledBy ?? null}::uuid
    )
  `;
}

const cancel = (client: typeof prisma, by = OWNER_ID, id = FIRST_ID) =>
  client.$executeRaw`
    UPDATE expenses SET cancelled_at = now(), cancelled_by_id = ${by}::uuid WHERE id = ${id}::uuid
  `;

async function readExpense(id = FIRST_ID) {
  const [row] = await prisma.$queryRaw<
    Array<{
      amount: bigint;
      paid_by_id: string;
      category: string | null;
      cancelled_at: Date | null;
      cancelled_by_id: string | null;
    }>
  >`SELECT amount, paid_by_id, category, cancelled_at, cancelled_by_id FROM expenses WHERE id = ${id}::uuid`;
  return row;
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700031011', ...registered },
      { id: REVOKED_ID, fullName: 'Fixture Gone', phoneNumber: '+2250700031012', ...registered },
      { id: STRANGER_ID, fullName: 'Fixture Stranger', phoneNumber: '+2250700031013', ...registered },
      { id: GUEST_ID, phoneNumber: '+2250700031014' },
      {
        id: OTHER_OWNER_ID,
        fullName: 'Fixture Other Owner',
        phoneNumber: '+2250700031015',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${ORG_ID}::uuid, 'Fixture Business'), (${OTHER_ORG_ID}::uuid, 'Fixture Other Business')
  `;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO collaborations (id, person_id, organization_id, role, status) VALUES
        ('0199c031-0000-7000-8000-000000000021'::uuid, ${OWNER_ID}::uuid, ${ORG_ID}::uuid, 'OWNER', 'ACTIVE'),
        ('0199c031-0000-7000-8000-000000000022'::uuid, ${REVOKED_ID}::uuid, ${ORG_ID}::uuid, 'SELLER', 'REVOKED'),
        ('0199c031-0000-7000-8000-000000000023'::uuid, ${OTHER_OWNER_ID}::uuid, ${OTHER_ORG_ID}::uuid, 'OWNER', 'ACTIVE')
    `;
  });
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('expenses insert rules (AC-1, C-27, C-04)', () => {
  it('accepts an expense paid by an ACTIVE collaborator', async () => {
    await expect(insertExpense({ amount: 5000 })).resolves.toBe(1);
  });

  it('accepts an expense paid by a REVOKED collaborator', async () => {
    await expect(insertExpense({ paidBy: REVOKED_ID })).resolves.toBe(1);
  });

  it('rejects a payer who never collaborated with 23514', async () => {
    expect(await captureSqlCode(insertExpense({ paidBy: STRANGER_ID }))).toBe('23514');
  });

  it('rejects a payer who collaborates only with another organization with 23514', async () => {
    expect(await captureSqlCode(insertExpense({ paidBy: OTHER_OWNER_ID }))).toBe('23514');
  });

  it.each([0, -5])('rejects amount %s with 23514', async (amount) => {
    expect(await captureSqlCode(insertExpense({ amount }))).toBe('23514');
  });

  it('rejects cancelled_at without cancelled_by_id with 23514', async () => {
    expect(await captureSqlCode(insertExpense({ cancelledAt: new Date() }))).toBe('23514');
  });

  it('rejects cancelled_by_id without cancelled_at with 23514', async () => {
    expect(await captureSqlCode(insertExpense({ cancelledBy: OWNER_ID }))).toBe('23514');
  });

  it('rejects a guest as recorded_by_id with 23514', async () => {
    expect(await captureSqlCode(insertExpense({ recordedBy: GUEST_ID }))).toBe('23514');
  });

  it('rejects a guest as cancelled_by_id with 23514', async () => {
    const code = await captureSqlCode(
      insertExpense({ cancelledAt: new Date(), cancelledBy: GUEST_ID })
    );
    expect(code).toBe('23514');
  });

  it('rejects null required columns with 23502', async () => {
    for (const column of ['organization_id', 'paid_by_id', 'amount', 'recorded_by_id', 'occurred_at']) {
      const values: Record<string, string | null> = {
        organization_id: ORG_ID,
        paid_by_id: OWNER_ID,
        amount: '5000',
        recorded_by_id: OWNER_ID,
        occurred_at: '2026-01-01T00:00:00Z',
      };
      values[column] = null;
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO expenses (id, organization_id, paid_by_id, amount, recorded_by_id, occurred_at)
          VALUES (
            ${FIRST_ID}::uuid, ${values.organization_id}::uuid, ${values.paid_by_id}::uuid,
            ${values.amount}::bigint, ${values.recorded_by_id}::uuid, ${values.occurred_at}::timestamptz
          )
        `
      );
      expect(code, column).toBe('23502');
    }
  });

  it('rejects unknown organization and person with 23503', async () => {
    const unknown = '0199c031-0000-7000-8000-0000000009ff';
    expect(await captureSqlCode(insertExpense({ organizationId: unknown }))).toBe('23503');
    expect(await captureSqlCode(insertExpense({ recordedBy: unknown }))).toBe('23503');
  });

  it('has the optional columns nullable and server_updated_at / deleted_at present', async () => {
    await insertExpense();
    const [row] = await prisma.$queryRaw<
      Array<{ server_updated_at: Date; deleted_at: Date | null; description: string | null }>
    >`SELECT server_updated_at, deleted_at, description FROM expenses WHERE id = ${FIRST_ID}::uuid`;
    expect(row.server_updated_at).toBeInstanceOf(Date);
    expect(row.deleted_at).toBeNull();
    expect(row.description).toBeNull();
  });
});

describe('expenses cancel once (AC-2)', () => {
  it('accepts the first cancellation and refuses a second with 23514', async () => {
    await insertExpense();
    await expect(cancel(prisma)).resolves.toBe(1);
    const first = await readExpense();
    expect(first.cancelled_by_id).toBe(OWNER_ID);

    expect(await captureSqlCode(cancel(prisma, REVOKED_ID))).toBe('23514');
    const after = await readExpense();
    expect(after.cancelled_at).toEqual(first.cancelled_at);
    expect(after.cancelled_by_id).toBe(OWNER_ID);
  });

  it('refuses to clear a cancellation with 23514', async () => {
    await insertExpense();
    await cancel(prisma);
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE expenses SET cancelled_at = NULL, cancelled_by_id = NULL WHERE id = ${FIRST_ID}::uuid`
    );
    expect(code).toBe('23514');
  });

  it('refuses a half cancellation with 23514', async () => {
    await insertExpense();
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE expenses SET cancelled_at = now() WHERE id = ${FIRST_ID}::uuid`
    );
    expect(code).toBe('23514');
  });

  it('refuses a cancellation by a guest when the transaction is saved', async () => {
    await insertExpense();
    expect(await captureSqlCode(cancel(prisma, GUEST_ID))).toBe('23514');
    expect((await readExpense()).cancelled_at).toBeNull();
  });

  it('refuses a cancellation combined with an edit of the amount with 23514', async () => {
    await insertExpense();
    const code = await captureSqlCode(
      prisma.$executeRaw`
        UPDATE expenses SET amount = 1, cancelled_at = now(), cancelled_by_id = ${OWNER_ID}::uuid
        WHERE id = ${FIRST_ID}::uuid
      `
    );
    expect(code).toBe('23514');
    expect((await readExpense()).amount).toBe(5000n);
  });
});

describe('expenses are never edited (AC-3)', () => {
  it.each([
    ['amount', 'amount = 4000'],
    ['payer', `paid_by_id = '${REVOKED_ID}'::uuid`],
    ['category', `category = 'fuel'`],
    ['description', `description = 'changed'`],
    ['organization', `organization_id = '${OTHER_ORG_ID}'::uuid`],
    ['recorder', `recorded_by_id = '${REVOKED_ID}'::uuid`],
    ['occurred_at', `occurred_at = occurred_at + interval '1 day'`],
    ['deleted_at', `deleted_at = now()`],
  ])('refuses to change the %s with 23514', async (_name, assignment) => {
    await insertExpense({ category: 'rent' });
    const code = await captureSqlCode(
      prisma.$executeRawUnsafe(`UPDATE expenses SET ${assignment} WHERE id = '${FIRST_ID}'`)
    );
    expect(code).toBe('23514');
    const row = await readExpense();
    expect(row.amount).toBe(5000n);
    expect(row.paid_by_id).toBe(OWNER_ID);
    expect(row.category).toBe('rent');
  });

  it('keeps server_updated_at moving on an allowed cancellation', async () => {
    await insertExpense();
    const read = () =>
      prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
        SELECT server_updated_at FROM expenses WHERE id = ${FIRST_ID}::uuid
      `;
    const [before] = await read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await cancel(prisma);
    const [after] = await read();
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
  });
});

describe('tampering with an expense (AB-1, CWE-345)', () => {
  it('refuses the application account lowering the amount', async () => {
    await insertExpense({ id: SECOND_ID, amount: 90000 });
    const code = await captureSqlCode(
      appPrisma.$executeRaw`UPDATE expenses SET amount = 100 WHERE id = ${SECOND_ID}::uuid`
    );
    expect(code).toBe('23514');
    expect((await readExpense(SECOND_ID)).amount).toBe(90000n);
  });
});
