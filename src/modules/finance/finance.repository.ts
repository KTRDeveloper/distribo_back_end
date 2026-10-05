import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { lineAmount, parseQuantity } from '../../shared/money.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import { findAbandonedRests } from '../delivery/delivery.repository.js';
import { visibleRelationsWhere } from '../relationship/relationship.visibility.js';

/** Which party reads the ledger: the supplier organization, a customer organization or a customer person. */
export type LedgerSide = 'SUPPLIER' | 'CUSTOMER_ORGANIZATION' | 'CUSTOMER_PERSON';

/** Where clause of one relationship as the reading party sees it: visibility, party column and id together. */
function ledgerScope(
  side: LedgerSide,
  viewer: { personId: string; organizationId?: string },
  id: string
): Prisma.CustomerRelationshipWhereInput {
  const organizationIds = viewer.organizationId ? [viewer.organizationId] : [];
  const party: Prisma.CustomerRelationshipWhereInput =
    side === 'SUPPLIER'
      ? { supplierOrganizationId: viewer.organizationId ?? null }
      : side === 'CUSTOMER_ORGANIZATION'
        ? { customerOrganizationId: viewer.organizationId ?? null }
        : { customerPersonId: viewer.personId };
  return {
    AND: [
      visibleRelationsWhere({
        personId: viewer.personId,
        organizationIds: side === 'CUSTOMER_PERSON' ? [] : organizationIds,
      }),
      party,
      { id },
    ],
  };
}

/**
 * Reads one page of a relationship's ledger, newest `occurred_at` first then id, keyset-paged.
 * The relationship is matched by visibility, party column and id in the same query (ASVS
 * v5.0.0-8.2.2), so a relationship the viewer is not a party to, a deleted or a merged one answers
 * null exactly like an absent id. The page and the balance are read in one repeatable-read
 * transaction so they agree.
 *
 * @param side - Which party the viewer is, decided by the route, never by the client.
 * @param viewer - Person (and organization for an organization side) from the session or actor.
 * @param id - Relationship id from the path.
 * @param query - Page size and opaque cursor.
 * @returns The balance, the rows (at most limit) and the next cursor; null when not visible.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listLedgerPage(
  side: LedgerSide,
  viewer: { personId: string; organizationId?: string },
  id: string,
  query: { limit: number; cursor?: string }
) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  return prisma.$transaction(
    async (tx) => {
      const relationship = await tx.customerRelationship.findFirst({
        where: ledgerScope(side, viewer, id),
        select: { id: true, balance: true },
      });
      if (!relationship) return null;

      const and: Prisma.LedgerEntryWhereInput[] = [{ customerRelationshipId: relationship.id }];
      if (cursor) {
        and.push({
          OR: [
            { occurredAt: { lt: cursor.createdAt } },
            { occurredAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        });
      }
      const found = await tx.ledgerEntry.findMany({
        where: { AND: and },
        orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
        take: query.limit + 1,
      });
      const rows = found.slice(0, query.limit);
      const last = rows[rows.length - 1];
      return {
        balance: relationship.balance,
        rows,
        nextCursor:
          found.length > query.limit && last
            ? encodeCursor({ createdAt: last.occurredAt, id: last.id })
            : null,
      };
    },
    { isolationLevel: 'RepeatableRead' }
  );
}

/** One cached total that differs from the sum of its entries; amounts are decimal strings of integer XAF. */
export type ReconcileRow = { id: string; expected: string; actual: string };

/**
 * Reads, in one repeatable-read transaction (ASVS v5.0.0-2.3.3), every live relationship whose
 * `balance` differs from the sum of its entries' `balance_effect`, and every live collaboration
 * whose `amount_held` differs from the sum of the money it should hold (CM-17, C-37). Both reads
 * see the same snapshot, so a payment committing in between cannot make a clean cache look wrong.
 *
 * Held money of a collaboration, in the supplier organization of each entry's relationship:
 * PAYMENT +amount and REFUND -amount for the person who recorded the entry, a reversal counting the
 * other way for the person the original entry counted for; minus live expenses as payer; minus live
 * handovers as remitter; plus live handovers as receiver, unless remitter and receiver are the same
 * person (the former owner's automatic handover), which only subtracts.
 */
