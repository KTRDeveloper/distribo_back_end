import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
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
