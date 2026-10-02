import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import { getAppRolePrisma } from '../../helpers/app-role';

const appPrisma = getAppRolePrisma();
const PERSON_IDS = [
  '01990000-0000-7000-8000-000000000001',
  '01990000-0000-7000-8000-000000000002',
  '01990000-0000-7000-8000-000000000003',
  '01990000-0000-7000-8000-000000000004',
  '01990000-0000-7000-8000-000000000005',
] as const;
const LOG_IDS = [
  '01990000-0000-7000-8000-000000000101',
  '01990000-0000-7000-8000-000000000102',
  '01990000-0000-7000-8000-000000000103',
  '01990000-0000-7000-8000-000000000104',
  '01990000-0000-7000-8000-000000000105',
] as const;

type SqlError = {
  code?: string;
  message?: string;
  meta?: {
    code?: string;
    driverAdapterError?: {
      cause?: {
        code?: string;
        originalCode?: string;
      };
    };
  };
};

function sqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as SqlError;

  return (
    candidate.meta?.driverAdapterError?.cause?.code ??
    candidate.meta?.driverAdapterError?.cause?.originalCode ??
    candidate.meta?.code ??
    candidate.code ??
    candidate.message?.match(/Code:\s*(\w+)/)?.[1]
  );
}

async function createPerson(id: string): Promise<void> {
  const phoneNumber = `+237677${id.slice(-6)}`;
  await prisma.$executeRaw`
    INSERT INTO people (id, phone_number, created_at)
    VALUES (${id}::uuid, ${phoneNumber}, now())
  `;
}

async function expectSqlState(statement: Promise<unknown>, expected: string): Promise<void> {
  await expect(statement).rejects.toSatisfy((error: unknown) => sqlState(error) === expected);
}

afterEach(async () => {
  await prisma.$executeRaw`DELETE FROM phone_number_change_logs
    WHERE person_id = ANY(${[...PERSON_IDS]}::text[])`;
  await prisma.$executeRaw`DELETE FROM people WHERE id = ANY(${[...PERSON_IDS]}::text[])`;
});

afterAll(async () => {
  await appPrisma.$disconnect();
});

describe('phone number change journal', () => {
  it('allows the application role to insert and read a complete row with server time', async () => {
    const personId = PERSON_IDS[0];
    const logId = LOG_IDS[0];
    const verifiedAt = new Date('2026-01-02T03:04:05.000Z');
    const changedAt = new Date('2026-01-02T03:05:06.000Z');
    await createPerson(personId);

    await appPrisma.$executeRaw`
      INSERT INTO phone_number_change_logs (
        id, person_id, old_phone_number, new_phone_number, verified_at, changed_at
      ) VALUES (
        ${logId}::uuid, ${personId}, '+237677123456', '+237699000111',
        ${verifiedAt}, ${changedAt}
      )
    `;

    const rows = await appPrisma.$queryRaw<
      Array<{
        id: string;
        person_id: string;
        old_phone_number: string;
        new_phone_number: string;
        verified_at: Date;
        changed_at: Date;
        server_updated_at: Date;
        deleted_at: Date | null;
      }>
    >`
      SELECT id, person_id, old_phone_number, new_phone_number, verified_at, changed_at,
             server_updated_at, deleted_at
      FROM phone_number_change_logs
      WHERE id = ${logId}::uuid
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: logId,
      person_id: personId,
      old_phone_number: '+237677123456',
      new_phone_number: '+237699000111',
      verified_at: verifiedAt,
      changed_at: changedAt,
      deleted_at: null,
    });
    expect(Math.abs(Date.now() - rows[0].server_updated_at.getTime())).toBeLessThan(5_000);
  });

  it('rejects incomplete rows through NOT NULL constraints', async () => {
    const personId = PERSON_IDS[1];
    await createPerson(personId);

    await expectSqlState(
      appPrisma.$executeRaw`
        INSERT INTO phone_number_change_logs (
          id, person_id, old_phone_number, new_phone_number, verified_at
        ) VALUES (
          ${LOG_IDS[1]}::uuid, ${personId}, '+237677123456', '+237699000111', now()
        )
      `,
      '23502'
    );
  });

  it('denies UPDATE, DELETE, and TRUNCATE to the application role and preserves history', async () => {
    const personId = PERSON_IDS[2];
    const logId = LOG_IDS[2];
    await createPerson(personId);
    await appPrisma.$executeRaw`
      INSERT INTO phone_number_change_logs (
        id, person_id, old_phone_number, new_phone_number, verified_at, changed_at
      ) VALUES (
        ${logId}::uuid, ${personId}, '+237677123456', '+237699000111', now(), now()
      )
    `;

    await expectSqlState(
      appPrisma.$executeRaw`
        UPDATE phone_number_change_logs
        SET new_phone_number = '+237688000222'
        WHERE id = ${logId}::uuid
      `,
      '42501'
    );
    await expectSqlState(
      appPrisma.$executeRaw`DELETE FROM phone_number_change_logs WHERE id = ${logId}::uuid`,
      '42501'
    );
    await expectSqlState(appPrisma.$executeRaw`TRUNCATE TABLE phone_number_change_logs`, '42501');

    const unchanged = await prisma.$queryRaw<Array<{ new_phone_number: string }>>`
      SELECT new_phone_number FROM phone_number_change_logs WHERE id = ${logId}::uuid
    `;
    expect(unchanged).toEqual([{ new_phone_number: '+237699000111' }]);
  });

  it.each([
    ['+237677123456', '+237699000111', true],
    ['677123456', '+237699000111', false],
    ['+237677123456', '0699000111', false],
  ])('validates old number %s and new number %s', async (oldNumber, newNumber, accepted) => {
    const personId = PERSON_IDS[3];
    const logId = LOG_IDS[3];
    await createPerson(personId);

    const insert = appPrisma.$executeRaw`
      INSERT INTO phone_number_change_logs (
        id, person_id, old_phone_number, new_phone_number, verified_at, changed_at
      ) VALUES (
        ${logId}::uuid, ${personId}, ${oldNumber}, ${newNumber}, now(), now()
      )
    `;

    if (accepted) {
      await expect(insert).resolves.toBe(1);
    } else {
      await expectSqlState(insert, '23514');
    }
  });

  it('rejects a reference to a missing person', async () => {
    await expectSqlState(
      appPrisma.$executeRaw`
        INSERT INTO phone_number_change_logs (
          id, person_id, old_phone_number, new_phone_number, verified_at, changed_at
        ) VALUES (
          ${LOG_IDS[4]}::uuid, ${PERSON_IDS[4]}::uuid,
          '+237677123456', '+237699000111', now(), now()
        )
      `,
      '23503'
    );
  });
});
