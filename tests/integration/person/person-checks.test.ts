import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { newId } from '../../../src/shared/ids';
import { seedAccount } from '../../helpers/database';
import { prisma } from '../../setup';

const validPhone = '+237677123456';
const personChecksMigrationSql = readFileSync(
  resolve(process.cwd(), 'prisma/migrations/20261002060000_per_003_person_checks/migration.sql'),
  'utf8'
);
const uuidMigrationSql = readFileSync(
  resolve(process.cwd(), 'prisma/migrations/20261003060000_fnd_011_person_uuid/migration.sql'),
  'utf8'
);
const unicodeWhitespaceMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261003061000_fnd_011_person_unicode_whitespace/migration.sql'
  ),
  'utf8'
);

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

async function withMigrationSandbox(
  run: (client: Client, schema: string) => Promise<void>
): Promise<void> {
  const schema = `fnd_011_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(`CREATE TYPE "PersonStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ANONYMIZED')`);
    await client.query(`
      CREATE TABLE people (
        id uuid PRIMARY KEY,
        phone_number text,
        released_phone_number text,
        full_name text,
        password_hash text,
        phone_verified_at timestamptz,
        email text,
        email_verified_at timestamptz,
        registered_at timestamptz,
        status "PersonStatus" NOT NULL DEFAULT 'ACTIVE',
        CONSTRAINT people_email_key UNIQUE (email)
      )
    `);
    await run(client, schema);
  } finally {
    await client.query('ROLLBACK');
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

async function expectMigrationFailure(
  client: Client,
  migrationSql: string,
  id: string,
  privateValues: string[]
): Promise<void> {
  try {
    await client.query(migrationSql);
    throw new Error('expected migration preflight failure');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected migration preflight failure')
      throw error;
    expect(error).toMatchObject({ code: '23514' });
    expect((error as Error).message).toContain(id);
    for (const value of privateValues) expect((error as Error).message).not.toContain(value);
  }
}

async function withUuidMigrationSandbox(run: (client: Client) => Promise<void>): Promise<void> {
  const schema = `fnd_011_uuid_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE people (id text PRIMARY KEY);
      CREATE TABLE tasks (
        id text PRIMARY KEY,
        "accountId" text NOT NULL,
        CONSTRAINT "tasks_accountId_fkey" FOREIGN KEY ("accountId")
          REFERENCES people(id) ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE phone_number_change_logs (
        id uuid PRIMARY KEY,
        person_id text NOT NULL,
        CONSTRAINT phone_number_change_logs_person_id_fkey FOREIGN KEY (person_id)
          REFERENCES people(id) ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await run(client);
  } finally {
    await client.query('ROLLBACK');
    await client.query('RESET search_path');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

describe('Person integrity checks', () => {
  it('preflights non-UUID Person ids and rolls back reference conversion', async () => {
    await withUuidMigrationSandbox(async (client) => {
      const invalidId = 'legacy-person-id';
      await client.query('INSERT INTO people (id) VALUES ($1)', [invalidId]);
      await client.query('INSERT INTO tasks (id, "accountId") VALUES ($1, $2)', [
        'legacy-task-id',
        invalidId,
      ]);
      await client.query('INSERT INTO phone_number_change_logs (id, person_id) VALUES ($1, $2)', [
        randomUUID(),
        invalidId,
      ]);

      await expectMigrationFailure(client, uuidMigrationSql, invalidId, ['legacy-task-id']);
      await client.query('ROLLBACK');

      const columns = await client.query<{
        table_name: string;
        column_name: string;
        data_type: string;
      }>(
        `SELECT table_name, column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND (table_name, column_name) IN (
             ('people', 'id'),
             ('tasks', 'accountId'),
             ('phone_number_change_logs', 'person_id')
           )
         ORDER BY table_name, column_name`
      );
      expect(columns.rows).toEqual([
        { table_name: 'people', column_name: 'id', data_type: 'text' },
        { table_name: 'phone_number_change_logs', column_name: 'person_id', data_type: 'text' },
        { table_name: 'tasks', column_name: 'accountId', data_type: 'text' },
      ]);

      const foreignKeys = await client.query<{ constraint_name: string }>(
        `SELECT constraint_name
         FROM information_schema.table_constraints
         WHERE constraint_schema = current_schema()
           AND constraint_type = 'FOREIGN KEY'
         ORDER BY constraint_name`
      );
      expect(foreignKeys.rows).toEqual([
        { constraint_name: 'phone_number_change_logs_person_id_fkey' },
        { constraint_name: 'tasks_accountId_fkey' },
      ]);
    });
  });

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

  it.each([' \t\n', '  ', ' '])(
    'rejects required and verified text containing only whitespace: %j',
    async (whitespace) => {
      await withMigrationSandbox(async (client) => {
        await client.query(personChecksMigrationSql);
        await client.query(unicodeWhitespaceMigrationSql);
        await expect(
          client.query(
            `INSERT INTO people
               (id, phone_number, full_name, password_hash, phone_verified_at, registered_at)
             VALUES ($1, $2, $3, 'hash', NOW(), NOW())`,
            [randomUUID(), validPhone, whitespace]
          )
        ).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK');
        await client.query('BEGIN');
        await expect(
          client.query(
            `INSERT INTO people
               (id, phone_number, full_name, password_hash, phone_verified_at, registered_at)
             VALUES ($1, $2, 'Person', $3, NOW(), NOW())`,
            [randomUUID(), validPhone, whitespace]
          )
        ).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK');
        await client.query('BEGIN');
        await expect(
          client.query(
            `INSERT INTO people (id, phone_number, email, email_verified_at)
             VALUES ($1, $2, $3, NOW())`,
            [randomUUID(), validPhone, whitespace]
          )
        ).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK');
      });
    }
  );

  it('accepts ordinary required and verified text', async () => {
    await expect(
      insertPerson({
        phoneNumber: validPhone,
        fullName: 'Ordinary Person',
        passwordHash: 'ordinary-hash',
        phoneVerifiedAt: new Date(),
        registeredAt: new Date(),
        email: 'ordinary@example.test',
        emailVerifiedAt: new Date(),
      })
    ).resolves.toBeUndefined();
  });

  it('uses UUIDv7 person fixture identifiers', async () => {
    const person = await seedAccount({
      email: `fixture-${newId()}@example.test`,
      password: 'fixture password',
      name: 'Fixture Person',
    });

    expect(person.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('allows duplicate unverified emails but rejects verifying both', async () => {
    const email = 'duplicate-unverified@example.test';
    await insertPerson({ phoneNumber: validPhone, email });
    await insertPerson({ phoneNumber: '+237677123457', email: email.toUpperCase() });
    await prisma.$executeRaw`UPDATE people SET email_verified_at = NOW() WHERE phone_number = ${validPhone}`;

    try {
      await prisma.$executeRaw`
        UPDATE people SET email_verified_at = NOW() WHERE phone_number = '+237677123457'
      `;
      throw new Error('expected verified email uniqueness violation');
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'expected verified email uniqueness violation'
      ) {
        throw error;
      }
      expect(postgresCode(error)).toBe('23505');
    }
  });

  it('audits dirty rows before enforcement and leaves the schema unchanged', async () => {
    await withMigrationSandbox(async (client) => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO people (id, phone_number, full_name) VALUES ($1, 'invalid phone', 'Private Person')`,
        [id]
      );
      await expectMigrationFailure(client, personChecksMigrationSql, id, [
        'invalid phone',
        'Private Person',
      ]);
      await client.query('ROLLBACK');

      const constraint = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_constraint
         WHERE conrelid = 'people'::regclass AND conname = 'people_phone_number_e164_check'`
      );
      expect(constraint.rows[0]?.count).toBe('0');
      await expect(
        client.query(`INSERT INTO people (id, phone_number) VALUES ($1, 'invalid phone')`, [
          randomUUID(),
        ])
      ).resolves.toBeDefined();
    });
  });

  it.each([
    {
      category: 'completeness',
      insert: `INSERT INTO people
        (id, phone_number, full_name, phone_verified_at, registered_at)
        VALUES ($1, $2, 'Private Person', NOW(), NOW())`,
      values: ['Private Person'],
    },
    {
      category: 'verification',
      insert: `INSERT INTO people (id, released_phone_number, phone_verified_at)
        VALUES ($1, $2, NOW())`,
      values: [],
    },
    {
      category: 'nonblank text',
      insert: `INSERT INTO people
        (id, phone_number, full_name, password_hash, phone_verified_at, registered_at)
        VALUES ($1, $2, '   ', 'private-hash', NOW(), NOW())`,
      values: ['private-hash'],
    },
  ])('preflights $category violations and rolls back every schema change', async (testCase) => {
    await withMigrationSandbox(async (client) => {
      const id = randomUUID();
      await client.query(testCase.insert, [id, validPhone]);
      await expectMigrationFailure(client, personChecksMigrationSql, id, testCase.values);
      await client.query('ROLLBACK');

      const state = await client.query<{ row_count: string; constraint_count: string }>(
        `SELECT
           (SELECT count(*)::text FROM people WHERE id = $1) AS row_count,
           (SELECT count(*)::text FROM pg_constraint
              WHERE conrelid = 'people'::regclass
                AND conname LIKE 'people_%_check') AS constraint_count`,
        [id]
      );
      expect(state.rows[0]).toEqual({ row_count: '1', constraint_count: '0' });
    });
  });

  it('preflights Unicode whitespace and preserves the previous checks', async () => {
    await withMigrationSandbox(async (client) => {
      await client.query(personChecksMigrationSql);
      const id = randomUUID();
      await client.query(
        `INSERT INTO people
           (id, phone_number, full_name, password_hash, phone_verified_at, registered_at)
         VALUES ($1, $2, $3, 'private-hash', NOW(), NOW())`,
        [id, validPhone, ' ']
      );
      await expectMigrationFailure(client, unicodeWhitespaceMigrationSql, id, ['private-hash']);
      await client.query('ROLLBACK');

      const state = await client.query<{ row_count: string; constraint_count: string }>(
        `SELECT
           (SELECT count(*)::text FROM people WHERE id = $1) AS row_count,
           (SELECT count(*)::text FROM pg_constraint
              WHERE conrelid = 'people'::regclass
                AND conname IN (
                  'people_registered_completeness_check',
                  'people_email_verification_check'
                )) AS constraint_count`,
        [id]
      );
      expect(state.rows[0]).toEqual({ row_count: '1', constraint_count: '2' });
    });
  });

  it('rolls back the email rule when verified lower-case emails collide', async () => {
    await withMigrationSandbox(async (client) => {
      const firstId = randomUUID();
      const secondId = randomUUID();
      await client.query(
        `INSERT INTO people
           (id, phone_number, email, email_verified_at)
         VALUES ($1, $2, 'collision@example.test', NOW()),
                ($3, $4, 'COLLISION@example.test', NOW())`,
        [firstId, validPhone, secondId, '+237677123457']
      );
      await expectMigrationFailure(client, personChecksMigrationSql, firstId, [
        'collision@example.test',
      ]);
      await client.query('ROLLBACK');

      const oldConstraint = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_constraint
         WHERE conrelid = 'people'::regclass AND conname = 'people_email_key'`
      );
      expect(oldConstraint.rows[0]?.count).toBe('1');
    });
  });

  it('atomically installs partial case-insensitive uniqueness for clean data', async () => {
    await withMigrationSandbox(async (client) => {
      await client.query(personChecksMigrationSql);
      const index = await client.query<{ predicate: string }>(
        `SELECT pg_get_expr(indpred, indrelid) AS predicate
         FROM pg_index
         WHERE indexrelid = 'people_verified_email_lower_unique'::regclass`
      );
      expect(index.rows[0]?.predicate).toContain('email_verified_at IS NOT NULL');

      await client.query(
        `INSERT INTO people (id, phone_number, email) VALUES ($1, $2, 'same@example.test'), ($3, $4, 'SAME@example.test')`,
        [randomUUID(), validPhone, randomUUID(), '+237677123457']
      );
      await client.query(`UPDATE people SET email_verified_at = NOW() WHERE phone_number = $1`, [
        validPhone,
      ]);
      await expect(
        client.query(`UPDATE people SET email_verified_at = NOW() WHERE phone_number = $1`, [
          '+237677123457',
        ])
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});
