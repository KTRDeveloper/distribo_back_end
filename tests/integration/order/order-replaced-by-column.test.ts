import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup.js';

const CUSTOMER = '0199c035-0000-7000-8000-000000000001';
const CUSTOMER_2 = '0199c035-0000-7000-8000-000000000003';
const SELLER = '0199c035-0000-7000-8000-000000000002';
const SUPPLIER = '0199c035-0000-7000-8000-0000000000a1';
const REL_R = '0199c035-0000-7000-8000-0000000000e1';
const REL_S = '0199c035-0000-7000-8000-0000000000e2';
const R1 = '0199c035-0000-7000-8000-0000000000c1';
const R2 = '0199c035-0000-7000-8000-0000000000c2';
const R3 = '0199c035-0000-7000-8000-0000000000c3';
const R_SUPPLIER_PLACED = '0199c035-0000-7000-8000-0000000000c4';
const R_SUPPLIER_PLACED_2 = '0199c035-0000-7000-8000-0000000000c5';
const S1 = '0199c035-0000-7000-8000-0000000000d1';
const UNKNOWN = '0199c035-0000-7000-8000-0000000000ff';
const REG = new Date('2026-01-01T00:00:00.000Z');

async function seedPerson(id: string, phone: string) {
  await prisma.person.create({
    data: {
      id,
      fullName: 'Fixture Person',
      phoneNumber: phone,
      phoneVerifiedAt: REG,
      passwordHash: 'test-password-hash',
      registeredAt: REG,
      preferredLanguage: 'EN',
    },
  });
}

async function seedOrder(id: string, relationshipId: string, placedBy: 'CUSTOMER' | 'SUPPLIER') {
  await prisma.order.create({
    data: {
      id,
      customerRelationshipId: relationshipId,
      placedByParty: placedBy,
      enteredById: placedBy === 'CUSTOMER' ? CUSTOMER : SELLER,
      totalAmount: 0n,
      status: 'CONFIRMED',
    },
  });
}

/** Sets the link with raw SQL, so only the database rules are in play. */
const setLink = (orderId: string, targetId: string) =>
  prisma.$executeRaw`
    UPDATE orders SET replaced_by_order_id = ${targetId}::uuid WHERE id = ${orderId}::uuid
  `;

const linkOf = async (orderId: string) => {
  const [row] = await prisma.$queryRaw<Array<{ replaced_by_order_id: string | null }>>`
    SELECT replaced_by_order_id FROM orders WHERE id = ${orderId}::uuid
  `;
  return row.replaced_by_order_id;
};

async function expectSqlState(promise: Promise<unknown>, state: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).not.toBeNull();
  expect(JSON.stringify(error, Object.getOwnPropertyNames(error as object))).toContain(state);
}

beforeEach(async () => {
  await seedPerson(CUSTOMER, '+237600035001');
  await seedPerson(CUSTOMER_2, '+237600035003');
  await seedPerson(SELLER, '+237600035002');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  for (const id of [REL_R, REL_S]) {
    await prisma.customerRelationship.create({
      data: {
        id,
        supplierOrganizationId: SUPPLIER,
        customerPersonId: id === REL_R ? CUSTOMER : CUSTOMER_2,
        createdById: SELLER,
        status: 'ACTIVE',
      },
    });
  }
  await seedOrder(R1, REL_R, 'CUSTOMER');
  await seedOrder(R2, REL_R, 'CUSTOMER');
  await seedOrder(R3, REL_R, 'CUSTOMER');
  await seedOrder(R_SUPPLIER_PLACED, REL_R, 'SUPPLIER');
  await seedOrder(R_SUPPLIER_PLACED_2, REL_R, 'SUPPLIER');
  await seedOrder(S1, REL_S, 'CUSTOMER');
});

describe('ORD-035 orders.replaced_by_order_id', () => {
  it('column: is a nullable uuid and every existing order has it empty (AC-1)', async () => {
    const [column] = await prisma.$queryRaw<Array<{ is_nullable: string; data_type: string }>>`
      SELECT is_nullable, data_type FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'replaced_by_order_id'
    `;
    expect(column).toEqual({ is_nullable: 'YES', data_type: 'uuid' });
    expect(await linkOf(R1)).toBeNull();
    expect(await linkOf(S1)).toBeNull();
  });

  describe('link rules (AC-2, C-58)', () => {
    it('accepts another order of the same relationship', async () => {
      await setLink(R1, R2);
      expect(await linkOf(R1)).toBe(R2);
    });

    it('rejects its own id with 23514', async () => {
      await expectSqlState(setLink(R1, R1), '23514');
      expect(await linkOf(R1)).toBeNull();
    });

    it('rejects an order another order already links to with 23505', async () => {
      await setLink(R1, R2);
      await expectSqlState(setLink(R3, R2), '23505');
      expect(await linkOf(R3)).toBeNull();
    });

    it('rejects an unknown id with 23503', async () => {
      await expectSqlState(setLink(R1, UNKNOWN), '23503');
      expect(await linkOf(R1)).toBeNull();
    });
  });

  it('supplier order: a link on a SUPPLIER-placed order is rejected with 23514 (AC-3, C-58)', async () => {
    await expectSqlState(setLink(R_SUPPLIER_PLACED, R_SUPPLIER_PLACED_2), '23514');
    expect(await linkOf(R_SUPPLIER_PLACED)).toBeNull();
  });

  it('other relationship: a link to an order of relationship S is rejected with 23514 (AB-1)', async () => {
    await expectSqlState(setLink(R1, S1), '23514');
    expect(await linkOf(R1)).toBeNull();
  });
});
