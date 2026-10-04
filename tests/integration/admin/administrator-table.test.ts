import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../setup';

const REGISTERED_ID = '0199d001-0000-7000-8000-000000000001';
const GUEST_ID = '0199d001-0000-7000-8000-000000000002';
const UNKNOWN_ID = '0199d001-0000-7000-8000-0000000000ff';
const ADMIN_ID = '0199d001-0000-7000-8000-000000000011';
const ADMIN_ID_2 = '0199d001-0000-7000-8000-000000000012';
const PERSON_EMAIL = 'Fixture.Admin@example.test';

// The registered-person check is deferred to commit: run it as one auto-committed
// statement so the driver reports the PostgreSQL code.
type Tx = Pick<Prisma.TransactionClient, '$executeRaw'>;
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

async function insertAdministrator(
  tx: Tx,
  values: {
    id?: string;
    personId?: string;
    role?: string;
    totpSecret?: string | null;
    recoveryEmail?: string | null;
  } = {}
): Promise<number> {
  const totpSecret = values.totpSecret === undefined ? 'encrypted-secret' : values.totpSecret;
  return tx.$executeRaw`
    INSERT INTO administrators (id, person_id, role, totp_secret, recovery_email)
    VALUES (
      ${values.id ?? ADMIN_ID}::uuid,
      ${values.personId ?? REGISTERED_ID}::uuid,
      ${values.role ?? 'MODERATOR'}::text::public."AdministratorRole",
      ${totpSecret},
      ${values.recoveryEmail ?? null}
    )
  `;
}

beforeEach(async () => {
  await prisma.person.createMany({
    data: [
      {
        id: REGISTERED_ID,
        fullName: 'Fixture Admin',
        phoneNumber: '+2250700004001',
        email: PERSON_EMAIL,
        phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
        registeredAt: new Date('2026-01-01T00:00:00.000Z'),
        preferredLanguage: 'FR',
      },
      { id: GUEST_ID, phoneNumber: '+2250700004002' },
    ],
  });
});

describe('administrators table rules', () => {
  it('accepts a registered person with role MODERATOR and a secret', async () => {
    await expect(prisma.$transaction((tx) => insertAdministrator(tx))).resolves.toBe(1);
  });

  it('accepts role SUPER_ADMIN', async () => {
    await expect(
      prisma.$transaction((tx) => insertAdministrator(tx, { role: 'SUPER_ADMIN' }))
    ).resolves.toBe(1);
  });

  it('defaults appointed_at to now and removed_at to null', async () => {
    await prisma.$transaction((tx) => insertAdministrator(tx));
    const rows = await prisma.$queryRaw<
      Array<{ appointed_at: Date | null; removed_at: Date | null }>
    >`SELECT appointed_at, removed_at FROM administrators`;
    expect(rows[0]?.appointed_at).toBeInstanceOf(Date);
    expect(rows[0]?.removed_at).toBeNull();
  });

  it('rejects a guest with 23514', async () => {
    const code = await captureSqlCode(insertAdministrator(prisma, { personId: GUEST_ID }));
    expect(code).toBe('23514');
  });

  it('rejects a missing totp_secret with 23502', async () => {
    const code = await captureSqlCode(
      prisma.$transaction((tx) => insertAdministrator(tx, { totpSecret: null }))
    );
    expect(code).toBe('23502');
  });

  it('rejects role ROOT', async () => {
    const code = await captureSqlCode(
      prisma.$transaction((tx) => insertAdministrator(tx, { role: 'ROOT' }))
    );
    expect(code).toBeDefined();
  });

  it('rejects a second live row for the same person with 23505', async () => {
    const code = await captureSqlCode(
      prisma.$transaction(async (tx) => {
        await insertAdministrator(tx);
        await insertAdministrator(tx, { id: ADMIN_ID_2, role: 'SUPER_ADMIN' });
      })
    );
    expect(code).toBe('23505');
  });

  it('accepts a new row for a person whose first row was removed', async () => {
    await prisma.$transaction((tx) => insertAdministrator(tx));
    await prisma.$executeRaw`UPDATE administrators SET removed_at = now() WHERE id = ${ADMIN_ID}::uuid`;
    await expect(
      prisma.$transaction((tx) => insertAdministrator(tx, { id: ADMIN_ID_2 }))
    ).resolves.toBe(1);
  });

  it('rejects a recovery_email equal to the person email, ignoring case, with 23514', async () => {
    const code = await captureSqlCode(
      prisma.$transaction((tx) =>
        insertAdministrator(tx, { recoveryEmail: PERSON_EMAIL.toLowerCase() })
      )
    );
    expect(code).toBe('23514');
  });

  it('accepts a recovery_email different from the person email', async () => {
    await expect(
      prisma.$transaction((tx) =>
        insertAdministrator(tx, { recoveryEmail: 'recovery@example.test' })
      )
    ).resolves.toBe(1);
  });

  it('rejects updating recovery_email to the person email with 23514', async () => {
    await prisma.$transaction((tx) => insertAdministrator(tx));
    const code = await captureSqlCode(
      prisma.$executeRaw`
        UPDATE administrators SET recovery_email = ${PERSON_EMAIL}
        WHERE id = ${ADMIN_ID}::uuid
      `
    );
    expect(code).toBe('23514');
  });
});

describe('administrators person key', () => {
  it('fails with 23503 when the person id is unknown', async () => {
    const code = await captureSqlCode(
      prisma.$transaction((tx) => insertAdministrator(tx, { personId: UNKNOWN_ID }))
    );
    expect(code).toBe('23503');
  });
});

describe('administrators without two-factor (AB-1)', () => {
  it.each(['', '   '])('refuses a blank secret %j', async (secret) => {
    const code = await captureSqlCode(
      prisma.$transaction((tx) => insertAdministrator(tx, { totpSecret: secret }))
    );
    expect(code).toBe('23514');
  });
});
