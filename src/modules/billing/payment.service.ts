import { createHash } from 'node:crypto';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { checkAndConsume } from '../../lib/rate-limit.js';
import type { PackMonths, PaidPlanCode } from '../../shared/plans.js';
import { priceFor } from '../../shared/plans.js';
import { findOrganizationByPaymentCode } from '../organization/organization.repository.js';
import { getPaymentAggregator } from './aggregator.js';
import {
  findPaymentById,
  inPaymentTransaction,
  insertPendingPayment,
  lockPaymentId,
  type PaymentRow,
} from './payment.repository.js';

/** Version of the terms the payer must have accepted. Provisional until the terms are published. */
export const CURRENT_TERMS_VERSION = '2026-10';

const IP_LIMIT = 10;
const PHONE_LIMIT = 5;
const WINDOW_SECONDS = 3600;

export type CreatePaymentInput = {
  id: string;
  code: string;
  plan: PaidPlanCode;
  months: PackMonths;
  operator: 'MTN_MOMO' | 'ORANGE_MONEY';
  /** Already normalized with `normalizeE164`. */
  payerPhoneNumber: string;
  customerTaxId: string | null;
  termsVersion: string;
};

export type PaymentView = {
  id: string;
  status: PaymentRow['status'];
  plan: PaymentRow['plan'];
  months: number;
  amount: bigint;
  operator: PaymentRow['operator'];
};

/** Builds the answer from an explicit list of fields: no number, reference or tax id leaves. */
function toView(row: PaymentRow): PaymentView {
  return {
    id: row.id,
    status: row.status,
    plan: row.plan,
    months: row.months,
    amount: row.amount,
    operator: row.operator,
  };
}

/**
 * Starts a payment of a plan for a business, for the public payment site (C-53).
 *
 * Order: limits (10 an hour per address, 5 an hour per payer number, provisional, counted before
 * any read, ASVS v5.0.0-2.4.1), ACTIVE business (else 404), current terms version (else 409).
 * Then, in one transaction holding a lock on the payment id: a stored payment with the same
 * business, plan, months, operator and number is answered again without a new aggregator request;
 * any other body for that id is 409. Else the amount comes from the price grid (never from the
 * caller, ASVS v5.0.0-2.2.3), the aggregator is asked, and the PENDING row is inserted. An
 * aggregator failure is rethrown so nothing is stored.
 *
 * The payer number is only counted through its SHA-256 hash and the address is never logged.
 *
 * @param ip - Caller address, used only as the counter key.
 * @throws 429 RATE_LIMITED, 404 NOT_FOUND, 409 TERMS_CHANGED, 409 PAYMENT_ID_USED.
 */
export async function createPayment(input: CreatePaymentInput, ip: string): Promise<PaymentView> {
  const byIp = await checkAndConsume(`billing:pay:${ip}`, IP_LIMIT, WINDOW_SECONDS);
  const phoneHash = createHash('sha256').update(input.payerPhoneNumber).digest('hex');
  const byPhone = byIp.allowed
    ? await checkAndConsume(`billing:pay:phone:${phoneHash}`, PHONE_LIMIT, WINDOW_SECONDS)
    : byIp;
  if (!byIp.allowed || !byPhone.allowed) {
    logger.warn({ event: 'payment_create_rate_limited' }, 'Payment creation rate limited');
    throw httpError(429, 'RATE_LIMITED', 'Too many payments');
  }

  const organization = await findOrganizationByPaymentCode(input.code);
  if (!organization || organization.status !== 'ACTIVE') {
    throw httpError(404, 'NOT_FOUND', 'Shop not found');
  }
  if (input.termsVersion !== CURRENT_TERMS_VERSION) {
    throw httpError(409, 'TERMS_CHANGED', 'The terms have changed');
  }

  const row = await inPaymentTransaction(async (tx) => {
    await lockPaymentId(tx, input.id);
    const stored = await findPaymentById(tx, input.id);
    if (stored) {
      const same =
        stored.organizationId === organization.id &&
        stored.plan === input.plan &&
        stored.months === input.months &&
        stored.operator === input.operator &&
        stored.payerPhoneNumber === input.payerPhoneNumber;
      if (!same) {
        throw httpError(409, 'PAYMENT_ID_USED', 'This payment id is already used');
      }
      return stored;
    }
    const amount = priceFor(input.plan, input.months);
    const { providerReference } = await getPaymentAggregator().requestPayment({
      clientReference: input.id,
      amount,
      operator: input.operator,
      payerPhone: input.payerPhoneNumber,
      description: `Distribo ${input.plan} ${input.months} months`,
    });
    return insertPendingPayment(tx, {
      id: input.id,
      organizationId: organization.id,
      plan: input.plan,
      months: input.months,
      amount,
      operator: input.operator,
      payerPhoneNumber: input.payerPhoneNumber,
      providerReference,
      termsVersion: input.termsVersion,
      customerTaxId: input.customerTaxId,
    });
  });
  return toView(row);
}
