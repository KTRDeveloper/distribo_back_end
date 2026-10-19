import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const ORG_ID = '0199c021-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199c021-0000-7000-8000-000000000002';
const PERSON_ID = '0199c021-0000-7000-8000-0000000000a1';
const PHONE_1 = '+237677000001';
const PHONE_2 = '+237677000002';
const PHONE_3 = '+237677000003';
const PHONE_4 = '+237677000004';

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

let counter = 0;
function newId(): string {
  counter += 1;
  return `0199c021-1000-7000-8000-${String(counter).padStart(12, '0')}`;
}

type ContactInput = {
  org?: string;
  kind?: string;
  slot?: number | null;
  value?: string;
  verifiedAt?: Date | null;
  method?: string | null;
  createdBy?: string | null;
};

/** Inserts one contact; unset fields default to a valid PHONE slot 1 row. */
function insertContact(input: ContactInput = {}) {
  const kind = input.kind ?? 'PHONE';
  const slot = input.slot === undefined ? (kind === 'PHONE' ? 1 : null) : input.slot;
  const value = input.value ?? (kind === 'PHONE' ? PHONE_1 : 'shop@example.cm');
  const verifiedAt = input.verifiedAt ?? null;
  const method = input.method ?? null;
  const createdBy = input.createdBy === undefined ? PERSON_ID : input.createdBy;
  return prisma.$executeRaw`
    INSERT INTO organization_contacts
      (id, organization_id, kind, slot, value, verified_at, verification_method, created_by_id)
    VALUES (${newId()}::uuid, ${input.org ?? ORG_ID}::uuid,
      ${kind}::text::public."OrganizationContactKind", ${slot}::int, ${value},
      ${verifiedAt}::timestamptz,
      ${method}::text::public."ContactVerificationMethod", ${createdBy}::uuid)
  `;
}

async function clean() {
  await prisma.$executeRaw`
    DELETE FROM organization_contacts WHERE organization_id IN (${ORG_ID}::uuid, ${OTHER_ORG_ID}::uuid)
  `;
  await prisma.$executeRaw`
    DELETE FROM organizations WHERE id IN (${ORG_ID}::uuid, ${OTHER_ORG_ID}::uuid)
  `;
  await prisma.$executeRaw`DELETE FROM people WHERE id = ${PERSON_ID}::uuid`;
}

