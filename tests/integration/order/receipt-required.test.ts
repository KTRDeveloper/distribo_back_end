import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const OWNER = '0199d045-0000-7000-8000-000000000001';
const SUPPLIER_ORG = '0199d045-0000-7000-8000-0000000000a1';
const CUSTOMER_ORG = '0199d045-0000-7000-8000-0000000000a2';
const REL = '0199d045-0000-7000-8000-0000000000e1';
const ORDER = '0199d045-0000-7000-8000-000000000101';
const ORDER_2 = '0199d045-0000-7000-8000-000000000102';
const ORDER_3 = '0199d045-0000-7000-8000-000000000103';

const MIGRATION_DIR = join(__dirname, '../../../prisma/migrations');
const CONSTRAINT = 'orders_receipt_matches_status_check';

/** SQL of the ORD-045 migration. */
function migrationSql(): string {
  const found = readdirSync(MIGRATION_DIR).filter((name) =>
    name.endsWith('_ord_045_delivered_needs_receipt')
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
  await client.query(
    `INSERT INTO people (id, full_name, phone_number, phone_verified_at, password_hash,
                         registered_at, preferred_language)
     VALUES ($1::uuid, 'Owner Test', '+2250700045001', now(), 'fixture-hash', now(), 'FR')`,
    [OWNER]
  );
  await client.query(
    `INSERT INTO organizations (id, name, status) VALUES
       ($1::uuid, 'Dépôt Test', 'ACTIVE'), ($2::uuid, 'Boutique Test', 'ACTIVE')`,
    [SUPPLIER_ORG, CUSTOMER_ORG]
  );
  await client.query(
    `INSERT INTO customer_relationships (id, supplier_organization_id, customer_organization_id,
                                         customer_label, created_by_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'Tata', $4::uuid)`,
    [REL, SUPPLIER_ORG, CUSTOMER_ORG, OWNER]
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
): Promise<{ code: string; message: string; constraint?: string } | undefined> {
  await client.query('SAVEPOINT attempt');
  try {
    await client.query(sql, values);
    await client.query('RELEASE SAVEPOINT attempt');
    return undefined;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    const { code, message, constraint } = error as {
      code?: string;
      message: string;
      constraint?: string;
    };
    return { code: code ?? 'UNKNOWN', message, constraint };
  }
}

type Receipt = {
  supplier: string | null;
  customer: string | null;
  collected: number | null;
  balance: number | null;
};

const FULL: Receipt = { supplier: 'Dépôt Test', customer: null, collected: 0, balance: 0 };
const EMPTY: Receipt = { supplier: null, customer: null, collected: null, balance: null };

/** Inserts an order with the given status and receipt fields. */
function insertOrder(id: string, status: string, receipt: Receipt) {
  const delivered = status === 'DELIVERED';
  const cancelled = status === 'CANCELLED';
  return attempt(
    `INSERT INTO orders (id, customer_relationship_id, placed_by_party, entered_by_id, status,
                         total_amount, delivery_cost, delivered_at, delivered_by_id,
                         cancelled_by_party, cancelled_by_id, cancelled_at,
                         supplier_name_applied, customer_name_applied, collected_applied,
                         balance_after_applied)
     VALUES ($1::uuid, $2::uuid, $14::"OrderParty", $3::uuid, $4::"OrderStatus", 12500, 12500,
             $5::timestamptz, $6::uuid, $7::"OrderParty", $8::uuid, $9::timestamptz,
             $10, $11, $12::bigint, $13::bigint)`,
    [
      id,
      REL,
      OWNER,
      status,
      delivered ? new Date() : null,
      delivered ? OWNER : null,
      cancelled ? 'CUSTOMER' : null,
      cancelled ? OWNER : null,
      cancelled ? new Date() : null,
      receipt.supplier,
      receipt.customer,
      receipt.collected,
      receipt.balance,
      status === 'PENDING' ? 'CUSTOMER' : 'SUPPLIER',
    ]
  );
}

describe('ORD-045 rule', () => {
  it.each([
    ['DELIVERED', 'the three fields set, customer name empty', FULL, undefined],
    ['DELIVERED', 'no supplier_name_applied', { ...FULL, supplier: null }, '23514'],
    ['PENDING', 'collected_applied 0, the other fields empty', { ...EMPTY, collected: 0 }, '23514'],
    ['CANCELLED', 'the four fields empty', EMPTY, undefined],
  ] as Array<[string, string, Receipt, string | undefined]>)(
    'AC-1 %s with %s',
    async (status, _fields, receipt, code) => {
      const failure = await insertOrder(ORDER, status, receipt);
      expect(failure?.code).toBe(code);
    }
  );

  it('refuses a DELIVERED order missing collected or balance, and a customer name on a PENDING one', async () => {
    expect((await insertOrder(ORDER, 'DELIVERED', { ...FULL, collected: null }))?.code).toBe('23514');
    expect((await insertOrder(ORDER, 'DELIVERED', { ...FULL, balance: null }))?.code).toBe('23514');
    expect((await insertOrder(ORDER, 'PENDING', { ...EMPTY, customer: 'X' }))?.code).toBe('23514');
  });
});

describe('ORD-045 audit', () => {
  /** The state before the migration: the check does not exist yet. */
  async function dropCheck() {
    await client.query(`ALTER TABLE orders DROP CONSTRAINT ${CONSTRAINT}`);
  }

  it('AC-2 stops and names the orders that break the rule, applying nothing', async () => {
    await dropCheck();
    await insertOrder(ORDER, 'DELIVERED', FULL);
    await insertOrder(ORDER_2, 'DELIVERED', EMPTY);
    await insertOrder(ORDER_3, 'PENDING', { ...EMPTY, collected: 0 });
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    const failure = await attempt(migrationSql());
    expect(failure?.message).toContain(ORDER_2);
    expect(failure?.message).toContain(ORDER_3);
    expect(failure?.message).not.toContain(ORDER);
    const { rows } = await client.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [
      CONSTRAINT,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('adds the check when every order obeys the rule', async () => {
    await dropCheck();
    await insertOrder(ORDER, 'DELIVERED', FULL);
    await insertOrder(ORDER_2, 'CANCELLED', EMPTY);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    expect(await attempt(migrationSql())).toBeUndefined();
    const { rows } = await client.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [
      CONSTRAINT,
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe('ORD-045 bypass', () => {
  it('AB-1 refuses a raw update to DELIVERED without a receipt with 23514', async () => {
    expect(await insertOrder(ORDER, 'CONFIRMED', EMPTY)).toBeUndefined();
    const failure = await attempt(
      `UPDATE orders SET status = 'DELIVERED', delivered_at = now(), delivered_by_id = $2::uuid
       WHERE id = $1::uuid`,
      [ORDER, OWNER]
    );
    expect(failure?.code).toBe('23514');
    expect(failure?.constraint).toBe(CONSTRAINT);
  });
});
