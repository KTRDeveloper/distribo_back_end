import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup';
import {
  mergeDuplicateRelation,
  resolveMergedRelation,
} from '../../../src/modules/relationship/relationship.repository';

const SUPPLIER_ORG_ID = '0199c025-0000-7000-8000-000000000001';
const OTHER_SUPPLIER_ORG_ID = '0199c025-0000-7000-8000-000000000002';
const OWNER_ID = '0199c025-0000-7000-8000-000000000011';
const PERSON_ID = '0199c025-0000-7000-8000-000000000012';
const OTHER_PERSON_ID = '0199c025-0000-7000-8000-000000000013';
const KEPT_ID = '0199c025-0000-7000-8000-000000000021';
const DUP_ID = '0199c025-0000-7000-8000-000000000022';
const THIRD_ID = '0199c025-0000-7000-8000-000000000023';

const PERSON_PHONE = '+237677005012';

type Rel = {
  id: string;
  supplierOrganizationId?: string;
  customerPersonId?: string | null;
  customerPhoneNumber?: string | null;
  customerLabel?: string | null;
  deletedAt?: Date | null;
  mergedIntoId?: string | null;
};

/** Inserts a relationship of SUPPLIER_ORG_ID with PERSON_ID as customer unless overridden. */
async function relation(row: Rel) {
  const customerPersonId = 'customerPersonId' in row ? row.customerPersonId : PERSON_ID;
  return prisma.customerRelationship.create({
    data: {
      id: row.id,
      supplierOrganizationId: row.supplierOrganizationId ?? SUPPLIER_ORG_ID,
      customerPersonId,
      customerPhoneNumber: row.customerPhoneNumber ?? null,
      customerLabel: row.customerLabel ?? null,
      deletedAt: row.deletedAt ?? null,
      mergedIntoId: row.mergedIntoId ?? null,
      creditLimit: customerPersonId ? 5000n : 0n,
      createdById: OWNER_ID,
    },
  });
}

function merge(duplicateId: string, keptId: string) {
  return prisma.$transaction((tx) => mergeDuplicateRelation(tx, duplicateId, keptId));
}

function load(id: string) {
  return prisma.customerRelationship.findUniqueOrThrow({ where: { id } });
}

