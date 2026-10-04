import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const SUPPLIER_ORG_ID = '0199c005-0000-7000-8000-000000000001';
const CUSTOMER_ORG_ID = '0199c005-0000-7000-8000-000000000002';
const OWNER_ID = '0199c005-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c005-0000-7000-8000-000000000012';
const SUPPLIER_PERSON_ID = '0199c005-0000-7000-8000-000000000013';
const REL_ID = '0199c005-0000-7000-8000-000000000021';
const OTHER_REL_ID = '0199c005-0000-7000-8000-000000000022';
const THIRD_REL_ID = '0199c005-0000-7000-8000-000000000023';

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

type Row = {
  id?: string;
  supplierOrganizationId?: string | null;
  supplierPersonId?: string | null;
  customerPersonId?: string | null;
  customerOrganizationId?: string | null;
  customerPhoneNumber?: string | null;
  customerLabel?: string | null;
  status?: string;
  endedByParty?: string | null;
  mergedIntoId?: string | null;
  deletedAt?: Date | null;
};

/**
 * Inserts a relationship. Defaults: supplier organization and customer person,
 * ACTIVE; pass null to leave a party column empty.
 */
function insertRelationship(row: Row = {}): Promise<number> {
  const pick = <K extends keyof Row>(key: K, fallback: Row[K]): Row[K] =>
    key in row ? row[key] : fallback;
  return prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, supplier_person_id, customer_person_id,
      customer_organization_id, customer_phone_number, customer_label, created_by_id,
      status, ended_by_party, merged_into_id, deleted_at
    )
    VALUES (
      ${row.id ?? REL_ID}::uuid,
      ${pick('supplierOrganizationId', SUPPLIER_ORG_ID)}::uuid,
      ${pick('supplierPersonId', null)}::uuid,
      ${pick('customerPersonId', CUSTOMER_ID)}::uuid,
      ${pick('customerOrganizationId', null)}::uuid,
      ${pick('customerPhoneNumber', null)}::text,
      ${pick('customerLabel', null)}::text,
      ${OWNER_ID}::uuid,
      ${row.status ?? 'ACTIVE'}::text::public."RelationshipStatus",
      ${pick('endedByParty', null)}::text::public."RelationshipParty",
      ${pick('mergedIntoId', null)}::uuid,
      ${pick('deletedAt', null)}::timestamptz
    )
  `;
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700005011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700005012',
        ...registered,
      },
      {
        id: SUPPLIER_PERSON_ID,
        fullName: 'Fixture Supplier Person',
        phoneNumber: '+2250700005013',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier'), (${CUSTOMER_ORG_ID}::uuid, 'Fixture Customer Business')
  `;
});

describe('parties (AC-1, C-06)', () => {
  it('accepts a supplier organization and a customer person', async () => {
    await expect(insertRelationship()).resolves.toBe(1);
  });

  it('rejects both supplier columns set with 23514', async () => {
    expect(await captureSqlCode(insertRelationship({ supplierPersonId: SUPPLIER_PERSON_ID }))).toBe(
      '23514'
    );
  });

  it('rejects no supplier with 23514', async () => {
    expect(await captureSqlCode(insertRelationship({ supplierOrganizationId: null }))).toBe(
      '23514'
    );
  });

  it('rejects a customer person and a customer organization with 23514', async () => {
    expect(
      await captureSqlCode(insertRelationship({ customerOrganizationId: CUSTOMER_ORG_ID }))
    ).toBe('23514');
  });

  it('accepts a counter with the customer_label "Client de passage"', async () => {
    await expect(
      insertRelationship({ customerPersonId: null, customerLabel: 'Client de passage' })
    ).resolves.toBe(1);
  });

  it('rejects a counter with an empty customer_label with 23514', async () => {
    expect(await captureSqlCode(insertRelationship({ customerPersonId: null }))).toBe('23514');
    expect(
      await captureSqlCode(insertRelationship({ customerPersonId: null, customerLabel: '' }))
    ).toBe('23514');
    expect(
      await captureSqlCode(insertRelationship({ customerPersonId: null, customerLabel: '   ' }))
    ).toBe('23514');
  });

  it('rejects customer_person_id and customer_phone_number both set with 23514', async () => {
    expect(
      await captureSqlCode(insertRelationship({ customerPhoneNumber: '+2250700005099' }))
    ).toBe('23514');
  });

  it('rejects the same organization as supplier and customer with 23514', async () => {
    expect(
      await captureSqlCode(
        insertRelationship({ customerPersonId: null, customerOrganizationId: SUPPLIER_ORG_ID })
      )
    ).toBe('23514');
  });
});

