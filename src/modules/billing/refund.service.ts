import type { Prisma } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';
import { lockPayment, setPaymentOutcome } from './payment.repository.js';
import { findReceiptOfPayment, type ReceiptRow } from './receipt.repository.js';
import { issueCreditNote } from './receipt.service.js';
import {
  endPeriod, insertRefundEvent, listOpenPeriodsOfPayment, lockSubscriptions,
} from './subscription.repository.js';

export type RefundInput = {
  paymentId: string;
  organizationId: string;
  actor: { administratorId: string; adminActionId: string };
  now: Date;
};

export type RefundResult = { creditNote: ReceiptRow; endedIds: string[] };

/**
 * Refunds a succeeded tenant-scoped payment atomically with its credit note and period journal.
 * Payment locking serializes competing refunds; the queue lock also excludes lifecycle changes.
 * C-53/C-54: confirmation and frozen receipt values are preserved, later periods are not shifted.
 * @param tx Caller-owned transaction; the caller also recomputes rights before committing.
 * @param input Trusted organization and administrator context plus the effective refund instant.
 * @returns The credit note and only the periods actually ended by this refund.
 * @throws NOT_FOUND for absent or foreign payments, PAYMENT_NOT_REFUNDABLE unless SUCCEEDED.
 * @throws An invariant error if a succeeded payment has no receipt; no partial refund may commit.
 */
export async function applyRefund(tx: Prisma.TransactionClient, input: RefundInput): Promise<RefundResult> {
  const payment = await lockPayment(tx, input.paymentId);
  if (!payment || payment.organizationId !== input.organizationId) {
    throw httpError(404, 'NOT_FOUND', 'Payment not found');
  }
  if (payment.status !== 'SUCCEEDED') {
    throw httpError(409, 'PAYMENT_NOT_REFUNDABLE', 'Payment is not refundable');
  }
  await lockSubscriptions(tx, input.organizationId);
  const receipt = await findReceiptOfPayment(tx, payment.id);
  if (!receipt) {
    throw new Error('Succeeded payment has no receipt');
  }
  await setPaymentOutcome(tx, payment.id, { status: 'REFUNDED' });
  const creditNote = await issueCreditNote(tx, receipt, input.now);
  const periods = await listOpenPeriodsOfPayment(tx, payment.id);
  for (const period of periods) {
    await endPeriod(tx, period.id, period.status === 'SCHEDULED' ? period.startsAt : input.now, 'REFUNDED');
    await insertRefundEvent(tx, input, 'FORFAIT_ENDED', period.id);
  }
  await insertRefundEvent(tx, input, 'PAYMENT', null);
  return { creditNote, endedIds: periods.map((period) => period.id) };
}
