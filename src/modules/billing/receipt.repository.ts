import type { Prisma, SubscriptionReceipt } from '@prisma/client';
import { newId } from '../../shared/ids.js';

export type ReceiptRow = SubscriptionReceipt;

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
