import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const SUPPLIER_ORG_ID = '0199c006-0000-7000-8000-000000000001';
const OWNER_ID = '0199c006-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c006-0000-7000-8000-000000000012';
const REL_ID = '0199c006-0000-7000-8000-000000000021';
const ORDER_ID = '0199c006-0000-7000-8000-000000000031';

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

type OrgStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

type Setup = {
  relStatus?: 'ACTIVE' | 'PENDING' | 'ENDED';
  orgStatus?: OrgStatus;
  deleted?: boolean;
  counter?: boolean;
  /** Supplier is a person, not an organization. */
  personSupplier?: boolean;
};

/** Creates the supplier organization and one relationship in the requested state. */
async function setupRelationship(setup: Setup = {}): Promise<void> {
  await prisma.$executeRaw`
    UPDATE organizations SET status = ${setup.orgStatus ?? 'ACTIVE'}::text::public."OrganizationStatus"
    WHERE id = ${SUPPLIER_ORG_ID}::uuid
  `;
  const status = setup.personSupplier ? 'PENDING' : (setup.relStatus ?? 'ACTIVE');
  const supplierOrg = setup.personSupplier ? null : SUPPLIER_ORG_ID;
  const supplierPerson = setup.personSupplier ? OWNER_ID : null;
  const customer = setup.counter ? null : CUSTOMER_ID;
  const counterLabel = setup.counter ? 'Counter' : null;
  const endedBy = status === 'ENDED' ? 'CUSTOMER' : null;
  const deletedAt = setup.deleted ? new Date('2026-01-03T00:00:00.000Z') : null;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, supplier_person_id, customer_person_id, customer_label,
      created_by_id, status, ended_by_party, deleted_at
    )
    VALUES (
      ${REL_ID}::uuid, ${supplierOrg}::uuid, ${supplierPerson}::uuid, ${customer}::uuid,
      ${counterLabel}::text, ${OWNER_ID}::uuid,
      ${status}::text::public."RelationshipStatus",
      ${endedBy}::text::public."RelationshipParty", ${deletedAt}::timestamptz
    )
  `;
}

function insertOrder(): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, total_amount)
    VALUES (${ORDER_ID}::uuid, ${REL_ID}::uuid, 'CUSTOMER'::public."OrderParty", ${OWNER_ID}::uuid, 0)
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700006011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700006012',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier')
  `;
});

describe('creation states (AC-1, C-14)', () => {
  const examples: Array<[string, Setup, string | undefined]> = [
    ['ACTIVE, supplier organization ACTIVE', {}, undefined],
    ['PENDING', { relStatus: 'PENDING', personSupplier: true }, '23514'],
    ['ENDED', { relStatus: 'ENDED' }, '23514'],
    ['ACTIVE with the supplier organization SUSPENDED', { orgStatus: 'SUSPENDED' }, '23514'],
    ['ACTIVE with the supplier organization CLOSED', { orgStatus: 'CLOSED' }, '23514'],
    ['deleted', { deleted: true }, '23514'],
    ['a counter of an ACTIVE organization', { counter: true }, undefined],
  ];

  it.each(examples)('%s', async (_name, setup, expected) => {
    await setupRelationship(setup);
    expect(await captureSqlCode(insertOrder())).toBe(expected);
  });
});

describe('old orders stay (AC-2)', () => {
  it('updating the supplier note still works after the organization is closed', async () => {
    await setupRelationship();
    await insertOrder();
    await prisma.$executeRaw`
      UPDATE organizations SET status = 'CLOSED' WHERE id = ${SUPPLIER_ORG_ID}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE orders SET supplier_note = 'still editable' WHERE id = ${ORDER_ID}::uuid
    `;
    const [row] = await prisma.$queryRaw<Array<{ supplier_note: string }>>`
      SELECT supplier_note FROM orders WHERE id = ${ORDER_ID}::uuid
    `;
    expect(row?.supplier_note).toBe('still editable');
  });
});

describe('crafted insert (AB-1)', () => {
  it('PostgreSQL refuses an order on an ENDED relationship', async () => {
    await setupRelationship({ relStatus: 'ENDED' });
    expect(await captureSqlCode(insertOrder())).toBe('23514');
    const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM orders`;
    expect(row?.n).toBe(0n);
  });
});
