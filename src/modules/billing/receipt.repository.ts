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

/** Finds the original immutable receipt, never its credit note, in the caller's transaction. */
export function findReceiptOfPayment(tx: Prisma.TransactionClient, paymentId: string): Promise<ReceiptRow | null> {
  return tx.subscriptionReceipt.findFirst({ where: { paymentId, kind: 'RECEIPT' } });
}

/** Finds a payment's credit note without reading outside the caller's transaction. */
export function findCreditNoteOfPayment(tx: Prisma.TransactionClient, paymentId: string): Promise<ReceiptRow | null> {
  return tx.subscriptionReceipt.findFirst({ where: { paymentId, kind: 'CREDIT_NOTE' } });
}

/**
 * Inserts an immutable cancellation by copying the original receipt's frozen customer and amounts.
 * @param tx Transaction shared with the refund and gapless number allocation (C-54).
 * @param number Next number allocated by that transaction.
 * @param receipt Original receipt; taxes must never be recomputed using today's configuration.
 * @param now Credit note issue date, also used to allocate its number.
 * @returns The positive-valued CREDIT_NOTE linked to the cancelled receipt.
 */
export function insertCreditNote(
  tx: Prisma.TransactionClient,
  number: string,
  receipt: ReceiptRow,
  now: Date,
): Promise<ReceiptRow> {
  return tx.subscriptionReceipt.create({ data: {
    id: newId(), number, kind: 'CREDIT_NOTE', cancelsReceiptId: receipt.id,
    organizationId: receipt.organizationId, paymentId: receipt.paymentId,
    customerName: receipt.customerName, customerTaxId: receipt.customerTaxId,
    label: `Avoir — ${receipt.label}`, amountExclTax: receipt.amountExclTax,
    vatRateBp: receipt.vatRateBp, vatAmount: receipt.vatAmount, amount: receipt.amount,
    issuedAt: now,
  } });
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
