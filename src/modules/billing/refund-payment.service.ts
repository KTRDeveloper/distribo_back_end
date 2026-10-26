import { httpError } from '../../lib/http-error.js';
import { recordAdminAction } from '../admin/admin.repository.js';
import { notifyOwnerOfAdjustment } from './adjustment-notice.js';
import { enforceLimits } from './limits.service.js';
import type { ReceiptView } from './owner-view.service.js';
import { inPaymentTransaction, lockPayment } from './payment.repository.js';
import { findCreditNoteOfPayment } from './receipt.repository.js';
import { applyRefund } from './refund.service.js';
import { recomputeRights } from './rights.service.js';

export type RefundView = { payment_id: string; status: 'REFUNDED'; credit_note: ReceiptView };

/**
 * Refunds a tenant-scoped payment with audit, rights, limits and notice in one transaction.
 * The payment lock serializes gestures; repeats return the immutable BIL-017 credit note
 * without audit or notification writes (ASVS 8.2.2, 2.3.3; C-54).
 * @param admin Authenticated SUPER_ADMIN context, authorized before boundary validation.
 * @param organizationId Validated business path id; foreign payments remain indistinguishable from absent ones.
 * @param paymentId Payment id serving as the refund gesture key.
 * @param input Strict reason field, retained only in the administrator journal.
 * @param now Shared instant for refund, rights and limit enforcement.
 * @returns Explicit credit-note projection, identical for every successful repeat.
 * @throws NOT_FOUND for absent or foreign payments, PAYMENT_NOT_REFUNDABLE for non-succeeded payments.
 * Missing credit notes or dependency failures abort the transaction rather than report partial success.
 */
export async function refundPayment(
  admin: { administratorId: string },
  organizationId: string,
  paymentId: string,
  input: { reason: string },
  now: Date,
): Promise<RefundView> {
  return inPaymentTransaction(async (tx) => {
    const payment = await lockPayment(tx, paymentId);
    if (!payment || payment.organizationId !== organizationId) {
      throw httpError(404, 'NOT_FOUND', 'Payment not found');
    }
    if (payment.status !== 'REFUNDED') {
      if (payment.status !== 'SUCCEEDED') {
        throw httpError(409, 'PAYMENT_NOT_REFUNDABLE', 'Payment is not refundable');
      }
      const action = await recordAdminAction(tx, {
        administratorId: admin.administratorId, action: 'REFUND_PAYMENT',
        targetOrganizationId: organizationId, reason: input.reason,
      });
      await applyRefund(tx, {
        paymentId, organizationId,
        actor: { administratorId: admin.administratorId, adminActionId: action.id }, now,
      });
      const rights = await recomputeRights(tx, organizationId, now);
      await enforceLimits(tx, organizationId, rights, now);
      await notifyOwnerOfAdjustment(tx, organizationId, {
        kind: 'REFUNDED', plan: payment.plan, amount: payment.amount,
      });
    }
    const credit = await findCreditNoteOfPayment(tx, paymentId);
    if (!credit) throw new Error('Refunded payment has no credit note');
    return {
      payment_id: payment.id, status: 'REFUNDED', credit_note: {
        number: credit.number, kind: credit.kind, label: credit.label,
        customer_name: credit.customerName, customer_tax_id: credit.customerTaxId,
        amount_excl_tax: Number(credit.amountExclTax), vat_rate_bp: credit.vatRateBp,
        vat_amount: Number(credit.vatAmount), amount: Number(credit.amount), issued_at: credit.issuedAt,
      },
    };
  });
}
