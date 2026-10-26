import { httpError } from '../../lib/http-error.js';
import { priceFor, type PackMonths, type PaidPlanCode } from '../../shared/plans.js';
import { recordAdminAction } from '../admin/admin.repository.js';
import { findOrganizationSummary } from '../organization/organization.repository.js';
import { notifyOwnerOfAdjustment } from './adjustment-notice.js';
import { enforceLimits } from './limits.service.js';
import {
  findPaymentById, findPaymentView, inPaymentTransaction, insertRecordedPayment,
  insertRecordedPaymentEvent, lockPaymentId,
} from './payment.repository.js';
import type { PaymentStatusView as PaymentView } from './payment.service.js';
import { issueReceipt } from './receipt.service.js';
import { recomputeRights } from './rights.service.js';
import { lockSubscriptions } from './subscription.repository.js';
import { addPaidForfait } from './upgrade.service.js';

export type RecordPaymentInput = {
  id: string; plan: PaidPlanCode; months: PackMonths; customer_tax_id?: string; reason: string;
};

/**
 * Records an external payment and every subscription effect in one transaction (ASVS 2.3.3).
 * The payment-id lock serializes repeats across businesses and with online payment creation;
 * the subscription lock protects placement, rights and limits. Replays perform no writes.
 * @param admin Authenticated SUPER_ADMIN context, authorized before parsing (ASVS 8.2.1).
 * @param organizationId Validated business path id, never used as an actor identity.
 * @param input Strict writable fields; amount and provenance are server-selected (ASVS 15.3.3).
 * @param now Shared confirmation and adjustment instant.
 * @returns The explicit BIL-015 public payment view, including its original receipt.
 * @throws NOT_FOUND for an unknown business, ID_USED for an incompatible payment id;
 * dependency failures propagate and roll back payment, audit, receipt, periods and notices.
 */
export async function recordPayment(
  admin: { administratorId: string },
  organizationId: string,
  input: RecordPaymentInput,
  now: Date,
): Promise<PaymentView> {
  return inPaymentTransaction(async (tx) => {
    const organization = await findOrganizationSummary(organizationId, tx);
    if (!organization) throw httpError(404, 'NOT_FOUND', 'Business not found');
    await lockPaymentId(tx, input.id);
    await lockSubscriptions(tx, organizationId);
    const existing = await findPaymentById(tx, input.id);
    if (existing) {
      if (existing.organizationId !== organizationId || existing.plan !== input.plan || existing.months !== input.months) {
        throw httpError(409, 'ID_USED', 'Payment id already used');
      }
    } else {
      const action = await recordAdminAction(tx, {
        administratorId: admin.administratorId, action: 'RECORD_PAYMENT',
        targetOrganizationId: organizationId, reason: input.reason,
      });
      const amount = priceFor(input.plan, input.months);
      const payment = await insertRecordedPayment(tx, {
        id: input.id, organizationId, plan: input.plan, months: input.months,
        amount, customerTaxId: input.customer_tax_id ?? null,
      }, now);
      const actor = { actor: 'ADMINISTRATOR' as const, administratorId: admin.administratorId, adminActionId: action.id };
      const { purchased } = await addPaidForfait(tx, {
        organizationId, plan: input.plan, months: input.months,
        price: amount, paymentId: payment.id, actor, now,
      });
      await issueReceipt(tx, {
        payment: {
          id: payment.id, organizationId, plan: input.plan, months: input.months,
          amount, customerTaxId: payment.customerTaxId,
        },
        customerName: organization.name, startsAt: purchased.startsAt, endsAt: purchased.endsAt, now,
      });
      await insertRecordedPaymentEvent(tx, payment, purchased.id, actor, now);
      const rights = await recomputeRights(tx, organizationId, now);
      await enforceLimits(tx, organizationId, rights, now);
      await notifyOwnerOfAdjustment(tx, organizationId, {
        kind: 'PAYMENT_RECORDED', plan: input.plan, months: input.months, amount,
      });
    }
    const row = await findPaymentView(input.id, tx);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Payment not found');
    const receipt = row.receipts[0];
    return {
      id: row.id, status: row.status, business_name: row.organization.name,
      plan: row.plan, months: row.months, amount: Number(row.amount), operator: row.operator,
      period: row.status === 'SUCCEEDED' && row.subscription ? {
        starts_at: row.subscription.startsAt.toISOString(), ends_at: row.subscription.endsAt.toISOString(),
      } : null,
      receipt: receipt ? {
        number: receipt.number, label: receipt.label, customer_name: receipt.customerName,
        customer_tax_id: receipt.customerTaxId, amount_excl_tax: Number(receipt.amountExclTax),
        vat_rate_bp: receipt.vatRateBp, vat_amount: Number(receipt.vatAmount),
        amount: Number(receipt.amount), issued_at: receipt.issuedAt.toISOString(),
      } : null,
    };
  });
}
