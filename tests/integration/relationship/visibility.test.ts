import { beforeEach, describe, expect, it } from 'vitest';
import type { CustomerRelationship, Person } from '@prisma/client';
import { prisma } from '../../setup';
import {
  projectForCustomer,
  projectForDriver,
  projectForSupplier,
  visibleRelationsWhere,
  type RelationshipRow,
} from '../../../src/modules/relationship/relationship.visibility';

const SUPPLIER_ORG_ID = '0199c006-0000-7000-8000-000000000001';
const OTHER_ORG_ID = '0199c006-0000-7000-8000-000000000002';
const CUSTOMER_ORG_ID = '0199c006-0000-7000-8000-000000000003';
const OWNER_ID = '0199c006-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c006-0000-7000-8000-000000000012';
const SUPPLIER_PERSON_ID = '0199c006-0000-7000-8000-000000000013';
const STRANGER_ID = '0199c006-0000-7000-8000-000000000014';
const REL_ID = '0199c006-0000-7000-8000-000000000021';
const INVITE_ID = '0199c006-0000-7000-8000-000000000022';
const OTHER_ORG_REL_ID = '0199c006-0000-7000-8000-000000000023';

const registeredAt = new Date('2026-01-01T00:00:00.000Z');

function person(over: Partial<Person> = {}): Person {
  return {
    id: CUSTOMER_ID,
    fullName: 'Fixture Customer',
    phoneNumber: '+2250700006012',
    registeredAt,
    email: 'private@example.test',
    passwordHash: 'hash',
    ...over,
  } as Person;
}

function relation(over: Partial<RelationshipRow> = {}): RelationshipRow {
  return {
    id: REL_ID,
    supplierOrganizationId: SUPPLIER_ORG_ID,
    supplierPersonId: null,
    customerPersonId: CUSTOMER_ID,
    customerOrganizationId: null,
    customerPhoneNumber: null,
    customerLabel: 'Mama Awa (private)',
    supplierLabel: 'Best wholesaler (private)',
    deliveryAddress: 'Rue 12',
    creditLimit: 50000n,
    creditLimitSetById: OWNER_ID,
    creditLimitSetAt: registeredAt,
    balance: 40000n,
    status: 'ACTIVE',
    endedByParty: null,
    supplierNotes: 'pays late (private)',
    createdById: OWNER_ID,
    createdAt: registeredAt,
    mergedIntoId: null,
    serverUpdatedAt: registeredAt,
    deletedAt: null,
    customerPerson: person(),
    customerOrganization: null,
    supplierOrganization: { name: 'Fixture Supplier', description: 'Wholesale' },
    supplierPerson: null,
    ...over,
  } as RelationshipRow;
}

async function insert(
  id: string,
  cols: {
    supplierOrg?: string | null;
    supplierPerson?: string | null;
    customerPerson?: string | null;
    status?: 'ACTIVE' | 'PENDING';
    deletedAt?: Date | null;
    mergedInto?: string | null;
  }
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (
      id, supplier_organization_id, supplier_person_id, customer_person_id,
      created_by_id, status, merged_into_id, deleted_at
    )
    VALUES (
      ${id}::uuid, ${cols.supplierOrg ?? null}::uuid, ${cols.supplierPerson ?? null}::uuid,
      ${cols.customerPerson ?? null}::uuid, ${OWNER_ID}::uuid,
      ${cols.status ?? 'ACTIVE'}::text::public."RelationshipStatus",
      ${cols.mergedInto ?? null}::uuid, ${cols.deletedAt ?? null}::timestamptz
    )
  `;
}

async function visibleIds(viewer: { personId: string; organizationIds: string[] }) {
  const rows = await prisma.customerRelationship.findMany({
    where: visibleRelationsWhere(viewer),
    select: { id: true },
  });
  return rows.map((r: Pick<CustomerRelationship, 'id'>) => r.id).sort();
}

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: registeredAt,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt,
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
      {
        id: SUPPLIER_PERSON_ID,
        fullName: 'Fixture Supplier Person',
        phoneNumber: '+2250700006013',
        ...registered,
      },
      {
        id: STRANGER_ID,
        fullName: 'Fixture Stranger',
        phoneNumber: '+2250700006014',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier'),
           (${OTHER_ORG_ID}::uuid, 'Fixture Other'),
           (${CUSTOMER_ORG_ID}::uuid, 'Fixture Customer Business')
  `;
});

