import type { Prisma } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { findOrganizationSummary } from '../organization/organization.repository.js';
import { getPaymentAggregator } from './aggregator.js';
import { enforceLimits } from './limits.service.js';
import {
  findPaymentByReference,
  inPaymentTransaction,
  insertPaymentEvent,
  lockPayment,
  setPaymentOutcome,
} from './payment.repository.js';
import { issueReceipt } from './receipt.service.js';
import { recomputeRights } from './rights.service.js';
import { addPaidForfait } from './upgrade.service.js';

export type ConfirmOutcome = 'ACTIVATED' | 'ALREADY_DONE' | 'STILL_PENDING' | 'FAILED' | 'EXPIRED';

/**
 * Confirms using the aggregator, never the received body's claimed status (ASVS 8.2.1).
 * Network I/O precedes the transaction; the locked PENDING recheck prevents duplicate
 * activations and stale failure overwrites. All resulting writes commit together or
 * roll back, including receipt, journal, rights and limits (BIL-014, ASVS 2.3.3).
 * @param providerReference Unique provider reference identifying the stored payment.
 * @param receivedBody Untrusted confirmation evidence, retained only in provider_payload.
 * @param now Shared effective instant for confirmation and all subscription effects.
 * @returns The committed outcome, or a no-op outcome when pending or already handled.
 * @throws A safe 404 for an unknown reference, 409 for an amount mismatch, or a propagated
 * dependency failure that aborts the transaction without leaving partial activation.
 */
export async function confirmPayment(
  providerReference: string,
  receivedBody: unknown,
  now: Date,
): Promise<ConfirmOutcome> {
  const payment = await findPaymentByReference(providerReference);
  if (!payment) throw httpError(404, 'NOT_FOUND', 'Payment not found');
  if (payment.status !== 'PENDING') return 'ALREADY_DONE';

  const checked = await getPaymentAggregator().getStatus(providerReference);
  if (!checked) throw httpError(404, 'NOT_FOUND', 'Payment not found');
  if (checked.status === 'PENDING') return 'STILL_PENDING';
  if (checked.status === 'SUCCEEDED' && checked.amount !== payment.amount) {
    logger.warn({ event: 'payment_amount_mismatch', paymentId: payment.id }, 'Payment amount mismatch');
    throw httpError(409, 'PAYMENT_MISMATCH', 'Payment amount mismatch');
  }

  const status = checked.status;
  // Provider amounts use bigint and paidAt uses Date; JSON evidence preserves them as strings.
  const payload = JSON.parse(JSON.stringify({ received: receivedBody ?? null, checked },
    (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value,
  )) as Prisma.InputJsonObject;

  return inPaymentTransaction(async (tx): Promise<ConfirmOutcome> => {
    const locked = await lockPayment(tx, payment.id);
    if (!locked) throw httpError(404, 'NOT_FOUND', 'Payment not found');
    if (locked.status !== 'PENDING') return 'ALREADY_DONE';
    await setPaymentOutcome(tx, locked.id, { status, now, payload });
    if (status === 'FAILED' || status === 'EXPIRED') return status;

    const { months } = locked;
    if (months !== 1 && months !== 3 && months !== 6 && months !== 12) {
      throw new RangeError('Invalid payment duration');
    }
    const organization = await findOrganizationSummary(locked.organizationId, tx);
    if (!organization) throw httpError(404, 'NOT_FOUND', 'Business not found');
    const { purchased } = await addPaidForfait(tx, {
      organizationId: locked.organizationId, plan: locked.plan, months,
      price: locked.amount, paymentId: locked.id, actor: { actor: 'PAYER' }, now,
    });
    await issueReceipt(tx, {
      payment: {
        id: locked.id, organizationId: locked.organizationId, plan: locked.plan,
        months, amount: locked.amount, customerTaxId: locked.customerTaxId,
      },
      customerName: organization.name,
      startsAt: purchased.startsAt, endsAt: purchased.endsAt, now,
    });
    await insertPaymentEvent(tx, locked, purchased.id, now);
    const rights = await recomputeRights(tx, locked.organizationId, now);
    await enforceLimits(tx, locked.organizationId, rights, now);
    return 'ACTIVATED';
  });
}