export function findCacheMismatches(): Promise<{
  balances: ReconcileRow[];
  held: ReconcileRow[];
}> {
  return prisma.$transaction(
    async (tx) => {
      const balances = await tx.$queryRaw<ReconcileRow[]>`
        SELECT cr.id::text AS id,
               COALESCE(SUM(le.balance_effect), 0)::text AS expected,
               cr.balance::text AS actual
        FROM customer_relationships cr
        LEFT JOIN ledger_entries le ON le.customer_relationship_id = cr.id
        WHERE cr.deleted_at IS NULL
        GROUP BY cr.id, cr.balance
        HAVING cr.balance <> COALESCE(SUM(le.balance_effect), 0)
        ORDER BY cr.id
      `;
      const held = await tx.$queryRaw<ReconcileRow[]>`
        WITH moves AS (
          SELECT COALESCE(orig.recorded_by_id, le.recorded_by_id) AS person_id,
                 cr.supplier_organization_id AS organization_id,
                 CASE WHEN le.kind = 'PAYMENT' THEN le.amount ELSE -le.amount END
                   * CASE WHEN le.reverses_entry_id IS NULL THEN 1 ELSE -1 END AS delta
          FROM ledger_entries le
          JOIN customer_relationships cr ON cr.id = le.customer_relationship_id
          LEFT JOIN ledger_entries orig ON orig.id = le.reverses_entry_id
          WHERE le.kind IN ('PAYMENT', 'REFUND') AND cr.supplier_organization_id IS NOT NULL
          UNION ALL
          SELECT paid_by_id, organization_id, -amount
          FROM expenses WHERE cancelled_at IS NULL
          UNION ALL
          SELECT from_person_id, organization_id, -amount
          FROM handovers WHERE cancelled_at IS NULL
          UNION ALL
          SELECT to_person_id, organization_id, amount
          FROM handovers WHERE cancelled_at IS NULL AND to_person_id <> from_person_id
        ),
        totals AS (
          SELECT person_id, organization_id, SUM(delta) AS expected
          FROM moves GROUP BY person_id, organization_id
        )
        SELECT c.id::text AS id,
               COALESCE(t.expected, 0)::text AS expected,
               c.amount_held::text AS actual
        FROM collaborations c
        LEFT JOIN totals t ON t.person_id = c.person_id AND t.organization_id = c.organization_id
        WHERE c.deleted_at IS NULL AND c.amount_held <> COALESCE(t.expected, 0)
        ORDER BY c.id
      `;
      return { balances, held };
    },
    { isolationLevel: 'RepeatableRead' }
  );
}

/** Count and total amount (whole XAF, bigint) of one kind of gesture. */
export type ExceptionTally = { count: number; amount: bigint };

/** What one person did in the period, by kind of money exception. */
export type PersonExceptionTally = {
  refunds: ExceptionTally;
  creditNotes: ExceptionTally;
  reversals: ExceptionTally;
  expenses: ExceptionTally;
  priceGaps: ExceptionTally;
  abandonedRests: ExceptionTally;
};

/**
 * Reads, in one repeatable-read transaction (ASVS v5.0.0-2.3.3), every money gesture of the
 * organization made by someone other than `excludePersonId` between `from` (inclusive) and
 * `toExclusive`, grouped by person (FIN-019). Every query is bound to the organization: ledger
 * entries through the relationship's supplier, expenses and handovers through their own column,
 * order lines through their order's relationship.
 *
 * - refunds and credit notes: entries that do not reverse another, by `recorded_by_id`, `occurred_at`;
 * - reversals: entries that reverse another, plus cancelled expenses and handovers, by the
 *   canceller (`cancelled_by_id`) and `cancelled_at`;
 * - expenses: not cancelled, by `recorded_by_id`, `occurred_at`;
 * - price gaps: live lines of live orders whose applied price is below the reference, by
 *   `price_set_by_id`, `price_set_at`; amount (reference - applied) x delivered (else ordered)
 *   quantity, rounded half up like a line amount;
 * - abandoned rests (DLV-012): goods left in partial deliveries without a child order, read by the
 *   delivery module's `findAbandonedRests` inside this same transaction, by deliverer and
 *   `delivered_at`.
 */
