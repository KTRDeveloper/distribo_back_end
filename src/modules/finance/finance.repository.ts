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
