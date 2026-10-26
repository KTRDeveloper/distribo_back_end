import { seedProduct } from '../../helpers/catalog-fixtures.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { prisma } from '../../setup';

const SUPPLIER_ORG_ID = '0199c007-0000-7000-8000-000000000001';
const OWNER_ID = '0199c007-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c007-0000-7000-8000-000000000012';
const REL_ID = '0199c007-0000-7000-8000-000000000021';
const ORDER_ID = '0199c007-0000-7000-8000-000000000031';
const OTHER_ORDER_ID = '0199c007-0000-7000-8000-000000000032';
const PRODUCT_ID = '0199c007-0000-7000-8000-000000000041';
const LINE_1 = '0199c007-0000-7000-8000-000000000051';
const LINE_2 = '0199c007-0000-7000-8000-000000000052';
const AT = new Date('2026-01-02T00:00:00.000Z');

/** Minimal client for the statements of one transaction; reads the SQLSTATE of a failed commit. */
type Tx = {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

/**
 * Runs the work in one real transaction on its own connection and commits.
 * Returns the SQLSTATE of the failure (statement or commit), undefined on success.
 * Prisma's interactive transactions hide the code of a commit-time failure.
 */
async function commitCode(work: (tx: Tx) => Promise<unknown>): Promise<string | undefined> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const tx: Tx = {
    async $executeRaw(strings, ...values) {
      const text = strings.reduce(
        (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''),
        ''
      );
      const result = await client.query(
        text,
        values.map((v) => (typeof v === 'bigint' ? v.toString() : v))
      );
      return result.rowCount ?? 0;
    },
  };
  try {
    await client.query('BEGIN');
    await work(tx);
    await client.query('COMMIT');
    return undefined;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return (error as { code?: string }).code ?? 'UNKNOWN';
  } finally {
    await client.end();
  }
}

function insertOrder(tx: Tx, id: string, total: bigint, cost: bigint = 0n): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO orders (
      id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, delivery_cost
    )
    VALUES (${id}::uuid, ${REL_ID}::uuid, 'SUPPLIER'::public."OrderParty", ${OWNER_ID}::uuid,
      ${total}::bigint, ${cost}::bigint)
  `;
}

/** Inserts a 5 x 3000 line (amount 15000), optionally already delivered in full. */
function insertLine(
  tx: Tx,
  id: string,
  orderId: string,
  deliveredQuantity: string | null = null
): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO order_lines (
      id, order_id, product_variant_id, label_applied, quantity, delivered_quantity,
      reference_price, unit_price_applied, amount
    )
    VALUES (${id}::uuid, ${orderId}::uuid, ${PRODUCT_ID}::uuid, 'Fixture Rice', 5,
      ${deliveredQuantity}::numeric, 3000, 3000, 15000)
  `;
}

/** Commits an order of total 33000 (cost 3000) with two lines of 15000. */
async function seedConsistentOrder(deliveredQuantity: string | null = null): Promise<void> {
  const code = await commitCode(async (tx) => {
    await insertOrder(tx, ORDER_ID, 33000n, 3000n);
    await insertLine(tx, LINE_1, ORDER_ID, deliveredQuantity);
    await insertLine(tx, LINE_2, ORDER_ID, deliveredQuantity);
  });
  expect(code).toBeUndefined();
}

beforeEach(async () => {
  const registered = {
    phoneVerifiedAt: AT,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture',
    registeredAt: AT,
    preferredLanguage: 'FR' as const,
  };
  await prisma.person.createMany({
    data: [
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700007011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700007012',
        ...registered,
      },
    ],
  });
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${SUPPLIER_ORG_ID}::uuid, 'Fixture Supplier')
  `;
  await prisma.$executeRaw`
    INSERT INTO customer_relationships (id, supplier_organization_id, customer_person_id, created_by_id)
    VALUES (${REL_ID}::uuid, ${SUPPLIER_ORG_ID}::uuid, ${CUSTOMER_ID}::uuid, ${OWNER_ID}::uuid)
  `;
  await seedProduct(prisma, {
    id: PRODUCT_ID,
    organizationId: SUPPLIER_ORG_ID,
    name: 'Fixture Rice',
    unit: 'sack',
    price: 3000n,
  });
});

describe('consistent order (AC-1)', () => {
  it('commits total 33000 for lines of 15000 and 15000 with delivery cost 3000', async () => {
    expect(await commitCode(() => seedConsistentOrder())).toBeUndefined();
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM order_lines WHERE order_id = ${ORDER_ID}::uuid
    `;
    expect(Number(rows[0]?.count)).toBe(2);
  });
});