describe('who sees (AC-1)', () => {
  beforeEach(async () => {
    await insert(REL_ID, { supplierOrg: SUPPLIER_ORG_ID, customerPerson: CUSTOMER_ID });
  });

  it('shows the row to a member of the supplier organization', async () => {
    expect(await visibleIds({ personId: STRANGER_ID, organizationIds: [SUPPLIER_ORG_ID] })).toEqual(
      [REL_ID]
    );
  });

  it('shows the row to the customer person', async () => {
    expect(await visibleIds({ personId: CUSTOMER_ID, organizationIds: [] })).toEqual([REL_ID]);
  });

  it('hides the row from a member of another organization', async () => {
    expect(await visibleIds({ personId: STRANGER_ID, organizationIds: [OTHER_ORG_ID] })).toEqual(
      []
    );
  });

  it('hides the row from another person', async () => {
    expect(await visibleIds({ personId: STRANGER_ID, organizationIds: [] })).toEqual([]);
  });

  it('shows a PENDING invitation to its supplier person', async () => {
    await insert(INVITE_ID, {
      supplierPerson: SUPPLIER_PERSON_ID,
      customerPerson: CUSTOMER_ID,
      status: 'PENDING',
    });
    expect(await visibleIds({ personId: SUPPLIER_PERSON_ID, organizationIds: [] })).toEqual([
      INVITE_ID,
    ]);
  });

  it('shows the row to a member of the customer organization', async () => {
    await prisma.$executeRaw`
      INSERT INTO customer_relationships (id, supplier_organization_id, customer_organization_id, created_by_id)
      VALUES (${OTHER_ORG_REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ORG_ID}::uuid, ${OWNER_ID}::uuid)
    `;
    expect(await visibleIds({ personId: STRANGER_ID, organizationIds: [CUSTOMER_ORG_ID] })).toEqual(
      [OTHER_ORG_REL_ID]
    );
  });

  it('hides a deleted row from the supplier organization', async () => {
    await prisma.$executeRaw`UPDATE customer_relationships SET deleted_at = now() WHERE id = ${REL_ID}::uuid`;
    expect(await visibleIds({ personId: STRANGER_ID, organizationIds: [SUPPLIER_ORG_ID] })).toEqual(
      []
    );
    expect(await visibleIds({ personId: CUSTOMER_ID, organizationIds: [] })).toEqual([]);
  });

  it('hides a merged row from the supplier organization', async () => {
    await insert(INVITE_ID, { supplierOrg: SUPPLIER_ORG_ID, customerPerson: STRANGER_ID });
    await prisma.$executeRaw`
      UPDATE customer_relationships SET deleted_at = now(), merged_into_id = ${INVITE_ID}::uuid
      WHERE id = ${REL_ID}::uuid
    `;
    expect(await visibleIds({ personId: STRANGER_ID, organizationIds: [SUPPLIER_ORG_ID] })).toEqual(
      [INVITE_ID]
    );
  });

  it('matches no organization row when organizationIds is empty (v5.0.0-8.4.1)', async () => {
    expect(await visibleIds({ personId: STRANGER_ID, organizationIds: [] })).toEqual([]);
  });
});

describe('other organization (AB-1)', () => {
  it('returns no row of another organization', async () => {
    await insert(REL_ID, { supplierOrg: SUPPLIER_ORG_ID, customerPerson: CUSTOMER_ID });
    await insert(OTHER_ORG_REL_ID, { supplierOrg: OTHER_ORG_ID, customerPerson: STRANGER_ID });
    expect(await visibleIds({ personId: OWNER_ID, organizationIds: [SUPPLIER_ORG_ID] })).toEqual([
      REL_ID,
    ]);
    expect(await visibleIds({ personId: OWNER_ID, organizationIds: [OTHER_ORG_ID] })).toEqual([
      OTHER_ORG_REL_ID,
    ]);
  });
});

