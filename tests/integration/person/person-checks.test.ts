import { describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const validPhone = '+237677123456';

/** Extracts the PostgreSQL SQLSTATE preserved by Prisma raw-query errors. */
function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as {
    code?: string;
    meta?: { code?: string };
    message?: string;
  };
  return (
    JSON.stringify(error).match(/\b(23505|23514)\b/)?.[1] ??
    candidate.message?.match(/\b(23505|23514)\b/)?.[1] ??
    candidate.meta?.code ??
    candidate.code
  );
}

/** Inserts a person through SQL so database constraints are tested without application validation. */
async function insertPerson(data: {
  id?: string;
  phoneNumber?: string | null;
  releasedPhoneNumber?: string | null;
  fullName?: string | null;
  passwordHash?: string | null;
  phoneVerifiedAt?: Date | null;
  email?: string | null;
  emailVerifiedAt?: Date | null;
  registeredAt?: Date | null;
  status?: 'ACTIVE' | 'SUSPENDED' | 'ANONYMIZED';
}): Promise<void> {
  const id = data.id ?? crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO people (
      id, phone_number, released_phone_number, full_name, password_hash,
      phone_verified_at, email, email_verified_at, registered_at, status,
      created_at, server_updated_at, scope_version
    ) VALUES (
      ${id}, ${data.phoneNumber ?? null}, ${data.releasedPhoneNumber ?? null},
      ${data.fullName ?? null}, ${data.passwordHash ?? null},
      ${data.phoneVerifiedAt ?? null}, ${data.email ?? null},
      ${data.emailVerifiedAt ?? null}, ${data.registeredAt ?? null},
      ${data.status ?? 'ACTIVE'}::public."PersonStatus", NOW(), NOW(), 0
    )
  `;
}

async function expectConstraintViolation(
  data: Parameters<typeof insertPerson>[0],
  code = '23514'
): Promise<void> {
  try {
    await insertPerson(data);
    throw new Error('expected database constraint violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected database constraint violation') {
      throw error;
    }
    expect(postgresCode(error)).toBe(code);
  }
}

describe('Person integrity checks', () => {
  it('enforces E.164 and exactly one current or released phone number', async () => {
    await expect(insertPerson({ phoneNumber: validPhone })).resolves.toBeUndefined();
    await expect(insertPerson({ releasedPhoneNumber: validPhone })).resolves.toBeUndefined();
    await expectConstraintViolation({
      phoneNumber: validPhone,
      releasedPhoneNumber: '+237677123457',
    });
    await expectConstraintViolation({});
    await expectConstraintViolation({ phoneNumber: '0677123456' });
    await expectConstraintViolation({ releasedPhoneNumber: '0677123456' });
    await expectConstraintViolation({ phoneNumber: validPhone, status: 'ANONYMIZED' });
  });

  it('requires registered non-anonymized people to be complete', async () => {
    const registeredAt = new Date();
    const verifiedAt = new Date();
    await expect(
      insertPerson({
        phoneNumber: validPhone,
        fullName: 'A valid person',
        passwordHash: 'argon2-hash',
        phoneVerifiedAt: verifiedAt,
        registeredAt,
      })
    ).resolves.toBeUndefined();
    await expectConstraintViolation({
      phoneNumber: validPhone,
      passwordHash: 'hash',
      phoneVerifiedAt: verifiedAt,
      registeredAt,
    });
    await expectConstraintViolation({
      phoneNumber: validPhone,
      fullName: 'A person',
      phoneVerifiedAt: verifiedAt,
      registeredAt,
    });
    await expectConstraintViolation({
      phoneNumber: validPhone,
      fullName: 'A person',
      passwordHash: 'hash',
      registeredAt,
    });
    await expect(
      insertPerson({ status: 'ANONYMIZED', releasedPhoneNumber: validPhone, registeredAt })
    ).resolves.toBeUndefined();
    await expectConstraintViolation({
      releasedPhoneNumber: validPhone,
      phoneVerifiedAt: verifiedAt,
    });
    await expectConstraintViolation({ phoneNumber: validPhone, registeredAt });
  });

  it('keeps email verification dates consistent and uniquely assigns verified emails', async () => {
    await expectConstraintViolation({ phoneNumber: validPhone, emailVerifiedAt: new Date() });
    await expectConstraintViolation({
      phoneNumber: validPhone,
      email: '',
      emailVerifiedAt: new Date(),
    });
    const email = 'person@example.test';
    await expect(
      insertPerson({ phoneNumber: validPhone, email, emailVerifiedAt: new Date() })
    ).resolves.toBeUndefined();
    await expectConstraintViolation(
      { phoneNumber: '+237677123457', email: email.toUpperCase(), emailVerifiedAt: new Date() },
      '23505'
    );
  });

  it('permits an unverified active phone number and email before registration', async () => {
    await expect(
      insertPerson({
        phoneNumber: '+237677123458',
        email: 'unverified@example.test',
      })
    ).resolves.toBeUndefined();
  });

  it('rejects a registered person without a password hash through raw SQL', async () => {
    await expectConstraintViolation({
      phoneNumber: validPhone,
      fullName: 'Registered person',
      phoneVerifiedAt: new Date(),
      registeredAt: new Date(),
    });
  });
});
