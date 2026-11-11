import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const OWNER = '0199d042-0000-7000-8000-000000000001';
const CUSTOMER_PERSON = '0199d042-0000-7000-8000-000000000002';
const SUPPLIER_ORG = '0199d042-0000-7000-8000-0000000000a1';
const CUSTOMER_ORG = '0199d042-0000-7000-8000-0000000000a2';
const REL = '0199d042-0000-7000-8000-0000000000e1';
const ORDER = '0199d042-0000-7000-8000-000000000101';
const ORDER_2 = '0199d042-0000-7000-8000-000000000102';
const OPENING = '0199d042-0000-7000-8000-000000000201';
const SALE = '0199d042-0000-7000-8000-000000000202';
const PAYMENT = '0199d042-0000-7000-8000-000000000203';
const LATER_PAYMENT = '0199d042-0000-7000-8000-000000000204';
const SALE_2 = '0199d042-0000-7000-8000-000000000205';

const BEFORE = '2026-02-01T10:00:00Z';
const DELIVERY = '2026-03-01T10:00:00Z';
const AFTER = '2026-03-02T10:00:00Z';

const MIGRATION_DIR = join(__dirname, '../../../prisma/migrations');

/** SQL of the ORD-042 migration. */
function migrationSql(): string {
  const found = readdirSync(MIGRATION_DIR).filter((name) =>
    name.endsWith('_ord_042_backfill_and_freeze_receipt')
  );
  expect(found).toHaveLength(1);
  return readFileSync(join(MIGRATION_DIR, found[0], 'migration.sql'), 'utf8');
}

let client: Client;

/** One `pg` connection in a transaction that is always rolled back. */
beforeEach(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  // Entries get their own server_updated_at so a test can place them in time.
  await client.query(
    'ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_set_server_updated_at'
  );
});

afterEach(async () => {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.end();
});

/** Runs a statement under a savepoint; returns the SQLSTATE and message of a failure. */
async function attempt(
  sql: string,
  values: unknown[] = []
): Promise<{ code: string; message: string } | undefined> {
  await client.query('SAVEPOINT attempt');
  try {
    await client.query(sql, values);
    await client.query('RELEASE SAVEPOINT attempt');
    return undefined;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    const { code, message } = error as { code?: string; message: string };
    return { code: code ?? 'UNKNOWN', message };
  }
}

/**
 * Runs the migration SQL. The fixture is checked first (deferred triggers fire now), as it would
 * be when the real migration starts on committed data: a table with pending trigger events cannot
 * be altered. An order has no lines, so its delivery cost carries the whole total.
 */
async function runMigration(): Promise<void> {
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query(migrationSql());
}

/** The pre-ORD-042 state: the freeze trigger does not exist yet. */
async function dropFreezeTrigger(): Promise<void> {
  await client.query('DROP TRIGGER orders_freeze_receipt ON orders');
}

/**
 * The state before ORD-045: its check (receipt goes with DELIVERED) does not exist yet, so the
 * fixtures can hold delivered orders without receipt (the backfill input) and receipts on
 * orders that are not delivered (the freeze input).
 */
async function dropReceiptCheck(): Promise<void> {
  await client.query('ALTER TABLE orders DROP CONSTRAINT orders_receipt_matches_status_check');
}

async function seedPerson(id: string, phone: string, status = 'ACTIVE') {
  const anonymized = status === 'ANONYMIZED';
  await client.query(
    `INSERT INTO people (id, full_name, phone_number, released_phone_number, phone_verified_at,
                         password_hash, registered_at, status, preferred_language)
     VALUES ($1::uuid, $2, $3, $4, $5, 'fixture-hash', $5, $6::"PersonStatus", 'FR')`,
    [
      id,
      id === CUSTOMER_PERSON ? 'Awa Test' : 'Owner Test',
      anonymized ? null : phone,
      anonymized ? phone : null,
      anonymized ? null : BEFORE,
      status,
    ]
  );
}

type Customer = 'ORG' | 'PERSON' | 'ANONYMIZED';

async function seedBase(customer: Customer) {
  await seedPerson(OWNER, '+2250700042001');
  await client.query(
    `INSERT INTO organizations (id, name, status) VALUES
       ($1::uuid, 'Dépôt Test', 'ACTIVE'), ($2::uuid, 'Boutique Test', 'ACTIVE')`,
    [SUPPLIER_ORG, CUSTOMER_ORG]
  );
  if (customer !== 'ORG') {
    await seedPerson(
      CUSTOMER_PERSON,
      '+2250700042002',
      customer === 'ANONYMIZED' ? 'ANONYMIZED' : 'ACTIVE'
    );
  }
  await client.query(
    `INSERT INTO customer_relationships (id, supplier_organization_id, customer_organization_id,
                                         customer_person_id, customer_label, created_by_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Tata', $5::uuid)`,
    [
      REL,
      SUPPLIER_ORG,
      customer === 'ORG' ? CUSTOMER_ORG : null,
      customer === 'ORG' ? null : CUSTOMER_PERSON,
      OWNER,
    ]
  );
}