async function expectCannotMerge(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ statusCode: 409, code: 'CANNOT_MERGE' });
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+237677005011', ...registered },
      { id: PERSON_ID, fullName: 'Fixture Customer', phoneNumber: PERSON_PHONE, ...registered },
      {
        id: OTHER_PERSON_ID,
        fullName: 'Fixture Other Customer',
        phoneNumber: '+237677005013',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name)
    VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier'), (${OTHER_SUPPLIER_ORG_ID}::uuid, 'Fixture Other Supplier')
  `;
});

/**
 * A live kept row for the person, and a live duplicate created offline with only the typed number
 * (two live rows with the same customer person cannot coexist, C-07).
 */
async function twoLiveRowsForOnePerson() {
  await relation({ id: KEPT_ID });
  // The duplicate was created offline with only the typed number: it holds the phone, no person.
  await relation({
    id: DUP_ID,
    customerPersonId: null,
    customerPhoneNumber: PERSON_PHONE,
    customerLabel: 'Typed offline',
  });
}

describe('merge (AC-1, C-07, C-35)', () => {
  it('deletes the duplicate, links it to the kept row and leaves the kept row unchanged', async () => {
    await twoLiveRowsForOnePerson();
    const keptBefore = await load(KEPT_ID);

    await merge(DUP_ID, KEPT_ID);

    const duplicate = await load(DUP_ID);
    expect(duplicate.mergedIntoId).toBe(KEPT_ID);
    expect(duplicate.deletedAt).toBeInstanceOf(Date);
    expect(duplicate.customerPhoneNumber).toBeNull();
    expect(duplicate.serverUpdatedAt.getTime()).toBeGreaterThan(
      keptBefore.serverUpdatedAt.getTime()
    );
    expect(await load(KEPT_ID)).toEqual(keptBefore);
  });
});

describe('resolve (AC-2)', () => {
  it('follows merged_into_id to the live id and returns a live id as itself', async () => {
    await twoLiveRowsForOnePerson();
    await merge(DUP_ID, KEPT_ID);

    expect(await resolveMergedRelation(DUP_ID)).toBe(KEPT_ID);
    expect(await resolveMergedRelation(KEPT_ID)).toBe(KEPT_ID);
    await prisma.$transaction(async (tx) => {
      expect(await resolveMergedRelation(DUP_ID, tx)).toBe(KEPT_ID);
    });
  });

  it('follows a chain of merges', async () => {
    await twoLiveRowsForOnePerson();
    await merge(DUP_ID, KEPT_ID);
    await relation({
      id: THIRD_ID,
      customerPersonId: null,
      customerLabel: 'Typed twice',
      deletedAt: new Date(),
    });
    await prisma.$executeRaw`
      UPDATE customer_relationships SET merged_into_id = ${DUP_ID}::uuid WHERE id = ${THIRD_ID}::uuid`;
    expect(await resolveMergedRelation(THIRD_ID)).toBe(KEPT_ID);
  });

  it('gives up after 5 hops', async () => {
    const ids = Array.from(
      { length: 7 },
      (_, i) => `0199c025-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`
    );
    for (const [i, id] of ids.entries()) {
      await relation({
        id,
        customerPersonId: null,
        customerPhoneNumber: null,
        customerLabel: `Chain ${i}`,
        deletedAt: i < ids.length - 1 ? new Date() : null,
      });
    }
    for (let i = 0; i < ids.length - 1; i += 1) {
      await prisma.$executeRaw`
        UPDATE customer_relationships SET merged_into_id = ${ids[i + 1]}::uuid
        WHERE id = ${ids[i]}::uuid`;
    }
    await expect(resolveMergedRelation(ids[0])).rejects.toThrow();
    expect(await resolveMergedRelation(ids[2])).toBe(ids[6]);
  });

  it('returns the id itself for an unknown id', async () => {
    expect(await resolveMergedRelation(THIRD_ID)).toBe(THIRD_ID);
  });
});

describe('refusals (AC-3, C-06)', () => {
  it('refuses two different suppliers', async () => {
    await relation({ id: KEPT_ID });
    await relation({
      id: DUP_ID,
      supplierOrganizationId: OTHER_SUPPLIER_ORG_ID,
      customerPersonId: null,
      customerPhoneNumber: PERSON_PHONE,
      customerLabel: 'Other supplier',
    });
    await expectCannotMerge(merge(DUP_ID, KEPT_ID));
    expect((await load(DUP_ID)).mergedIntoId).toBeNull();
  });

  it('refuses two different people', async () => {
    await relation({ id: KEPT_ID });
    await relation({ id: DUP_ID, customerPersonId: OTHER_PERSON_ID });
    await expectCannotMerge(merge(DUP_ID, KEPT_ID));
    expect((await load(DUP_ID)).deletedAt).toBeNull();
    expect((await load(KEPT_ID)).deletedAt).toBeNull();
  });

  it('refuses a duplicate whose number is another person number', async () => {
    await relation({ id: KEPT_ID });
    await relation({
      id: DUP_ID,
      customerPersonId: null,
      customerPhoneNumber: '+237677005013',
      customerLabel: 'Other number',
    });
    await expectCannotMerge(merge(DUP_ID, KEPT_ID));
    const duplicate = await load(DUP_ID);
    expect(duplicate.deletedAt).toBeNull();
    expect(duplicate.customerPhoneNumber).toBe('+237677005013');
  });

  it('refuses a counter', async () => {
    await relation({ id: KEPT_ID, customerPersonId: null, customerLabel: 'Client de passage' });
    await relation({ id: DUP_ID, customerPersonId: null, customerLabel: 'Client de passage' });
    await expectCannotMerge(merge(DUP_ID, KEPT_ID));
    expect((await load(DUP_ID)).deletedAt).toBeNull();
  });

  it('refuses the same row twice', async () => {
    await relation({ id: KEPT_ID });
    await expectCannotMerge(merge(KEPT_ID, KEPT_ID));
    expect((await load(KEPT_ID)).deletedAt).toBeNull();
  });

  it('refuses an absent row, a deleted duplicate that was not merged and a deleted kept row', async () => {
    await relation({ id: KEPT_ID });
    await expectCannotMerge(merge(DUP_ID, KEPT_ID));

    await relation({
      id: DUP_ID,
      customerPersonId: null,
      customerPhoneNumber: PERSON_PHONE,
      customerLabel: 'Typed offline',
      deletedAt: new Date(),
    });
    await expectCannotMerge(merge(DUP_ID, KEPT_ID));

    await prisma.customerRelationship.update({ where: { id: DUP_ID }, data: { deletedAt: null } });
    await prisma.customerRelationship.update({
      where: { id: KEPT_ID },
      data: { deletedAt: new Date() },
    });
    await expectCannotMerge(merge(DUP_ID, KEPT_ID));
    expect((await load(DUP_ID)).deletedAt).toBeNull();
  });
});

describe('repeat and rollback (AC-4, CWE-362)', () => {
  it('a second run changes nothing', async () => {
    await twoLiveRowsForOnePerson();
    await merge(DUP_ID, KEPT_ID);
    const first = await load(DUP_ID);

    await merge(DUP_ID, KEPT_ID);

    expect(await load(DUP_ID)).toEqual(first);
  });

  it('a rolled back transaction leaves nothing changed', async () => {
    await twoLiveRowsForOnePerson();
    const dupBefore = await load(DUP_ID);
    const keptBefore = await load(KEPT_ID);

    await expect(
      prisma.$transaction(async (tx) => {
        await mergeDuplicateRelation(tx, DUP_ID, KEPT_ID);
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');

    expect(await load(DUP_ID)).toEqual(dupBefore);
    expect(await load(KEPT_ID)).toEqual(keptBefore);
  });

  it('two concurrent merges of one duplicate end with one merged row', async () => {
    await twoLiveRowsForOnePerson();
    const results = await Promise.allSettled([merge(DUP_ID, KEPT_ID), merge(DUP_ID, KEPT_ID)]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect((await load(DUP_ID)).mergedIntoId).toBe(KEPT_ID);
  });
});

describe('two identities (AB-1, CWE-841)', () => {
  it('refuses to merge relationships of two different people and both stay live', async () => {
    await relation({ id: KEPT_ID });
    await relation({ id: DUP_ID, customerPersonId: OTHER_PERSON_ID });

    await expectCannotMerge(merge(DUP_ID, KEPT_ID));
    await expectCannotMerge(merge(KEPT_ID, DUP_ID));

    for (const id of [KEPT_ID, DUP_ID]) {
      const row = await load(id);
      expect(row.deletedAt).toBeNull();
      expect(row.mergedIntoId).toBeNull();
    }
  });
});
