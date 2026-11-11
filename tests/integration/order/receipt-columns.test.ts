import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../setup.js';

const CUSTOMER = '0199c040-0000-7000-8000-000000000001';
const SELLER = '0199c040-0000-7000-8000-000000000002';
const SUPPLIER = '0199c040-0000-7000-8000-0000000000a1';
const REL = '0199c040-0000-7000-8000-0000000000e1';
const EXISTING = '0199c040-0000-7000-8000-0000000000c1';
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

async function expectSqlState(promise: Promise<unknown>, state: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).not.toBeNull();
  expect(JSON.stringify(error, Object.getOwnPropertyNames(error as object))).toContain(state);
}

beforeEach(async () => {
  await seedPerson(CUSTOMER, '+237600040001');
  await seedPerson(SELLER, '+237600040002');
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
      totalAmount: 0n,
      status: 'CONFIRMED',
    },
  });
});

describe('ORD-040 orders receipt fields', () => {
  it('columns: four nullable columns, two text and two bigint, existing rows empty (AC-1)', async () => {
    const columns = await prisma.$queryRaw<
      Array<{ column_name: string; is_nullable: string; data_type: string; column_default: null }>
    >`
      SELECT column_name, is_nullable, data_type, column_default FROM information_schema.columns
      WHERE table_name = 'orders'
        AND column_name IN ('supplier_name_applied', 'customer_name_applied',
                            'collected_applied', 'balance_after_applied')
      ORDER BY column_name
    `;
    expect(columns).toEqual([
      {
        column_name: 'balance_after_applied',
        is_nullable: 'YES',
        data_type: 'bigint',
        column_default: null,
      },
      {
        column_name: 'collected_applied',
        is_nullable: 'YES',
        data_type: 'bigint',
        column_default: null,
      },
      {
        column_name: 'customer_name_applied',
        is_nullable: 'YES',
        data_type: 'text',
        column_default: null,
      },
      {
        column_name: 'supplier_name_applied',
        is_nullable: 'YES',
        data_type: 'text',
        column_default: null,
      },
    ]);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: EXISTING } });
    expect(order.supplierNameApplied).toBeNull();
    expect(order.customerNameApplied).toBeNull();
    expect(order.collectedApplied).toBeNull();
    expect(order.balanceAfterApplied).toBeNull();
  });

  it('bigint: 9007199254740993 round-trips (AC-2)', async () => {
    const big = 9007199254740993n;
    await prisma.order.update({
      where: { id: EXISTING },
      // ORD-045: the receipt only exists on a delivered order, so the order is delivered here.
      data: {
        status: 'DELIVERED',
        deliveredAt: REG,
        deliveredById: SELLER,
        deliveryCost: 0n,
        supplierNameApplied: 'Supplier',
        collectedApplied: big,
        balanceAfterApplied: -big,
      },
    });
    const [row] = await prisma.$queryRaw<
      Array<{ collected_applied: bigint; balance_after_applied: bigint }>
    >`
      SELECT collected_applied, balance_after_applied FROM orders WHERE id = ${EXISTING}::uuid
    `;
    expect(row.collected_applied).toBe(big);
    expect(row.balance_after_applied).toBe(-big);
  });

  it('text amount: a raw insert of "12 500" fails with 22P02 (AB-1, CWE-20)', async () => {
    await expectSqlState(
      prisma.$executeRaw`
        INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id,
                            total_amount, status, collected_applied)
        VALUES ('0199c040-0000-7000-8000-000000000199'::uuid, ${REL}::uuid, 'SUPPLIER',
                ${SELLER}::uuid, 0, 'CONFIRMED', '12 500')
      `,
      '22P02'
    );
  });
});