export function findMoneyExceptions(
  organizationId: string,
  period: { from: Date; toExclusive: Date },
  excludePersonId: string
): Promise<Map<string, PersonExceptionTally>> {
  const empty = (): ExceptionTally => ({ count: 0, amount: 0n });
  const notOwner = { not: excludePersonId };
  return prisma.$transaction(
    async (tx) => {
      const people = new Map<string, PersonExceptionTally>();
      const of = (personId: string): PersonExceptionTally => {
        let tally = people.get(personId);
        if (!tally) {
          tally = {
            refunds: empty(),
            creditNotes: empty(),
            reversals: empty(),
            expenses: empty(),
            priceGaps: empty(),
            abandonedRests: empty(),
          };
          people.set(personId, tally);
        }
        return tally;
      };
      const add = (target: ExceptionTally, count: number, amount: bigint | null) => {
        target.count += count;
        target.amount += amount ?? 0n;
      };
      const inPeriod = { gte: period.from, lt: period.toExclusive };
      const scope = { customerRelationship: { supplierOrganizationId: organizationId } };

      const entries = await tx.ledgerEntry.groupBy({
        by: ['recordedById', 'kind'],
        where: {
          ...scope,
          reversesEntryId: null,
          kind: { in: ['REFUND', 'CREDIT_NOTE'] },
          recordedById: notOwner,
          occurredAt: inPeriod,
        },
        _count: { _all: true },
        _sum: { amount: true },
      });
      for (const row of entries) {
        const tally = of(row.recordedById);
        add(
          row.kind === 'REFUND' ? tally.refunds : tally.creditNotes,
          row._count._all,
          row._sum.amount
        );
      }

      const reversalEntries = await tx.ledgerEntry.groupBy({
        by: ['recordedById'],
        where: {
          ...scope,
          reversesEntryId: { not: null },
          recordedById: notOwner,
          occurredAt: inPeriod,
        },
        _count: { _all: true },
        _sum: { amount: true },
      });
      for (const row of reversalEntries) {
        add(of(row.recordedById).reversals, row._count._all, row._sum.amount);
      }

      const expenses = await tx.expense.groupBy({
        by: ['recordedById'],
        where: {
          organizationId,
          cancelledAt: null,
          recordedById: notOwner,
          occurredAt: inPeriod,
        },
        _count: { _all: true },
        _sum: { amount: true },
      });
      for (const row of expenses)
        add(of(row.recordedById).expenses, row._count._all, row._sum.amount);

      const cancelledExpenses = await tx.expense.groupBy({
        by: ['cancelledById'],
        where: { organizationId, cancelledById: notOwner, cancelledAt: inPeriod },
        _count: { _all: true },
        _sum: { amount: true },
      });
      const cancelledHandovers = await tx.handover.groupBy({
        by: ['cancelledById'],
        where: { organizationId, cancelledById: notOwner, cancelledAt: inPeriod },
        _count: { _all: true },
        _sum: { amount: true },
      });
      for (const row of [...cancelledExpenses, ...cancelledHandovers]) {
        if (row.cancelledById)
          add(of(row.cancelledById).reversals, row._count._all, row._sum.amount);
      }

      const lines = await tx.orderLine.findMany({
        where: {
          deletedAt: null,
          priceSetById: notOwner,
          priceSetAt: inPeriod,
          order: { deletedAt: null, ...scope },
        },
        select: {
          priceSetById: true,
          referencePrice: true,
          unitPriceApplied: true,
          quantity: true,
          deliveredQuantity: true,
        },
      });
      for (const line of lines) {
        if (!line.priceSetById || line.unitPriceApplied >= line.referencePrice) continue;
        const quantity = parseQuantity((line.deliveredQuantity ?? line.quantity).toFixed(3));
        add(
          of(line.priceSetById).priceGaps,
          1,
          lineAmount(quantity, line.referencePrice - line.unitPriceApplied)
        );
      }

      const abandoned = await findAbandonedRests(tx, organizationId, period, excludePersonId);
      for (const [personId, rests] of abandoned) {
        add(of(personId).abandonedRests, rests.count, rests.amount);
      }
      return people;
    },
    { isolationLevel: 'RepeatableRead' }
  );
}