describe('supplier view (AC-2, CM-19, CM-20)', () => {
  it('contains customer_label and supplier_notes but not supplier_label', () => {
    const view = projectForSupplier(relation());
    expect(Object.keys(view).sort()).toEqual(
      [
        'balance',
        'created_at',
        'credit_limit',
        'credit_limit_set_at',
        'credit_limit_set_by_id',
        'customer',
        'customer_label',
        'delivery_address',
        'ended_by_party',
        'id',
        'status',
        'supplier_notes',
      ].sort()
    );
    expect(view.customer_label).toBe('Mama Awa (private)');
    expect(view.supplier_notes).toBe('pays late (private)');
  });

  it('gives the customer person only public_name, phone_number and registered', () => {
    const view = projectForSupplier(relation());
    expect(view.customer).toEqual({
      kind: 'PERSON',
      person: { public_name: 'Fixture Customer', phone_number: '+2250700006012', registered: true },
    });
    if (view.customer?.kind !== 'PERSON') throw new Error('expected a person');
    expect(Object.keys(view.customer.person).sort()).toEqual([
      'phone_number',
      'public_name',
      'registered',
    ]);
  });

  it('gives a customer organization by name only', () => {
    const view = projectForSupplier(
      relation({
        customerPersonId: null,
        customerPerson: null,
        customerOrganizationId: CUSTOMER_ORG_ID,
        customerOrganization: { name: 'Fixture Customer Business', description: 'x' },
      })
    );
    expect(view.customer).toEqual({ kind: 'ORGANIZATION', name: 'Fixture Customer Business' });
  });

  it('gives a null customer for a counter', () => {
    const view = projectForSupplier(relation({ customerPersonId: null, customerPerson: null }));
    expect(view.customer).toBeNull();
  });

  it('reports an unregistered customer as such', () => {
    const view = projectForSupplier(
      relation({ customerPerson: person({ registeredAt: null, fullName: null }) })
    );
    expect(view.customer).toEqual({
      kind: 'PERSON',
      person: { public_name: null, phone_number: '+2250700006012', registered: false },
    });
  });

  it('serializes money as numbers so JSON works', () => {
    const view = projectForSupplier(relation());
    expect(view.credit_limit).toBe(50000);
    expect(view.balance).toBe(40000);
    expect(() => JSON.stringify(view)).not.toThrow();
  });
});

describe('customer view (AC-3, CM-19)', () => {
  it('contains supplier_label and not customer_label or supplier_notes', () => {
    const view = projectForCustomer(relation());
    expect(Object.keys(view).sort()).toEqual(
      [
        'balance',
        'created_at',
        'credit_limit',
        'delivery_address',
        'ended_by_party',
        'id',
        'status',
        'supplier',
        'supplier_label',
      ].sort()
    );
    expect(view.supplier_label).toBe('Best wholesaler (private)');
    expect(view.supplier).toEqual({
      kind: 'ORGANIZATION',
      name: 'Fixture Supplier',
      description: 'Wholesale',
    });
  });

  it('gives a supplier person only the public view', () => {
    const view = projectForCustomer(
      relation({
        supplierOrganizationId: null,
        supplierOrganization: null,
        supplierPersonId: SUPPLIER_PERSON_ID,
        supplierPerson: person({ id: SUPPLIER_PERSON_ID, fullName: 'Fixture Supplier Person' }),
        status: 'PENDING',
      })
    );
    expect(view.supplier).toEqual({
      kind: 'PERSON',
      person: {
        public_name: 'Fixture Supplier Person',
        phone_number: '+2250700006012',
        registered: true,
      },
    });
  });
});

describe('driver view (AC-4)', () => {
  it('gives available_credit as limit minus balance and no limit or balance', () => {
    const view = projectForDriver(relation());
    expect(view).toEqual({
      id: REL_ID,
      customer_name: 'Fixture Customer',
      available_credit: 10000,
    });
    expect(view).not.toHaveProperty('credit_limit');
    expect(view).not.toHaveProperty('balance');
  });

  it('gives null available_credit with no ceiling', () => {
    expect(projectForDriver(relation({ creditLimit: null })).available_credit).toBeNull();
  });

  it('treats a zero limit as a real ceiling', () => {
    expect(projectForDriver(relation({ creditLimit: 0n, balance: 0n })).available_credit).toBe(0);
  });

  it('falls back to the organization name, then the counter label', () => {
    expect(
      projectForDriver(
        relation({
          customerPerson: null,
          customerOrganization: { name: 'Fixture Customer Business', description: null },
        })
      ).customer_name
    ).toBe('Fixture Customer Business');
    expect(
      projectForDriver(relation({ customerPerson: null, customerPersonId: null })).customer_name
    ).toBe('Mama Awa (private)');
  });

  it('gives a null name when nothing names the customer', () => {
    expect(
      projectForDriver(relation({ customerPerson: null, customerLabel: null })).customer_name
    ).toBeNull();
  });
});

describe('private fields (AB-2, CWE-200)', () => {
  it('keeps the other side private fields out of the serialized views', () => {
    const row = relation();
    const forCustomer = JSON.stringify(projectForCustomer(row));
    expect(forCustomer).not.toContain('Mama Awa');
    expect(forCustomer).not.toContain('pays late');
    const forSupplier = JSON.stringify(projectForSupplier(row));
    expect(forSupplier).not.toContain('Best wholesaler');
    const forDriver = JSON.stringify(projectForDriver(row));
    expect(forDriver).not.toContain('Best wholesaler');
    expect(forDriver).not.toContain('pays late');
    expect(forDriver).not.toContain('40000');
    for (const json of [forCustomer, forSupplier, forDriver]) {
      expect(json).not.toContain('private@example.test');
      expect(json).not.toContain('hash');
    }
  });
});
