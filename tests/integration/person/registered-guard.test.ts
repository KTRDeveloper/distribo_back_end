import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const SCRATCH_TABLE = 'public.per_008_registered_guard';
const REGISTERED_ID = '0199a001-0000-7000-8000-000000000001';
const GUEST_ID = '0199a001-0000-7000-8000-000000000002';

type SqlError = {
  code?: string;
  message?: string;
  meta?: {
    code?: string;
    driverAdapterError?: {
      cause?: {
        code?: string;
        originalCode?: string;
        message?: string;
      };
    };
  };
};

/** Extracts PostgreSQL diagnostics from Prisma adapter errors. */
function sqlDiagnostics(error: unknown): { code?: string; message: string } {
  if (typeof error !== 'object' || error === null) return { message: String(error) };
  const candidate = error as SqlError;
  const cause = candidate.meta?.driverAdapterError?.cause;
  const message = [candidate.message, cause?.message].filter(Boolean).join(' ');
  const embeddedCode = message.match(/Code:\s*(\w+)/)?.[1];

  return {
    code: cause?.code ?? cause?.originalCode ?? candidate.meta?.code ?? candidate.code ?? embeddedCode,
    message,
  };
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${SCRATCH_TABLE} CASCADE`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE ${SCRATCH_TABLE} (
      id integer PRIMARY KEY,
      by_id uuid,
      payload text NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER per_008_registered_guard_trigger
    BEFORE INSERT OR UPDATE ON ${SCRATCH_TABLE}
    FOR EACH ROW EXECUTE FUNCTION require_registered_person('by_id')
  `);
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${SCRATCH_TABLE}`);
  await prisma.person.deleteMany({ where: { id: { in: [REGISTERED_ID, GUEST_ID] } } });
  await prisma.person.createMany({
    data: [
      {
        id: REGISTERED_ID,
        fullName: 'Registered Test Person',
        phoneNumber: '+2250700008001',
        phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
        registeredAt: new Date('2026-01-01T00:00:00.000Z'),
        preferredLanguage: 'FR',
      },
      {
        id: GUEST_ID,
        phoneNumber: '+2250700008002',
      },
    ],
  });
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${SCRATCH_TABLE} CASCADE`);
  await prisma.person.deleteMany({ where: { id: { in: [REGISTERED_ID, GUEST_ID] } } });
});

describe('require_registered_person trigger function', () => {
  it('accepts a registered author', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO ${SCRATCH_TABLE} (id, by_id, payload) VALUES (1, '${REGISTERED_ID}', 'created')`
      )
    ).resolves.toBe(1);
  });

  it('refuses a guest and names the author column', async () => {
    let caught: unknown;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO ${SCRATCH_TABLE} (id, by_id, payload) VALUES (2, '${GUEST_ID}', 'crafted')`
      );
    } catch (error) {
      caught = error;
    }

    const diagnostics = sqlDiagnostics(caught);
    expect(diagnostics.code).toBe('23514');
    expect(diagnostics.message).toContain('by_id');
  });

  it('skips a null author', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO ${SCRATCH_TABLE} (id, by_id, payload) VALUES (3, NULL, 'system')`
      )
    ).resolves.toBe(1);
  });

  it('skips an unchanged author on update but refuses changing it to a guest', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${SCRATCH_TABLE} (id, by_id, payload) VALUES (4, '${REGISTERED_ID}', 'created')`
    );
    await prisma.person.update({
      where: { id: REGISTERED_ID },
      data: {
        status: 'ANONYMIZED',
        anonymizedAt: new Date('2026-02-01T00:00:00.000Z'),
        fullName: null,
        releasedPhoneNumber: '+2250700008001',
        phoneNumber: null,
        phoneVerifiedAt: null,
        passwordHash: null,
        preferredLanguage: null,
      },
    });

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE ${SCRATCH_TABLE} SET payload = 'updated' WHERE id = 4`
      )
    ).resolves.toBe(1);

    let caught: unknown;
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE ${SCRATCH_TABLE} SET by_id = '${GUEST_ID}' WHERE id = 4`
      );
    } catch (error) {
      caught = error;
    }

    const diagnostics = sqlDiagnostics(caught);
    expect(diagnostics.code).toBe('23514');
    expect(diagnostics.message).toContain('by_id');
  });
});
