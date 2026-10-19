import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const ORG_ID = '0199c023-0000-7000-8000-000000000001';
const PERSON_ID = '0199c023-0000-7000-8000-0000000000a1';
const CONTACT_ID = '0199c023-0000-7000-8000-0000000000c1';
const UNKNOWN_CONTACT_ID = '0199c023-0000-7000-8000-0000000000ff';
const PHONE = '+237677000023';

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

/** Inserts a challenge straight in the database, with or without a contact id. */
function insertChallenge(purpose: string, contactId: string | null) {
  return prisma.$executeRaw`
    INSERT INTO otp_challenges
      (id, person_id, target, purpose, code_hash, expires_at, organization_contact_id)
    VALUES (gen_random_uuid(), ${PERSON_ID}::uuid, ${PHONE}, ${purpose}::"OtpPurpose", 'hash',
            now() + interval '5 minutes', ${contactId}::uuid)`;
}

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges WHERE person_id = ${PERSON_ID}::uuid`;
  await prisma.$executeRaw`DELETE FROM organization_contacts WHERE organization_id = ${ORG_ID}::uuid`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`;
  await prisma.$executeRaw`DELETE FROM people WHERE id = ${PERSON_ID}::uuid`;
}

beforeEach(async () => {
  await clean();
  await prisma.$executeRaw`
    INSERT INTO people (id, phone_number, created_at, server_updated_at)
    VALUES (${PERSON_ID}::uuid, '+237677099023', now(), now())`;
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')`;
  await prisma.$executeRaw`
    INSERT INTO organization_contacts (id, organization_id, kind, slot, value, created_by_id)
    VALUES (${CONTACT_ID}::uuid, ${ORG_ID}::uuid, 'PHONE'::"OrganizationContactKind", 1, ${PHONE},
            ${PERSON_ID}::uuid)`;
});

afterAll(clean);

describe('otp_challenges.organization_contact_id', () => {
  it('AC-1 id and purpose go together', async () => {
    await expect(insertChallenge('ORG_CONTACT_VERIFICATION', CONTACT_ID)).resolves.toBe(1);
    expect(await captureSqlCode(insertChallenge('ORG_CONTACT_VERIFICATION', null))).toBe('23514');
    expect(await captureSqlCode(insertChallenge('LOGIN', CONTACT_ID))).toBe('23514');
    await expect(insertChallenge('LOGIN', null)).resolves.toBe(1);
  });

  it('AC-2 the contact must exist', async () => {
    expect(await captureSqlCode(insertChallenge('ORG_CONTACT_VERIFICATION', UNKNOWN_CONTACT_ID))).toBe(
      '23503'
    );
  });

  it('AB-1 a login code cannot carry a contact id', async () => {
    expect(await captureSqlCode(insertChallenge('LOGIN', CONTACT_ID))).toBe('23514');
    const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM otp_challenges WHERE person_id = ${PERSON_ID}::uuid`;
    expect(Number(row.n)).toBe(0);
  });
});
