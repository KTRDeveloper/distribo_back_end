import type { Prisma, SubscriptionReceipt } from '@prisma/client';
import { newId } from '../../shared/ids.js';
import { prisma } from '../../lib/db.js';
import { decodeCursor, type PaginationQuery } from '../../shared/pagination.js';

export type ReceiptRow = SubscriptionReceipt;

/**
 * Reads one extra row to detect the next page without a count or cursor-id lookup.
 * The organization predicate applies to every keyset branch (ASVS 8.2.2).
 * @param organizationId Trusted organization scope from the loaded actor.
 * @param query Bounded page size and opaque cursor; its timestamp represents issued_at.
 * @returns Rows ordered by issue date and id descending, at most limit plus one.
 * @throws VALIDATION_ERROR for a malformed cursor.
 */
export async function listReceipts(organizationId: string, query: PaginationQuery): Promise<ReceiptRow[]> {
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  return prisma.subscriptionReceipt.findMany({
    where: {
      organizationId,
      ...(cursor && { OR: [
        { issuedAt: { lt: cursor.createdAt } },
        { issuedAt: cursor.createdAt, id: { lt: cursor.id } },
      ] }),
    },
    orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });
}

export type NewReceipt = {
  organizationId: string;
  paymentId: string;
  customerName: string;
  customerTaxId: string | null;
  label: string;
  amountExclTax: bigint;
  vatRateBp: number;
  vatAmount: bigint;
  amount: bigint;
  issuedAt: Date;
};

/**
 * Takes the next receipt number from the database function (C-54). The function locks the
 * series until the transaction ends, so the caller must insert in the same transaction.
 */
export async function nextReceiptNumber(
  tx: Prisma.TransactionClient,
  issuedAt: Date
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ number: string }>>`
    SELECT next_subscription_receipt_number(${issuedAt}::timestamptz) AS number
  `;
  return rows[0].number;
}

/** Inserts a RECEIPT with the given number; `issuedAt` must be the date used for the number. */
export async function insertReceipt(
  tx: Prisma.TransactionClient,
  number: string,
  data: NewReceipt
): Promise<ReceiptRow> {
  return tx.subscriptionReceipt.create({
    data: {
      id: newId(),
      number,
      kind: 'RECEIPT',
      organizationId: data.organizationId,
      paymentId: data.paymentId,
      customerName: data.customerName,
      customerTaxId: data.customerTaxId,
      label: data.label,
      amountExclTax: data.amountExclTax,
      vatRateBp: data.vatRateBp,
      vatAmount: data.vatAmount,
      amount: data.amount,
      issuedAt: data.issuedAt,
    },
  });
}