async function seedOrder(
  id: string,
  status: 'DELIVERED' | 'CONFIRMED',
  extra: { supplierName?: string } = {}
) {
  const delivered = status === 'DELIVERED';
  await client.query(
    `INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, status,
                         total_amount, delivery_cost, delivered_at, delivered_by_id, supplier_name_applied,
                         customer_name_applied, collected_applied, balance_after_applied)
     VALUES ($1::uuid, $2::uuid, 'SUPPLIER', $3::uuid, $4::"OrderStatus", 12500, 12500,
             $5::timestamptz, $6::uuid, $7, $8, $9::bigint, $10::bigint)`,
    [
      id,
      REL,
      OWNER,
      status,
      delivered ? DELIVERY : null,
      delivered ? OWNER : null,
      extra.supplierName ?? null,
      extra.supplierName ? 'Boutique Test' : null,
      extra.supplierName ? 5000 : null,
      extra.supplierName ? 10500 : null,
    ]
  );
}

async function seedEntry(
  id: string,
  kind: 'OPENING_BALANCE' | 'SALE' | 'PAYMENT',
  amount: number,
  at: string,
  orderId: string | null
) {
  await client.query(
    `INSERT INTO ledger_entries (id, customer_relationship_id, order_id, kind, amount, mode,
                                 recorded_by_id, occurred_at, server_updated_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"LedgerEntryKind", $5::bigint,
             $6::"LedgerEntryMode", $7::uuid, $8::timestamptz, $8::timestamptz)`,
    [id, REL, orderId, kind, amount, kind === 'PAYMENT' ? 'CASH' : null, OWNER, at]
  );
}

/** A delivered order of 12 500 after a balance of 3 000, paid 5 000 in the same transaction. */
async function seedDeliveredOrder(customer: Customer = 'ORG') {
  await seedBase(customer);
  await seedOrder(ORDER, 'DELIVERED');
  await seedEntry(OPENING, 'OPENING_BALANCE', 3000, BEFORE, null);
  await seedEntry(SALE, 'SALE', 12500, DELIVERY, ORDER);
  await seedEntry(PAYMENT, 'PAYMENT', 5000, DELIVERY, ORDER);
}

type Receipt = {
  supplier_name_applied: string | null;
  customer_name_applied: string | null;
  collected_applied: string | null;
  balance_after_applied: string | null;
};

async function receiptOf(id: string): Promise<Receipt> {
  const { rows } = await client.query<Receipt>(
    `SELECT supplier_name_applied, customer_name_applied, collected_applied::text,
            balance_after_applied::text FROM orders WHERE id = $1::uuid`,
    [id]
  );
  return rows[0];
}

