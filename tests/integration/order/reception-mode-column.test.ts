import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup.js';

const CUSTOMER = '0199c036-0000-7000-8000-000000000001';
const SELLER = '0199c036-0000-7000-8000-000000000002';
const SUPPLIER = '0199c036-0000-7000-8000-0000000000a1';
const REL = '0199c036-0000-7000-8000-0000000000e1';
const EXISTING = '0199c036-0000-7000-8000-0000000000c1';
const ADDRESS = 'Rue 12, Akwa';
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

/** Inserts an order with raw SQL, so only the database rules are in play. */
const insertOrder = (id: string, mode: string | null, address: string | null) =>
  prisma.$executeRaw`
    INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id,
                        delivery_address_applied, total_amount, status, reception_mode)
    VALUES (${id}::uuid, ${REL}::uuid, 'SUPPLIER', ${SELLER}::uuid, ${address}, 0,
            'CONFIRMED', ${mode}::"ReceptionMode")
  `;

const rowOf = async (id: string) => {
  const [row] = await prisma.$queryRaw<
    Array<{ reception_mode: string | null; delivery_address_applied: string | null }>
  >`SELECT reception_mode::text AS reception_mode, delivery_address_applied
    FROM orders WHERE id = ${id}::uuid`;
  return row;
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
  await seedPerson(CUSTOMER, '+237600036001');
  await seedPerson(SELLER, '+237600036002');
  await prisma.organization.create({ data: { id: SUPPLIER, name: 'Supplier', status: 'ACTIVE' } });
  await prisma.customerRelationship.create({
    data: {
      id: REL,
      supplierOrganizationId: SUPPLIER,
      customerPersonId: CUSTOMER,
      createdById: SELLER,
      status: 'ACTIVE',
    },
  });
  await prisma.order.create({
    data: {
      id: EXISTING,
      customerRelationshipId: REL,
      placedByParty: 'SUPPLIER',
      enteredById: SELLER,
      deliveryAddressApplied: ADDRESS,
      totalAmount: 0n,
      status: 'CONFIRMED',
    },
  });
});

describe('ORD-036 orders.reception_mode', () => {
  it('column: is a nullable DELIVERY/PICKUP enum and an existing order has it empty (AC-1)', async () => {
    const [column] = await prisma.$queryRaw<Array<{ is_nullable: string; udt_name: string }>>`
      SELECT is_nullable, udt_name FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'reception_mode'
    `;
    expect(column).toEqual({ is_nullable: 'YES', udt_name: 'ReceptionMode' });
    const values = await prisma.$queryRaw<Array<{ v: string }>>`
      SELECT unnest(enum_range(NULL::"ReceptionMode"))::text AS v
    `;
    expect(values.map((r) => r.v)).toEqual(['DELIVERY', 'PICKUP']);
    expect((await rowOf(EXISTING)).reception_mode).toBeNull();
  });

  describe('pickup rule (AC-2, C-60)', () => {
    const accepted: Array<[string, string | null, string | null]> = [
      ['PICKUP', null, 'a1'],
      ['DELIVERY', ADDRESS, 'a2'],
      ['DELIVERY', null, 'a3'],
      [null as unknown as string, ADDRESS, 'a4'],
    ];
    it.each(accepted)('accepts mode %s with address %s', async (mode, address, suffix) => {
      const id = `0199c036-0000-7000-8000-0000000001${suffix.slice(1).padStart(2, '0')}`;
      await insertOrder(id, mode, address);
      expect(await rowOf(id)).toEqual({ reception_mode: mode, delivery_address_applied: address });
    });

    it('rejects a PICKUP with an address with 23514', async () => {
      await expectSqlState(
        insertOrder('0199c036-0000-7000-8000-000000000199', 'PICKUP', ADDRESS),
        '23514'
      );
    });
  });

  it('bypass: a raw update to PICKUP keeping the address fails with 23514 and changes nothing (AB-1)', async () => {
    await expectSqlState(
      prisma.$executeRaw`UPDATE orders SET reception_mode = 'PICKUP' WHERE id = ${EXISTING}::uuid`,
      '23514'
    );
    expect(await rowOf(EXISTING)).toEqual({
      reception_mode: null,
      delivery_address_applied: ADDRESS,
    });
  });

  it('unknown mode: a raw insert of SHIP fails with 22P02 (AB-2)', async () => {
    await expectSqlState(
      prisma.$executeRaw`
        INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id,
                            total_amount, status, reception_mode)
        VALUES ('0199c036-0000-7000-8000-000000000198'::uuid, ${REL}::uuid, 'SUPPLIER',
                ${SELLER}::uuid, 0, 'CONFIRMED', 'SHIP')
      `,
      '22P02'
    );
  });
});
