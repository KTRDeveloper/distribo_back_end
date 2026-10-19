import { describe, expect, it } from 'vitest';
import { newId } from '../../../src/shared/ids';
import { prisma } from '../../setup';
import { uniquePhone } from '../../helpers/phone';

type Kind = 'registered' | 'guest' | 'anonymized';

/** Extracts the PostgreSQL SQLSTATE preserved by Prisma raw-query errors. */
function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { code?: string; meta?: { code?: string }; message?: string };
  return (
    JSON.stringify(error).match(/\b(23505|23514)\b/)?.[1] ??
    candidate.message?.match(/\b(23505|23514)\b/)?.[1] ??
    candidate.meta?.code ??
    candidate.code
  );
}

/** Inserts a person straight through SQL so only database rules are exercised. */
async function insertPerson(kind: Kind, avatarKey?: string | null): Promise<string> {
  const id = newId();
  const registered = kind === 'registered';
  const anonymized = kind === 'anonymized';
  const phone = anonymized ? null : uniquePhone();
  const released = anonymized ? uniquePhone() : null;
  const now = new Date();
  if (avatarKey === undefined) {
    await prisma.$executeRaw`
      INSERT INTO people (id, phone_number, released_phone_number, full_name, password_hash,
        phone_verified_at, registered_at, status, created_at, server_updated_at, scope_version)
      VALUES (${id}::uuid, ${phone}, ${released}, ${registered ? 'Test Person' : null},
        ${registered ? 'hash' : null}, ${registered ? now : null}, ${registered ? now : null},
        ${anonymized ? 'ANONYMIZED' : 'ACTIVE'}::public."PersonStatus", NOW(), NOW(), 0)
    `;
  } else {
    await prisma.$executeRaw`
      INSERT INTO people (id, phone_number, released_phone_number, full_name, password_hash,
        phone_verified_at, registered_at, status, avatar_key, created_at, server_updated_at,
        scope_version)
      VALUES (${id}::uuid, ${phone}, ${released}, ${registered ? 'Test Person' : null},
        ${registered ? 'hash' : null}, ${registered ? now : null}, ${registered ? now : null},
        ${anonymized ? 'ANONYMIZED' : 'ACTIVE'}::public."PersonStatus", ${avatarKey}, NOW(), NOW(), 0)
    `;
  }
  return id;
}

async function expectCode(run: () => Promise<unknown>, code: string): Promise<void> {
  let failure: unknown;
  try {
    await run();
  } catch (error) {
    failure = error;
  }
  expect(failure, 'expected a database error').toBeDefined();
  expect(postgresCode(failure)).toBe(code);
}

const keyOf = async (id: string): Promise<string | null> => {
  const rows = await prisma.$queryRaw<
    { avatar_key: string | null }[]
  >`SELECT avatar_key FROM people WHERE id = ${id}::uuid`;
  return rows[0].avatar_key;
};

describe('Person avatar_key rules', () => {
  it('is empty by default', async () => {
    const id = await insertPerson('registered');
    expect(await keyOf(id)).toBeNull();
  });

  it('accepts a key on a registered person and none', async () => {
    const id = await insertPerson('registered', `people/${newId()}.jpg`);
    expect(await keyOf(id)).not.toBeNull();
    await insertPerson('registered', null);
  });

  it('rejects a key on a guest or an anonymized person (23514)', async () => {
    await expectCode(() => insertPerson('guest', `people/${newId()}.jpg`), '23514');
    await expectCode(() => insertPerson('anonymized', `people/${newId()}.jpg`), '23514');
  });

  it('keeps one file for one person and allows many empty keys', async () => {
    const key = `people/${newId()}.jpg`;
    await insertPerson('registered', key);
    await expectCode(() => insertPerson('registered', key), '23505');
    await insertPerson('registered');
    await insertPerson('registered');
    await insertPerson('guest');
  });

  it('refuses to anonymize while the key stays, accepts when emptied', async () => {
    const id = await insertPerson('registered', `people/${newId()}.jpg`);
    await expectCode(
      () =>
        prisma.$executeRaw`UPDATE people SET status = 'ANONYMIZED'::public."PersonStatus",
          released_phone_number = phone_number, phone_number = NULL, phone_verified_at = NULL
          WHERE id = ${id}::uuid`,
      '23514'
    );
    await prisma.$executeRaw`UPDATE people SET status = 'ANONYMIZED'::public."PersonStatus",
      released_phone_number = phone_number, phone_number = NULL, phone_verified_at = NULL,
      avatar_key = NULL WHERE id = ${id}::uuid`;
    expect(await keyOf(id)).toBeNull();
  });

  it('rejects a raw update giving a key to a guest (AB-1)', async () => {
    const id = await insertPerson('guest');
    await expectCode(
      () =>
        prisma.$executeRaw`UPDATE people SET avatar_key = ${`people/${newId()}.jpg`} WHERE id = ${id}::uuid`,
      '23514'
    );
  });
});