describe('ORD-042 backfill', () => {
  beforeEach(dropFreezeTrigger);
  beforeEach(dropReceiptCheck);

  it('gives a delivered order its receipt (AC-1)', async () => {
    await seedDeliveredOrder();
    await runMigration();
    expect(await receiptOf(ORDER)).toEqual({
      supplier_name_applied: 'Dépôt Test',
      customer_name_applied: 'Boutique Test',
      collected_applied: '5000',
      balance_after_applied: '10500',
    });
  });

  it.each([
    ['ORG', 'Boutique Test'],
    ['PERSON', 'Awa Test'],
    ['ANONYMIZED', null],
  ] as Array<[Customer, string | null]>)(
    'writes the public name of a %s customer, never the label (AC-2)',
    async (customer, name) => {
      await seedDeliveredOrder(customer);
      await runMigration();
      expect((await receiptOf(ORDER)).customer_name_applied).toBe(name);
    }
  );

  it('ignores entries recorded after the delivery (AC-3)', async () => {
    await seedDeliveredOrder();
    await seedEntry(LATER_PAYMENT, 'PAYMENT', 2000, AFTER, ORDER);
    await runMigration();
    const receipt = await receiptOf(ORDER);
    expect(receipt.collected_applied).toBe('5000');
    expect(receipt.balance_after_applied).toBe('10500');
  });

  it('sets collected to 0 when no payment came with the sale', async () => {
    await seedBase('ORG');
    await seedOrder(ORDER, 'DELIVERED');
    await seedEntry(SALE, 'SALE', 12500, DELIVERY, ORDER);
    await runMigration();
    const receipt = await receiptOf(ORDER);
    expect(receipt.collected_applied).toBe('0');
    expect(receipt.balance_after_applied).toBe('12500');
  });

  it('leaves a receipt already written and the other orders untouched', async () => {
    await seedDeliveredOrder();
    await seedOrder(ORDER_2, 'DELIVERED', { supplierName: 'Written by DLV-019' });
    await seedEntry(SALE_2, 'SALE', 12500, DELIVERY, ORDER_2);
    await seedOrder('0199d042-0000-7000-8000-000000000103', 'CONFIRMED');
    await runMigration();
    expect((await receiptOf(ORDER_2)).supplier_name_applied).toBe('Written by DLV-019');
    expect((await receiptOf('0199d042-0000-7000-8000-000000000103')).supplier_name_applied).toBeNull();
  });

  it('switches the status rules back on after the backfill', async () => {
    await seedDeliveredOrder();
    await runMigration();
    const { rows } = await client.query<{ tgenabled: string }>(
      `SELECT tgenabled FROM pg_trigger WHERE tgname = 'orders_enforce_status_rules'`
    );
    expect(rows).toEqual([{ tgenabled: 'O' }]);
  });

  it('stops when a delivered order has no SALE and changes no order (AC-4)', async () => {
    await seedDeliveredOrder();
    await seedOrder(ORDER_2, 'DELIVERED');
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    const failure = await attempt(migrationSql());
    expect(failure?.message).toContain(ORDER_2);
    expect(failure?.message).not.toContain(ORDER);
    expect((await receiptOf(ORDER)).supplier_name_applied).toBeNull();
    expect((await receiptOf(ORDER_2)).supplier_name_applied).toBeNull();
  });
});

describe('ORD-042 freeze', () => {
  beforeEach(dropReceiptCheck);

  const FIELDS: Array<[string, string, unknown]> = [
    ['supplier_name_applied', '$1', 'Other supplier'],
    ['customer_name_applied', '$1', 'Other customer'],
    ['customer_name_applied', 'NULL', null],
    ['collected_applied', '$1::bigint', 4000],
    ['balance_after_applied', '$1::bigint', 1],
  ];

  /** A CONFIRMED order carries a set receipt: only the freeze trigger can refuse its changes. */
  async function seedFrozen() {
    await seedBase('ORG');
    await seedOrder(ORDER, 'CONFIRMED', { supplierName: 'Dépôt Test' });
  }

  it.each(FIELDS)('refuses a change of %s with 23514 (AC-5, C-62)', async (field, expr, value) => {
    await seedFrozen();
    const before = await receiptOf(ORDER);
    const failure = await attempt(
      `UPDATE orders SET ${field} = ${expr} WHERE id = '${ORDER}'::uuid`,
      expr === 'NULL' ? [] : [value]
    );
    expect(failure?.code).toBe('23514');
    expect(await receiptOf(ORDER)).toEqual(before);
  });

  it('accepts a change of supplier_note and a rewrite with the same values (AC-5)', async () => {
    await seedFrozen();
    expect(
      await attempt(`UPDATE orders SET supplier_note = 'Call me' WHERE id = '${ORDER}'::uuid`)
    ).toBeUndefined();
    expect(
      await attempt(
        `UPDATE orders SET supplier_name_applied = 'Dépôt Test', collected_applied = 5000
         WHERE id = '${ORDER}'::uuid`
      )
    ).toBeUndefined();
  });

  it('lets the writer set an empty receipt once', async () => {
    await seedBase('ORG');
    await seedOrder(ORDER, 'CONFIRMED');
    expect(
      await attempt(
        `UPDATE orders SET supplier_name_applied = 'Dépôt Test', customer_name_applied = 'X',
           collected_applied = 0, balance_after_applied = 0 WHERE id = '${ORDER}'::uuid`
      )
    ).toBeUndefined();
  });

  it('keeps the receipt of a delivered order when a raw update lowers it (AB-1)', async () => {
    await seedDeliveredOrder();
    await dropFreezeTrigger();
    await runMigration();
    const failure = await attempt(
      `UPDATE orders SET collected_applied = 1000 WHERE id = '${ORDER}'::uuid`
    );
    expect(failure?.code).toBe('23514');
    expect((await receiptOf(ORDER)).collected_applied).toBe('5000');
  });
});
