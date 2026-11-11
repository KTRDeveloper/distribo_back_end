import { beforeEach, describe, expect, it } from 'vitest';
import { RECEIPT_FIELDS } from '../../helpers/receipt-fields';
import { prisma } from '../../setup';

const SUPPLIER_ORG_ID = '0199c005-0000-7000-8000-000000000001';
const OWNER_ID = '0199c005-0000-7000-8000-000000000011';
const CUSTOMER_ID = '0199c005-0000-7000-8000-000000000012';
const REL_ID = '0199c005-0000-7000-8000-000000000021';
const ORDER_ID = '0199c005-0000-7000-8000-000000000031';
const AT = new Date('2026-01-02T00:00:00.000Z');

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

type Status = 'PENDING' | 'CONFIRMED' | 'IN_DELIVERY' | 'DELIVERED' | 'CANCELLED';

type Row = {
  status?: Status;
  placedByParty?: 'CUSTOMER' | 'SUPPLIER';
  cancelledByParty?: 'CUSTOMER' | 'SUPPLIER' | null;
  cancelledById?: string | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
  deliveredAt?: Date | null;
  deliveredById?: string | null;
  syncIssue?: string | null;
};

/** Inserts an order with the given status columns; the defaults make a valid CONFIRMED order. */
function insertOrder(row: Row = {}): Promise<number> {
  const receipt = row.status === 'DELIVERED' ? RECEIPT_FIELDS : null;
  return prisma.$executeRaw`
    INSERT INTO orders (
      id, customer_relationship_id, placed_by_party, entered_by_id, total_amount, status,
      cancelled_by_party, cancelled_by_id, cancelled_at, cancellation_reason,
      delivered_at, delivered_by_id, sync_issue, supplier_name_applied, customer_name_applied,
      collected_applied, balance_after_applied
    )
    VALUES (
      ${ORDER_ID}::uuid, ${REL_ID}::uuid,
      ${row.placedByParty ?? 'CUSTOMER'}::text::public."OrderParty", ${OWNER_ID}::uuid, 0,
      ${row.status ?? 'CONFIRMED'}::text::public."OrderStatus",
      ${row.cancelledByParty ?? null}::text::public."OrderParty", ${row.cancelledById ?? null}::uuid,
      ${row.cancelledAt ?? null}::timestamptz, ${row.cancellationReason ?? null}::text,
      ${row.deliveredAt ?? null}::timestamptz, ${row.deliveredById ?? null}::uuid,
      ${row.syncIssue ?? null}::text,
      ${receipt?.supplierNameApplied ?? null}::text, ${receipt?.customerNameApplied ?? null}::text,
      ${receipt?.collectedApplied ?? null}::bigint, ${receipt?.balanceAfterApplied ?? null}::bigint
    )
  `;
}

const CANCEL_BY_CUSTOMER = {
  cancelledByParty: 'CUSTOMER',
  cancelledById: CUSTOMER_ID,
  cancelledAt: AT,
} as const;
const DELIVERED = { deliveredAt: AT, deliveredById: OWNER_ID } as const;

/** A valid row in the given status (CANCELLED is a customer cancellation). */
function validRow(status: Status): Row {
  if (status === 'DELIVERED') return { status, ...DELIVERED };
  if (status === 'CANCELLED') return { status, ...CANCEL_BY_CUSTOMER };
  return { status };
}

