import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';

const SUPPLIER_ORG_ID = '0199c033-0000-7000-8000-000000000001';
const CUSTOMER_ORG_ID = '0199c033-0000-7000-8000-000000000002';
const OTHER_ORG_ID = '0199c033-0000-7000-8000-000000000003';
const OWNER_ID = '0199c033-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c033-0000-7000-8000-000000000012';
const OTHER_CUSTOMER_ID = '0199c033-0000-7000-8000-000000000013';
const PERSON_REL_ID = '0199c033-0000-7000-8000-000000000021';
const ORG_REL_ID = '0199c033-0000-7000-8000-000000000022';
const OTHER_REL_ID = '0199c033-0000-7000-8000-000000000023';

const MIGRATION = join(
  __dirname,
  '../../../prisma/migrations/20261111120000_rel_033_public_name_touch/migration.sql'
);

async function stamps(): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ id: string; at: Date }>>`
    SELECT id::text AS id, server_updated_at AS at FROM customer_relationships
  `;
  return Object.fromEntries(rows.map((r) => [r.id, r.at.getTime()]));
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700033011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700033012',
        ...registered,
      },
      {
        id: OTHER_CUSTOMER_ID,
        fullName: 'Fixture Stranger',
        phoneNumber: '+2250700033013',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES
      (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier'),
      (${CUSTOMER_ORG_ID}::uuid, 'Fixture Customer Org'),
      (${OTHER_ORG_ID}::uuid, 'Fixture Other Supplier')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${PERSON_REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_organization_id, created_by_id)
    VALUES (${ORG_REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ORG_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${OTHER_REL_ID}::uuid, ${OTHER_ORG_ID}::uuid, ${OTHER_CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
});

describe('a person renamed (AC-1)', () => {
  it('moves server_updated_at of the relationships of that person only', async () => {
    const before = await stamps();
    await prisma.$executeRaw`
      UPDATE people SET full_name = 'New Name' WHERE id = ${CUSTOMER_ID}::uuid
    `;
    const after = await stamps();
    expect(after[PERSON_REL_ID]).toBeGreaterThan(before[PERSON_REL_ID]);
    expect(after[ORG_REL_ID]).toBe(before[ORG_REL_ID]);
    expect(after[OTHER_REL_ID]).toBe(before[OTHER_REL_ID]);
  });
});

describe('an organization renamed (AC-2)', () => {
  it('moves server_updated_at of the relationships where it is supplier or customer', async () => {
    const before = await stamps();
    await prisma.$executeRaw`
      UPDATE organizations SET name = 'New Supplier Name' WHERE id = ${SUPPLIER_ORG_ID}::uuid
    `;
    const afterSupplier = await stamps();
    expect(afterSupplier[PERSON_REL_ID]).toBeGreaterThan(before[PERSON_REL_ID]);
    expect(afterSupplier[ORG_REL_ID]).toBeGreaterThan(before[ORG_REL_ID]);
    expect(afterSupplier[OTHER_REL_ID]).toBe(before[OTHER_REL_ID]);

    await prisma.$executeRaw`
      UPDATE organizations SET name = 'New Customer Name' WHERE id = ${CUSTOMER_ORG_ID}::uuid
    `;
    const afterCustomer = await stamps();
    expect(afterCustomer[ORG_REL_ID]).toBeGreaterThan(afterSupplier[ORG_REL_ID]);
    expect(afterCustomer[PERSON_REL_ID]).toBe(afterSupplier[PERSON_REL_ID]);
  });
});

describe('nothing renamed (AC-3)', () => {
  it('leaves server_updated_at alone for another field or the same name', async () => {
    const before = await stamps();
    await prisma.$executeRaw`
      UPDATE people SET phone_number = '+2250700033099' WHERE id = ${CUSTOMER_ID}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE people SET full_name = 'Fixture Customer' WHERE id = ${CUSTOMER_ID}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE organizations SET description = 'Other text' WHERE id = ${SUPPLIER_ORG_ID}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE organizations SET name = 'Fixture Supplier' WHERE id = ${SUPPLIER_ORG_ID}::uuid
    `;
    expect(await stamps()).toEqual(before);
  });
});

describe('put into service (AC-4)', () => {
  it('touches every relationship when the migration is run', async () => {
    const before = await stamps();
    await prisma.$executeRawUnsafe(readFileSync(MIGRATION, 'utf8'));
    const after = await stamps();
    for (const id of [PERSON_REL_ID, ORG_REL_ID, OTHER_REL_ID]) {
      expect(after[id]).toBeGreaterThan(before[id]);
    }
  });
});

describe('another party (AB-1, CWE-639)', () => {
  it('does not move the relationships of S when person Q, in none of them, is renamed', async () => {
    const before = await stamps();
    await prisma.$executeRaw`
      UPDATE people SET full_name = 'Renamed Stranger' WHERE id = ${OTHER_CUSTOMER_ID}::uuid
    `;
    const after = await stamps();
    expect(after[OTHER_REL_ID]).toBeGreaterThan(before[OTHER_REL_ID]);
    expect(after[PERSON_REL_ID]).toBe(before[PERSON_REL_ID]);
    expect(after[ORG_REL_ID]).toBe(before[ORG_REL_ID]);
  });
});
