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
const SELLER_ID = '0199c031-0000-7000-8000-000000000016';
const MANAGER_ID = '0199c031-0000-7000-8000-000000000017';
const INVITED_MANAGER_ID = '0199c031-0000-7000-8000-000000000018';
const REVOKED_MANAGER_ID = '0199c031-0000-7000-8000-000000000019';
const DRIVER_ID = '0199c031-0000-7000-8000-00000000001a';
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

type HandoverRow = {
  id?: string;
  organizationId?: string;
  from?: string;
  to?: string;
  amount?: number;
  cancelledAt?: Date | null;
  cancelledBy?: string | null;
};

/** Inserts a handover; defaults describe 5000 XAF from the seller to the owner. */
function insertHandover(row: HandoverRow = {}): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO handovers (
      id, organization_id, from_person_id, to_person_id, amount,
      occurred_at, cancelled_at, cancelled_by_id
    ) VALUES (
      ${row.id ?? FIRST_ID}::uuid, ${row.organizationId ?? ORG_ID}::uuid,
      ${row.from ?? SELLER_ID}::uuid, ${row.to ?? OWNER_ID}::uuid, ${row.amount ?? 5000}::bigint,
      now(), ${row.cancelledAt ?? null}::timestamptz, ${row.cancelledBy ?? null}::uuid
    )
  `;
}

const cancel = (client: typeof prisma, by = OWNER_ID, id = FIRST_ID) =>
  client.$executeRaw`
    UPDATE handovers SET cancelled_at = now(), cancelled_by_id = ${by}::uuid WHERE id = ${id}::uuid
  `;

async function readHandover(id = FIRST_ID) {
  const [row] = await prisma.$queryRaw<
    Array<{
      amount: bigint;
      from_person_id: string;
      to_person_id: string;
      cancelled_at: Date | null;
      cancelled_by_id: string | null;
    }>
  >`SELECT amount, from_person_id, to_person_id, cancelled_at, cancelled_by_id FROM handovers WHERE id = ${id}::uuid`;
  return row;
}

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: new Date('2026-01-01T00:00:00.000Z'),
    preferredLanguage: 'FR' as const,
  };
  const people: Array<[string, string, string]> = [
    [OWNER_ID, 'Owner', '+2250700041011'],
    [REVOKED_ID, 'Gone Driver', '+2250700041012'],
    [STRANGER_ID, 'Stranger', '+2250700041013'],
    [OTHER_OWNER_ID, 'Other Owner', '+2250700041015'],
    [SELLER_ID, 'Seller', '+2250700041016'],
    [MANAGER_ID, 'Manager', '+2250700041017'],
    [INVITED_MANAGER_ID, 'Invited Manager', '+2250700041018'],
    [REVOKED_MANAGER_ID, 'Revoked Manager', '+2250700041019'],
    [DRIVER_ID, 'Driver', '+2250700041020'],
  ];
  await prisma.person.createMany({
    data: [
      ...people.map(([id, name, phone]) => ({
        id,
        fullName: `Fixture ${name}`,
        phoneNumber: phone,
        ...registered,
      })),
      { id: GUEST_ID, phoneNumber: '+2250700041014' },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${ORG_ID}::uuid, 'Fixture Business'), (${OTHER_ORG_ID}::uuid, 'Fixture Other Business')
  `;
  await prisma.$executeRaw`
    INSERT INTO collaborations (id, person_id, organization_id, role, status) VALUES
      ('0199c031-0000-7000-8000-000000000021'::uuid, ${OWNER_ID}::uuid, ${ORG_ID}::uuid, 'OWNER', 'ACTIVE'),
      ('0199c031-0000-7000-8000-000000000022'::uuid, ${REVOKED_ID}::uuid, ${ORG_ID}::uuid, 'DRIVER', 'REVOKED'),
      ('0199c031-0000-7000-8000-000000000023'::uuid, ${OTHER_OWNER_ID}::uuid, ${OTHER_ORG_ID}::uuid, 'OWNER', 'ACTIVE'),
      ('0199c031-0000-7000-8000-000000000024'::uuid, ${SELLER_ID}::uuid, ${ORG_ID}::uuid, 'SELLER', 'ACTIVE'),
      ('0199c031-0000-7000-8000-000000000025'::uuid, ${MANAGER_ID}::uuid, ${ORG_ID}::uuid, 'MANAGER', 'ACTIVE'),
      ('0199c031-0000-7000-8000-000000000026'::uuid, ${INVITED_MANAGER_ID}::uuid, ${ORG_ID}::uuid, 'MANAGER', 'INVITED'),
      ('0199c031-0000-7000-8000-000000000027'::uuid, ${REVOKED_MANAGER_ID}::uuid, ${ORG_ID}::uuid, 'MANAGER', 'REVOKED'),
      ('0199c031-0000-7000-8000-000000000028'::uuid, ${DRIVER_ID}::uuid, ${ORG_ID}::uuid, 'DRIVER', 'ACTIVE')
  `;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('handovers insert rules (AC-1, C-27, C-04)', () => {
  it('accepts a handover from a SELLER to the OWNER', async () => {
    await expect(insertHandover()).resolves.toBe(1);
  });

  it('accepts a handover from a REVOKED driver to a MANAGER', async () => {
    await expect(insertHandover({ from: REVOKED_ID, to: MANAGER_ID })).resolves.toBe(1);
  });

  it('accepts a handover from the owner to themselves', async () => {
    await expect(insertHandover({ from: OWNER_ID, to: OWNER_ID })).resolves.toBe(1);
  });

  it.each([
    ['a SELLER', SELLER_ID],
    ['a DRIVER', DRIVER_ID],
    ['an INVITED manager', INVITED_MANAGER_ID],
    ['a REVOKED manager', REVOKED_MANAGER_ID],
    ['a person who never collaborated', STRANGER_ID],
    ['an owner of another organization', OTHER_OWNER_ID],
  ])('rejects a receiver that is %s with 23514', async (_name, to) => {
    expect(await captureSqlCode(insertHandover({ from: OWNER_ID, to }))).toBe('23514');
  });

  it('rejects a sender who never collaborated with 23514', async () => {
    expect(await captureSqlCode(insertHandover({ from: STRANGER_ID }))).toBe('23514');
  });

  it('rejects a sender who collaborates only with another organization with 23514', async () => {
    expect(await captureSqlCode(insertHandover({ from: OTHER_OWNER_ID }))).toBe('23514');
  });

  it.each([0, -5])('rejects amount %s with 23514', async (amount) => {
    expect(await captureSqlCode(insertHandover({ amount }))).toBe('23514');
  });

  it('rejects cancelled_at without cancelled_by_id with 23514', async () => {
    expect(await captureSqlCode(insertHandover({ cancelledAt: new Date() }))).toBe('23514');
  });

  it('rejects cancelled_by_id without cancelled_at with 23514', async () => {
    expect(await captureSqlCode(insertHandover({ cancelledBy: OWNER_ID }))).toBe('23514');
  });

  it('rejects a guest as cancelled_by_id with 23514', async () => {
    const code = await captureSqlCode(
      insertHandover({ cancelledAt: new Date(), cancelledBy: GUEST_ID })
    );
    expect(code).toBe('23514');
  });

  it('rejects a guest as sender or receiver with 23514', async () => {
    expect(await captureSqlCode(insertHandover({ from: GUEST_ID }))).toBe('23514');
    expect(await captureSqlCode(insertHandover({ to: GUEST_ID }))).toBe('23514');
  });

  it('rejects null required columns with 23502', async () => {
    for (const column of [
      'organization_id',
      'from_person_id',
      'to_person_id',
      'amount',
      'occurred_at',
    ]) {
      const values: Record<string, string | null> = {
        organization_id: ORG_ID,
        from_person_id: SELLER_ID,
        to_person_id: OWNER_ID,
        amount: '5000',
        occurred_at: '2026-01-01T00:00:00Z',
      };
      values[column] = null;
      const code = await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO handovers (id, organization_id, from_person_id, to_person_id, amount, occurred_at)
          VALUES (
            ${FIRST_ID}::uuid, ${values.organization_id}::uuid, ${values.from_person_id}::uuid,
            ${values.to_person_id}::uuid, ${values.amount}::bigint, ${values.occurred_at}::timestamptz
          )
        `
      );
      expect(code, column).toBe('23502');
    }
  });

  it('rejects unknown organization with 23503', async () => {
    const unknown = '0199c031-0000-7000-8000-0000000009ff';
    expect(await captureSqlCode(insertHandover({ organizationId: unknown }))).toBe('23503');
  });

  it('has server_updated_at and deleted_at present', async () => {
    await insertHandover();
    const [row] = await prisma.$queryRaw<Array<{ server_updated_at: Date; deleted_at: Date | null }>>`
      SELECT server_updated_at, deleted_at FROM handovers WHERE id = ${FIRST_ID}::uuid
    `;
    expect(row.server_updated_at).toBeInstanceOf(Date);
    expect(row.deleted_at).toBeNull();
  });
});

describe('handovers cancel once (AC-2)', () => {
  it('accepts the first cancellation and refuses a second with 23514', async () => {
    await insertHandover();
    await expect(cancel(prisma)).resolves.toBe(1);
    const first = await readHandover();
    expect(first.cancelled_by_id).toBe(OWNER_ID);

    expect(await captureSqlCode(cancel(prisma, MANAGER_ID))).toBe('23514');
    const after = await readHandover();
    expect(after.cancelled_at).toEqual(first.cancelled_at);
    expect(after.cancelled_by_id).toBe(OWNER_ID);
  });

  it('refuses to clear a cancellation with 23514', async () => {
    await insertHandover();
    await cancel(prisma);
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE handovers SET cancelled_at = NULL, cancelled_by_id = NULL WHERE id = ${FIRST_ID}::uuid`
    );
    expect(code).toBe('23514');
  });

  it('refuses a half cancellation with 23514', async () => {
    await insertHandover();
    const code = await captureSqlCode(
      prisma.$executeRaw`UPDATE handovers SET cancelled_at = now() WHERE id = ${FIRST_ID}::uuid`
    );
    expect(code).toBe('23514');
  });

  it('refuses a cancellation by a guest with 23514', async () => {
    await insertHandover();
    expect(await captureSqlCode(cancel(prisma, GUEST_ID))).toBe('23514');
    expect((await readHandover()).cancelled_at).toBeNull();
  });

  it('refuses a cancellation combined with an edit of the amount with 23514', async () => {
    await insertHandover();
    const code = await captureSqlCode(
      prisma.$executeRaw`
        UPDATE handovers SET amount = 1, cancelled_at = now(), cancelled_by_id = ${OWNER_ID}::uuid
        WHERE id = ${FIRST_ID}::uuid
      `
    );
    expect(code).toBe('23514');
    expect((await readHandover()).amount).toBe(5000n);
  });

  it.each([
    ['amount', 'amount = 4000'],
    ['sender', `from_person_id = '${REVOKED_ID}'::uuid`],
    ['receiver', `to_person_id = '${MANAGER_ID}'::uuid`],
    ['organization', `organization_id = '${OTHER_ORG_ID}'::uuid`],
    ['occurred_at', `occurred_at = occurred_at + interval '1 day'`],
    ['deleted_at', `deleted_at = now()`],
  ])('refuses to change the %s with 23514', async (_name, assignment) => {
    await insertHandover();
    const code = await captureSqlCode(
      prisma.$executeRawUnsafe(`UPDATE handovers SET ${assignment} WHERE id = '${FIRST_ID}'`)
    );
    expect(code).toBe('23514');
    const row = await readHandover();
    expect(row.amount).toBe(5000n);
    expect(row.from_person_id).toBe(SELLER_ID);
    expect(row.to_person_id).toBe(OWNER_ID);
  });

  it('keeps server_updated_at moving on an allowed cancellation', async () => {
    await insertHandover();
    const read = () =>
      prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
        SELECT server_updated_at FROM handovers WHERE id = ${FIRST_ID}::uuid
      `;
    const [before] = await read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await cancel(prisma);
    const [after] = await read();
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
  });
});

describe('handing money to someone who cannot receive it (AB-1, CWE-284)', () => {
  it('refuses the application account inserting a handover to a driver', async () => {
    const code = await captureSqlCode(
      appPrisma.$executeRaw`
        INSERT INTO handovers (id, organization_id, from_person_id, to_person_id, amount, occurred_at)
        VALUES (${SECOND_ID}::uuid, ${ORG_ID}::uuid, ${SELLER_ID}::uuid, ${DRIVER_ID}::uuid, 5000, now())
      `
    );
    expect(code).toBe('23514');
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM handovers WHERE id = ${SECOND_ID}::uuid
    `;
    expect(rows).toHaveLength(0);
  });
});