/** The columns a step to `to` must change in the same update so the CHECKs hold. */
function stepUpdate(to: Status, syncIssue: string | null = null) {
  const cancelled = to === 'CANCELLED';
  const delivered = to === 'DELIVERED';
  return prisma.$executeRaw`
    UPDATE orders SET
      status = ${to}::text::public."OrderStatus",
      cancelled_by_party = ${cancelled ? 'CUSTOMER' : null}::text::public."OrderParty",
      cancelled_by_id = ${cancelled ? CUSTOMER_ID : null}::uuid,
      cancelled_at = ${cancelled ? AT : null}::timestamptz,
      delivered_at = ${delivered ? AT : null}::timestamptz,
      delivered_by_id = ${delivered ? OWNER_ID : null}::uuid,
      supplier_name_applied = ${delivered ? RECEIPT_FIELDS.supplierNameApplied : null}::text,
      customer_name_applied = ${delivered ? RECEIPT_FIELDS.customerNameApplied : null}::text,
      collected_applied = ${delivered ? RECEIPT_FIELDS.collectedApplied : null}::bigint,
      balance_after_applied = ${delivered ? RECEIPT_FIELDS.balanceAfterApplied : null}::bigint,
      sync_issue = COALESCE(${syncIssue}::text, sync_issue)
    WHERE id = ${ORDER_ID}::uuid
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
      { id: OWNER_ID, fullName: 'Fixture Owner', phoneNumber: '+2250700005011', ...registered },
      {
        id: CUSTOMER_ID,
        fullName: 'Fixture Customer',
        phoneNumber: '+2250700005012',
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
});

describe('cancellation columns (AC-1, C-16)', () => {
  const examples: Array<[string, Row, string | undefined]> = [
    [
      'CANCELLED, party, person, time and reason set',
      {
        status: 'CANCELLED',
        ...CANCEL_BY_CUSTOMER,
        cancelledByParty: 'SUPPLIER',
        cancellationReason: 'Out of stock',
      },
      undefined,
    ],
    [
      'CANCELLED, party SUPPLIER, reason empty',
      { status: 'CANCELLED', ...CANCEL_BY_CUSTOMER, cancelledByParty: 'SUPPLIER' },
      '23514',
    ],
    [
      'CANCELLED, party CUSTOMER, reason empty',
      { status: 'CANCELLED', ...CANCEL_BY_CUSTOMER },
      undefined,
    ],
    [
      'CANCELLED, time empty',
      { status: 'CANCELLED', ...CANCEL_BY_CUSTOMER, cancelledAt: null },
      '23514',
    ],
    [
      'CANCELLED, person empty',
      { status: 'CANCELLED', ...CANCEL_BY_CUSTOMER, cancelledById: null },
      '23514',
    ],
    [
      'CANCELLED, party empty',
      { status: 'CANCELLED', ...CANCEL_BY_CUSTOMER, cancelledByParty: null },
      '23514',
    ],
    [
      'CONFIRMED, cancelled_by_party set',
      { status: 'CONFIRMED', cancelledByParty: 'CUSTOMER' },
      '23514',
    ],
    [
      'CONFIRMED, cancelled_by_id set',
      { status: 'CONFIRMED', cancelledById: CUSTOMER_ID },
      '23514',
    ],
    ['CONFIRMED, cancelled_at set', { status: 'CONFIRMED', cancelledAt: AT }, '23514'],
    [
      'CONFIRMED, cancellation_reason set',
      { status: 'CONFIRMED', cancellationReason: 'x' },
      '23514',
    ],
  ];

  it.each(examples)('%s', async (_name, row, expected) => {
    expect(await captureSqlCode(insertOrder(row))).toBe(expected);
  });
});

describe("pending is the customer's (AC-2, C-17)", () => {
  it('rejects PENDING placed by SUPPLIER with 23514 and accepts it placed by CUSTOMER', async () => {
    expect(
      await captureSqlCode(insertOrder({ status: 'PENDING', placedByParty: 'SUPPLIER' }))
    ).toBe('23514');
    await expect(insertOrder({ status: 'PENDING', placedByParty: 'CUSTOMER' })).resolves.toBe(1);
  });

  it('rejects moving a supplier-placed order to PENDING', async () => {
    await insertOrder({ placedByParty: 'SUPPLIER' });
    expect(await captureSqlCode(stepUpdate('PENDING'))).toBe('23514');
  });
});

describe('delivery columns (AC-3, C-19)', () => {
  const statuses: Status[] = ['PENDING', 'CONFIRMED', 'IN_DELIVERY', 'CANCELLED'];

  it('requires delivered_at and delivered_by_id for DELIVERED', async () => {
    expect(await captureSqlCode(insertOrder({ status: 'DELIVERED' }))).toBe('23514');
    expect(await captureSqlCode(insertOrder({ status: 'DELIVERED', deliveredAt: AT }))).toBe(
      '23514'
    );
    expect(
      await captureSqlCode(insertOrder({ status: 'DELIVERED', deliveredById: OWNER_ID }))
    ).toBe('23514');
    await expect(insertOrder({ status: 'DELIVERED', ...DELIVERED })).resolves.toBe(1);
  });

  it.each(statuses)('refuses delivered_at and delivered_by_id on %s', async (status) => {
    const base = validRow(status);
    expect(await captureSqlCode(insertOrder({ ...base, deliveredAt: AT }))).toBe('23514');
    expect(await captureSqlCode(insertOrder({ ...base, deliveredById: OWNER_ID }))).toBe('23514');
  });
});

describe('status steps (AC-4, C-18, CM-12)', () => {
  const examples: Array<[Status, Status, string | undefined]> = [
    ['PENDING', 'CONFIRMED', undefined],
    ['PENDING', 'CANCELLED', undefined],
    ['PENDING', 'DELIVERED', '23514'],
    ['PENDING', 'IN_DELIVERY', '23514'],
    ['CONFIRMED', 'IN_DELIVERY', undefined],
    ['CONFIRMED', 'DELIVERED', undefined],
    ['CONFIRMED', 'CANCELLED', undefined],
    ['CONFIRMED', 'PENDING', '23514'],
    ['IN_DELIVERY', 'CONFIRMED', undefined],
    ['IN_DELIVERY', 'DELIVERED', undefined],
    ['IN_DELIVERY', 'CANCELLED', '23514'],
    ['IN_DELIVERY', 'PENDING', '23514'],
    ['DELIVERED', 'CANCELLED', '23514'],
    ['DELIVERED', 'CONFIRMED', '23514'],
    ['CANCELLED', 'CONFIRMED', '23514'],
    ['CANCELLED', 'PENDING', '23514'],
  ];

  it.each(examples)('%s to %s', async (from, to, expected) => {
    await insertOrder(validRow(from));
    expect(await captureSqlCode(stepUpdate(to))).toBe(expected);
  });

  it('accepts CANCELLED to DELIVERED when sync_issue is set, and clears the cancellation', async () => {
    await insertOrder({
      ...validRow('CANCELLED'),
      cancelledByParty: 'SUPPLIER',
      cancellationReason: 'Out of stock',
    });
    // The caller does not clear the cancellation columns itself.
    await expect(
      prisma.$executeRaw`
        UPDATE orders SET status = 'DELIVERED', delivered_at = ${AT}::timestamptz,
          delivered_by_id = ${OWNER_ID}::uuid, sync_issue = 'delivered while cancelled',
          supplier_name_applied = ${RECEIPT_FIELDS.supplierNameApplied}::text,
          customer_name_applied = ${RECEIPT_FIELDS.customerNameApplied}::text,
          collected_applied = ${RECEIPT_FIELDS.collectedApplied}::bigint,
          balance_after_applied = ${RECEIPT_FIELDS.balanceAfterApplied}::bigint
        WHERE id = ${ORDER_ID}::uuid
      `
    ).resolves.toBe(1);
    const [row] = await prisma.$queryRaw<
      Array<{
        status: string;
        party: string | null;
        by: string | null;
        at: Date | null;
        reason: string | null;
      }>
    >`
      SELECT status::text AS status, cancelled_by_party AS party, cancelled_by_id AS by,
             cancelled_at AS at, cancellation_reason AS reason
      FROM orders WHERE id = ${ORDER_ID}::uuid
    `;
    expect(row).toEqual({ status: 'DELIVERED', party: null, by: null, at: null, reason: null });
  });

  it('rejects CANCELLED to DELIVERED when sync_issue is empty', async () => {
    await insertOrder(validRow('CANCELLED'));
    expect(await captureSqlCode(stepUpdate('DELIVERED'))).toBe('23514');
  });

  it('accepts CANCELLED to DELIVERED through stepUpdate when sync_issue is set', async () => {
    await insertOrder(validRow('CANCELLED'));
    await expect(stepUpdate('DELIVERED', 'late sync')).resolves.toBe(1);
  });

  it('leaves a non-frozen order free to change other columns', async () => {
    await insertOrder({ status: 'CONFIRMED' });
    await expect(
      prisma.$executeRaw`UPDATE orders SET delivery_cost = 500, total_amount = total_amount + 500 WHERE id = ${ORDER_ID}::uuid`
    ).resolves.toBe(1);
  });
});

describe('frozen orders (AC-5, C-18)', () => {
  it.each(['DELIVERED', 'CANCELLED'] as const)(
    'refuses a new delivery_cost on a %s order and accepts supplier_note and sync_issue',
    async (status) => {
      await insertOrder(validRow(status));
      expect(
        await captureSqlCode(
          prisma.$executeRaw`UPDATE orders SET delivery_cost = 500 WHERE id = ${ORDER_ID}::uuid`
        )
      ).toBe('23514');
      await expect(
        prisma.$executeRaw`UPDATE orders SET supplier_note = 'Left at the gate' WHERE id = ${ORDER_ID}::uuid`
      ).resolves.toBe(1);
      await expect(
        prisma.$executeRaw`UPDATE orders SET sync_issue = 'offline conflict' WHERE id = ${ORDER_ID}::uuid`
      ).resolves.toBe(1);
    }
  );
});

describe('crafted updates (AB-1, CWE-841)', () => {
  it('refuses to revive a CANCELLED order, even with its cancellation columns cleared', async () => {
    await insertOrder(validRow('CANCELLED'));
    expect(
      await captureSqlCode(prisma.$executeRaw`
        UPDATE orders SET status = 'CONFIRMED', cancelled_by_party = NULL, cancelled_by_id = NULL,
          cancelled_at = NULL
        WHERE id = ${ORDER_ID}::uuid
      `)
    ).toBe('23514');
  });

  it('refuses to edit the cost, total or delivery data of a DELIVERED order', async () => {
    await insertOrder(validRow('DELIVERED'));
    for (const update of [
      prisma.$executeRaw`UPDATE orders SET delivery_cost = 1 WHERE id = ${ORDER_ID}::uuid`,
      prisma.$executeRaw`UPDATE orders SET total_amount = 1 WHERE id = ${ORDER_ID}::uuid`,
      prisma.$executeRaw`UPDATE orders SET delivered_at = now() WHERE id = ${ORDER_ID}::uuid`,
      prisma.$executeRaw`UPDATE orders SET deleted_at = now() WHERE id = ${ORDER_ID}::uuid`,
    ]) {
      expect(await captureSqlCode(update)).toBe('23514');
    }
  });

  it('refuses to cancel a DELIVERED order even if the cancellation columns are filled', async () => {
    await insertOrder(validRow('DELIVERED'));
    expect(
      await captureSqlCode(prisma.$executeRaw`
        UPDATE orders SET status = 'CANCELLED', cancelled_by_party = 'CUSTOMER',
          cancelled_by_id = ${CUSTOMER_ID}::uuid, cancelled_at = now(), delivered_at = NULL,
          delivered_by_id = NULL
        WHERE id = ${ORDER_ID}::uuid
      `)
    ).toBe('23514');
  });
});