beforeEach(async () => {
  await clean();
  await prisma.$executeRaw`
    INSERT INTO people (id, phone_number, created_at, server_updated_at)
    VALUES (${PERSON_ID}::uuid, '+237677099021', now(), now())
  `;
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${ORG_ID}::uuid, 'Fixture Business'), (${OTHER_ORG_ID}::uuid, 'Other Business')
  `;
});

afterAll(clean);

describe('organization_contacts table', () => {
  it('AC-1 applies defaults', async () => {
    await insertContact();
    const [row] = await prisma.$queryRaw<
      Array<{
        verified_at: Date | null;
        verification_method: string | null;
        deleted_at: Date | null;
        server_updated_at: Date;
        created_at: Date;
      }>
    >`
      SELECT verified_at, verification_method::text AS verification_method, deleted_at,
        server_updated_at, created_at
      FROM organization_contacts WHERE organization_id = ${ORG_ID}::uuid
    `;
    expect(row).toMatchObject({ verified_at: null, verification_method: null, deleted_at: null });
    expect(row.server_updated_at).toBeInstanceOf(Date);
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('moves server_updated_at forward on update', async () => {
    await insertContact();
    const read = () =>
      prisma.$queryRaw<Array<{ server_updated_at: Date }>>`
        SELECT server_updated_at FROM organization_contacts WHERE organization_id = ${ORG_ID}::uuid
      `;
    const [before] = await read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await prisma.$executeRaw`
      UPDATE organization_contacts SET deleted_at = now() WHERE organization_id = ${ORG_ID}::uuid
    `;
    const [after] = await read();
    expect(after.server_updated_at.getTime()).toBeGreaterThan(before.server_updated_at.getTime());
  });

  describe('AC-2 row rules', () => {
    const cases: Array<[string, ContactInput]> = [
      ['PHONE without slot', { kind: 'PHONE', slot: null }],
      ['EMAIL with a slot', { kind: 'EMAIL', slot: 1 }],
      ['PHONE with slot 4', { kind: 'PHONE', slot: 4 }],
      ['PHONE with slot 0', { kind: 'PHONE', slot: 0 }],
      ['PHONE value without +', { kind: 'PHONE', value: '677000001' }],
      ['PHONE value with letters', { kind: 'PHONE', value: '+23767700000a' }],
      ['EMAIL value Shop@Example.cm', { kind: 'EMAIL', value: 'Shop@Example.cm' }],
      ['verified_at set without verification_method', { verifiedAt: new Date() }],
      ['verification_method set without verified_at', { method: 'CODE' }],
    ];
    it.each(cases)('rejects %s with 23514', async (_name, input) => {
      expect(await captureSqlCode(insertContact(input))).toBe('23514');
    });

    it('accepts a verified contact with its method', async () => {
      await expect(insertContact({ verifiedAt: new Date(), method: 'OWNER_PHONE' })).resolves.toBe(
        1
      );
    });

    it('accepts a lower case EMAIL without a slot', async () => {
      await expect(insertContact({ kind: 'EMAIL' })).resolves.toBe(1);
    });
  });

  describe('AC-3 uniqueness among live rows', () => {
    beforeEach(async () => {
      await insertContact({ slot: 1, value: PHONE_1 });
    });

    it('rejects the same organization, slot 1, another number with 23505', async () => {
      expect(await captureSqlCode(insertContact({ slot: 1, value: PHONE_2 }))).toBe('23505');
    });

    it('rejects the same organization, slot 2, the same number with 23505', async () => {
      expect(await captureSqlCode(insertContact({ slot: 2, value: PHONE_1 }))).toBe('23505');
    });

    it('accepts another organization, slot 1, the same number', async () => {
      await expect(insertContact({ org: OTHER_ORG_ID, slot: 1, value: PHONE_1 })).resolves.toBe(1);
    });

    it('rejects a second EMAIL with 23505', async () => {
      await insertContact({ kind: 'EMAIL', value: 'shop@example.cm' });
      expect(await captureSqlCode(insertContact({ kind: 'EMAIL', value: 'other@example.cm' }))).toBe(
        '23505'
      );
    });

    it('accepts an EMAIL in each of two organizations', async () => {
      await insertContact({ kind: 'EMAIL', value: 'shop@example.cm' });
      await expect(
        insertContact({ org: OTHER_ORG_ID, kind: 'EMAIL', value: 'shop@example.cm' })
      ).resolves.toBe(1);
    });
  });

  describe('AC-4 a deleted contact frees its place', () => {
    it('accepts a new contact on the freed slot with the same number', async () => {
      await insertContact({ slot: 1, value: PHONE_1 });
      await prisma.$executeRaw`
        UPDATE organization_contacts SET deleted_at = now() WHERE organization_id = ${ORG_ID}::uuid
      `;
      await expect(insertContact({ slot: 1, value: PHONE_1 })).resolves.toBe(1);
    });

    it('frees the single EMAIL place too', async () => {
      await insertContact({ kind: 'EMAIL', value: 'shop@example.cm' });
      await prisma.$executeRaw`
        UPDATE organization_contacts SET deleted_at = now() WHERE organization_id = ${ORG_ID}::uuid
      `;
      await expect(insertContact({ kind: 'EMAIL', value: 'shop@example.cm' })).resolves.toBe(1);
    });
  });

  describe('required columns, enums and keys', () => {
    it.each(['organization_id', 'kind', 'value', 'created_by_id'])(
      'rejects a null %s with 23502',
      async (column) => {
        let operation: Promise<unknown>;
        if (column === 'created_by_id') {
          operation = insertContact({ createdBy: null });
        } else if (column === 'organization_id') {
          operation = prisma.$executeRaw`
            INSERT INTO organization_contacts (id, organization_id, kind, slot, value, created_by_id)
            VALUES (${newId()}::uuid, NULL, 'PHONE', 1, ${PHONE_1}, ${PERSON_ID}::uuid)
          `;
        } else if (column === 'kind') {
          operation = prisma.$executeRaw`
            INSERT INTO organization_contacts (id, organization_id, kind, slot, value, created_by_id)
            VALUES (${newId()}::uuid, ${ORG_ID}::uuid, NULL, 1, ${PHONE_1}, ${PERSON_ID}::uuid)
          `;
        } else {
          operation = prisma.$executeRaw`
            INSERT INTO organization_contacts (id, organization_id, kind, slot, value, created_by_id)
            VALUES (${newId()}::uuid, ${ORG_ID}::uuid, 'PHONE', 1, NULL, ${PERSON_ID}::uuid)
          `;
        }
        expect(await captureSqlCode(operation)).toBe('23502');
      }
    );

    it('rejects an unknown kind with 22P02', async () => {
      expect(await captureSqlCode(insertContact({ kind: 'FAX', slot: null }))).toBe('22P02');
    });

    it('rejects an unknown verification method with 22P02', async () => {
      expect(
        await captureSqlCode(insertContact({ verifiedAt: new Date(), method: 'MAGIC' }))
      ).toBe('22P02');
    });

    it('rejects an unknown organization with 23503', async () => {
      expect(
        await captureSqlCode(insertContact({ org: '0199c021-0000-7000-8000-0000000000ff' }))
      ).toBe('23503');
    });

    it('rejects an unknown creator with 23503', async () => {
      expect(
        await captureSqlCode(insertContact({ createdBy: '0199c021-0000-7000-8000-0000000000fe' }))
      ).toBe('23503');
    });
  });

  it('uses uuid ids and timestamptz dates (C-01)', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'organization_contacts'
    `;
    const byName = Object.fromEntries(columns.map((c) => [c.column_name, c.data_type]));
    for (const name of ['id', 'organization_id', 'created_by_id']) {
      expect(byName[name]).toBe('uuid');
    }
    for (const name of ['verified_at', 'created_at', 'server_updated_at', 'deleted_at']) {
      expect(byName[name]).toBe('timestamp with time zone');
    }
    expect(byName.slot).toBe('integer');
  });

  describe('AB-1 slot overflow', () => {
    it('rejects a fourth number once slots 1, 2 and 3 are taken', async () => {
      await insertContact({ slot: 1, value: PHONE_1 });
      await insertContact({ slot: 2, value: PHONE_2 });
      await insertContact({ slot: 3, value: PHONE_3 });
      // Slot 4 is out of range; any reused slot collides with a live row.
      expect(await captureSqlCode(insertContact({ slot: 4, value: PHONE_4 }))).toBe('23514');
      expect(await captureSqlCode(insertContact({ slot: 3, value: PHONE_4 }))).toBe('23505');
    });
  });
});