describe('pair rule (AC-2, C-07)', () => {
  const pairs: Array<[string, Row]> = [
    ['supplier organization, customer person', {}],
    [
      'supplier organization, customer organization',
      { customerPersonId: null, customerOrganizationId: CUSTOMER_ORG_ID },
    ],
    [
      'supplier person, customer person',
      {
        supplierOrganizationId: null,
        supplierPersonId: SUPPLIER_PERSON_ID,
        status: 'PENDING',
      },
    ],
    [
      'supplier person, customer organization',
      {
        supplierOrganizationId: null,
        supplierPersonId: SUPPLIER_PERSON_ID,
        customerPersonId: null,
        customerOrganizationId: CUSTOMER_ORG_ID,
        status: 'PENDING',
      },
    ],
  ];

  for (const [name, pair] of pairs) {
    it(`rejects a second live row for ${name} with 23505`, async () => {
      await insertRelationship({ ...pair, id: REL_ID });
      expect(await captureSqlCode(insertRelationship({ ...pair, id: OTHER_REL_ID }))).toBe('23505');
    });

    it(`accepts a second row for ${name} when the first is deleted`, async () => {
      await insertRelationship({ ...pair, id: REL_ID, deletedAt: new Date() });
      await expect(insertRelationship({ ...pair, id: OTHER_REL_ID })).resolves.toBe(1);
    });

    it(`accepts a second row for ${name} when the first is merged into another row`, async () => {
      await insertRelationship({
        id: THIRD_REL_ID,
        customerPersonId: null,
        customerLabel: 'Comptoir cible',
      });
      await insertRelationship({
        ...pair,
        id: REL_ID,
        deletedAt: new Date(),
        mergedIntoId: THIRD_REL_ID,
      });
      await expect(insertRelationship({ ...pair, id: OTHER_REL_ID })).resolves.toBe(1);
    });
  }

  it('lets the same customer have a live row with two different suppliers', async () => {
    await insertRelationship();
    await prisma.$executeRaw`
      INSERT INTO organizations (id, name) VALUES ('0199c005-0000-7000-8000-000000000003'::uuid, 'Other Supplier')
    `;
    await expect(
      insertRelationship({
        id: OTHER_REL_ID,
        supplierOrganizationId: '0199c005-0000-7000-8000-000000000003',
      })
    ).resolves.toBe(1);
  });
});

describe('two counters (AC-3, C-07)', () => {
  it('accepts two counters of one organization with different labels', async () => {
    await expect(
      insertRelationship({ id: REL_ID, customerPersonId: null, customerLabel: 'Comptoir usine' })
    ).resolves.toBe(1);
    await expect(
      insertRelationship({
        id: OTHER_REL_ID,
        customerPersonId: null,
        customerLabel: 'Comptoir ville',
      })
    ).resolves.toBe(1);
  });
});

describe('state rules (AC-4, C-08, C-09)', () => {
  const pendingSupplier = { supplierOrganizationId: null, supplierPersonId: SUPPLIER_PERSON_ID };

  it('accepts PENDING with a supplier person', async () => {
    await expect(insertRelationship({ ...pendingSupplier, status: 'PENDING' })).resolves.toBe(1);
  });

  it('rejects PENDING with a supplier organization with 23514', async () => {
    expect(await captureSqlCode(insertRelationship({ status: 'PENDING' }))).toBe('23514');
  });

  it('rejects ACTIVE with a supplier person with 23514', async () => {
    expect(await captureSqlCode(insertRelationship({ ...pendingSupplier, status: 'ACTIVE' }))).toBe(
      '23514'
    );
  });

  it('rejects ENDED with a supplier person with 23514', async () => {
    expect(
      await captureSqlCode(
        insertRelationship({ ...pendingSupplier, status: 'ENDED', endedByParty: 'CUSTOMER' })
      )
    ).toBe('23514');
  });

  it('accepts ENDED with ended_by_party CUSTOMER', async () => {
    await expect(insertRelationship({ status: 'ENDED', endedByParty: 'CUSTOMER' })).resolves.toBe(
      1
    );
  });

  it('rejects ENDED with ended_by_party empty with 23514', async () => {
    expect(await captureSqlCode(insertRelationship({ status: 'ENDED' }))).toBe('23514');
  });

  it('rejects ACTIVE with ended_by_party SUPPLIER with 23514', async () => {
    expect(await captureSqlCode(insertRelationship({ endedByParty: 'SUPPLIER' }))).toBe('23514');
  });

  it('rejects merged_into_id set and deleted_at empty with 23514', async () => {
    await insertRelationship({
      id: THIRD_REL_ID,
      customerPersonId: null,
      customerLabel: 'Comptoir',
    });
    expect(
      await captureSqlCode(
        insertRelationship({
          id: OTHER_REL_ID,
          customerPersonId: null,
          customerLabel: 'Autre',
          mergedIntoId: THIRD_REL_ID,
        })
      )
    ).toBe('23514');
  });

  it('enforces the rules on update as well as insert', async () => {
    await insertRelationship();
    expect(
      await captureSqlCode(
        prisma.$executeRaw`UPDATE customer_relationships SET status = 'ENDED' WHERE id = ${REL_ID}::uuid`
      )
    ).toBe('23514');
  });
});

describe('crafted duplicate (AB-1)', () => {
  it('refuses a raw second live row for a pair with 23505', async () => {
    await prisma.$executeRaw`
      INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
      VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
    `;
    expect(
      await captureSqlCode(
        prisma.$executeRaw`
          INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
          VALUES (${OTHER_REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
        `
      )
    ).toBe('23505');
  });

  it('refuses reviving a deleted duplicate while a live row exists with 23505', async () => {
    await insertRelationship({ id: REL_ID, deletedAt: new Date() });
    await insertRelationship({ id: OTHER_REL_ID });
    expect(
      await captureSqlCode(
        prisma.$executeRaw`UPDATE customer_relationships SET deleted_at = NULL WHERE id = ${REL_ID}::uuid`
      )
    ).toBe('23505');
  });
});