describe('inconsistent totals (AC-2, C-19)', () => {
  it('rejects total 30000 for lines summing to 33000 with cost 0', async () => {
    const code = await commitCode(async (tx) => {
      await insertOrder(tx, ORDER_ID, 30000n);
      await insertLine(tx, LINE_1, ORDER_ID);
      await insertLine(tx, LINE_2, ORDER_ID);
      await tx.$executeRaw`UPDATE order_lines SET amount = 18000, quantity = 6 WHERE id = ${LINE_2}::uuid`;
    });
    expect(code).toBe('23514');
  });

  it('rejects a total changed without changing a line', async () => {
    await seedConsistentOrder();
    const code = await commitCode(async (tx) => {
      await tx.$executeRaw`UPDATE orders SET total_amount = 34000 WHERE id = ${ORDER_ID}::uuid`;
    });
    expect(code).toBe('23514');
  });

  it('rejects a line amount changed without changing the total', async () => {
    await seedConsistentOrder();
    const code = await commitCode(async (tx) => {
      await tx.$executeRaw`
        UPDATE order_lines SET quantity = 4, amount = 12000 WHERE id = ${LINE_1}::uuid
      `;
    });
    expect(code).toBe('23514');
  });

  it('accepts an order with no lines and total_amount = delivery_cost', async () => {
    expect(
      await commitCode(async (tx) => void (await insertOrder(tx, ORDER_ID, 3000n, 3000n)))
    ).toBe(undefined);
  });

  it('rejects an order with no lines and total_amount different from delivery_cost', async () => {
    expect(
      await commitCode(async (tx) => void (await insertOrder(tx, ORDER_ID, 5000n, 3000n)))
    ).toBe('23514');
  });

  it('rejects removing a line without lowering the total', async () => {
    await seedConsistentOrder();
    const code = await commitCode(async (tx) => {
      await tx.$executeRaw`DELETE FROM order_lines WHERE id = ${LINE_1}::uuid`;
    });
    expect(code).toBe('23514');
  });

  it('ignores a soft-deleted line in the sum', async () => {
    await seedConsistentOrder();
    const code = await commitCode(async (tx) => {
      await tx.$executeRaw`UPDATE order_lines SET deleted_at = now() WHERE id = ${LINE_1}::uuid`;
      await tx.$executeRaw`UPDATE orders SET total_amount = 18000 WHERE id = ${ORDER_ID}::uuid`;
    });
    expect(code).toBeUndefined();
  });

  it('rejects moving a line to another order that keeps its old total', async () => {
    await seedConsistentOrder();
    expect(await commitCode((tx) => insertOrder(tx, OTHER_ORDER_ID, 0n))).toBeUndefined();
    const code = await commitCode(async (tx) => {
      await tx.$executeRaw`UPDATE order_lines SET order_id = ${OTHER_ORDER_ID}::uuid WHERE id = ${LINE_1}::uuid`;
      await tx.$executeRaw`UPDATE orders SET total_amount = 15000 WHERE id = ${OTHER_ORDER_ID}::uuid`;
    });
    // The source order still claims 33000 for 15000 of lines plus the cost.
    expect(code).toBe('23514');
  });
});

describe('delivered quantities (AC-3, C-19)', () => {
  it('rejects DELIVERED while a line has no delivered_quantity', async () => {
    await seedConsistentOrder();
    const code = await commitCode(async (tx) => {
      await tx.$executeRaw`
        UPDATE orders
        SET status = 'DELIVERED', delivered_at = now(), delivered_by_id = ${OWNER_ID}::uuid
        WHERE id = ${ORDER_ID}::uuid
      `;
    });
    expect(code).toBe('23514');
  });

  it('accepts DELIVERED when every line has a delivered_quantity', async () => {
    await seedConsistentOrder('5');
    const code = await commitCode(async (tx) => {
      await tx.$executeRaw`
        UPDATE orders
        SET status = 'DELIVERED', delivered_at = now(), delivered_by_id = ${OWNER_ID}::uuid
        WHERE id = ${ORDER_ID}::uuid
      `;
    });
    expect(code).toBeUndefined();
  });
});

describe('same transaction (AC-4, v5.0.0-2.3.3)', () => {
  it('commits lines and total changed together, total written first', async () => {
    await seedConsistentOrder();
    const code = await commitCode(async (tx) => {
      await tx.$executeRaw`UPDATE orders SET total_amount = 18000 WHERE id = ${ORDER_ID}::uuid`;
      await tx.$executeRaw`DELETE FROM order_lines WHERE id = ${LINE_2}::uuid`;
    });
    expect(code).toBeUndefined();
  });

  it('commits a line change followed by the total change', async () => {
    await seedConsistentOrder();
    const code = await commitCode(async (tx) => {
      await tx.$executeRaw`
        UPDATE order_lines SET quantity = 4, amount = 12000 WHERE id = ${LINE_1}::uuid
      `;
      await tx.$executeRaw`UPDATE orders SET total_amount = 30000 WHERE id = ${ORDER_ID}::uuid`;
    });
    expect(code).toBeUndefined();
  });
});

describe('hidden discount (AB-1, CWE-345)', () => {
  it('refuses a total lowered below the sum of the lines', async () => {
    await seedConsistentOrder();
    const code = await commitCode(async (tx) => {
      await tx.$executeRaw`UPDATE orders SET total_amount = 20000 WHERE id = ${ORDER_ID}::uuid`;
    });
    expect(code).toBe('23514');
    const rows = await prisma.$queryRaw<Array<{ total_amount: bigint }>>`
      SELECT total_amount FROM orders WHERE id = ${ORDER_ID}::uuid
    `;
    expect(rows[0]?.total_amount).toBe(33000n);
  });
});