/** Money in and out of an organization over a period, whole XAF as bigint. */
export type TreasuryTotals = { inflows: bigint; outflows: bigint };

/**
 * Sums the money that moved through an organization between `from` (inclusive) and `toExclusive`
 * (FIN-020), in one repeatable-read transaction so the ledger and the expenses agree.
 * Inflows: PAYMENT entries where the organization is the supplier plus REFUND entries where it is
 * the customer; outflows: PAYMENT where it is the customer, REFUND where it is the supplier, plus
 * live expenses. A reversal entry subtracts from the bucket of the entry it mirrors; a cancelled
 * expense is left out. SALE, CREDIT_NOTE and OPENING_BALANCE move no money. The organization is
 * the caller's and is bound as a query parameter.
 */
export function findTreasuryTotals(
  organizationId: string,
  period: { from: Date; toExclusive: Date }
): Promise<TreasuryTotals> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        { as_supplier: boolean; kind: string; reversal: boolean; total: bigint }[]
      >`
        SELECT cr.supplier_organization_id = ${organizationId}::uuid AS as_supplier,
               le.kind::text AS kind,
               le.reverses_entry_id IS NOT NULL AS reversal,
               SUM(le.amount)::bigint AS total
        FROM ledger_entries le
        JOIN customer_relationships cr ON cr.id = le.customer_relationship_id
        WHERE le.kind IN ('PAYMENT', 'REFUND')
          AND (cr.supplier_organization_id = ${organizationId}::uuid
               OR cr.customer_organization_id = ${organizationId}::uuid)
          AND le.occurred_at >= ${period.from} AND le.occurred_at < ${period.toExclusive}
        GROUP BY 1, 2, 3
      `;
      let inflows = 0n;
      let outflows = 0n;
      for (const row of rows) {
        // PAYMENT comes in for the supplier, REFUND comes in for the customer.
        const comesIn = (row.kind === 'PAYMENT') === row.as_supplier;
        const signed = row.reversal ? -row.total : row.total;
        if (comesIn) inflows += signed;
        else outflows += signed;
      }
      const expenses = await tx.expense.aggregate({
        where: {
          organizationId,
          deletedAt: null,
          cancelledAt: null,
          occurredAt: { gte: period.from, lt: period.toExclusive },
        },
        _sum: { amount: true },
      });
      outflows += expenses._sum.amount ?? 0n;
      return { inflows, outflows };
    },
    { isolationLevel: 'RepeatableRead' }
  );
}

/**
 * Reads one page of an organization's expenses, newest `occurred_at` first then id, keyset-paged,
 * cancelled ones included (FIN-020). Only the caller's own organization is read.
 *
 * @param organizationId - The caller's organization.
 * @param query - Page size, opaque cursor and optional period (`from` inclusive, `toExclusive`).
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listExpensePage(
  organizationId: string,
  query: { limit: number; cursor?: string; from?: Date; toExclusive?: Date }
) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const and: Prisma.ExpenseWhereInput[] = [{ organizationId, deletedAt: null }];
  if (query.from) and.push({ occurredAt: { gte: query.from } });
  if (query.toExclusive) and.push({ occurredAt: { lt: query.toExclusive } });
  if (cursor) {
    and.push({
      OR: [
        { occurredAt: { lt: cursor.createdAt } },
        { occurredAt: cursor.createdAt, id: { gt: cursor.id } },
      ],
    });
  }
  const found = await prisma.expense.findMany({
    where: { AND: and },
    orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const rows = found.slice(0, query.limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.occurredAt, id: last.id })
        : null,
  };
}
