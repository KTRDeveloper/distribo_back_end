import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { checkAndConsume } from '../../lib/rate-limit.js';
import { priceFor, type PackMonths, type PaidPlanCode } from '../../shared/plans.js';
import { findOrganizationByPaymentCode } from '../organization/organization.repository.js';
import { placePurchase } from './forfait.service.js';
import { readQueueFor } from './subscription.repository.js';

export type Quote = {
  name: string;
  plan: PaidPlanCode;
  months: PackMonths;
  price: bigint;
  placement: 'NOW' | 'QUEUED' | 'UPGRADE';
  startsAt: Date;
  endsAt: Date;
};

/**
 * Quotes a paid pack without reserving or changing the business's periods (BIL-033).
 * The per-address limit precedes every read, and inactive or absent businesses share
 * one error to restrict enumeration (ASVS 2.4.1). Only the purchased period is quoted
 * for upgrades; conversion days are not part of this non-binding preview.
 * @param input Validated code, allowlisted pack, address and single request instant.
 * @returns Public quote data calculated with the shared price grid and placement rules.
 * @throws 429 RATE_LIMITED above 60 quotes an hour; 404 NOT_FOUND for no ACTIVE business.
 */
export async function quoteFor(input: {
  code: string; plan: PaidPlanCode; months: PackMonths; ip: string; now: Date;
}): Promise<Quote> {
  const slot = await checkAndConsume(`billing:quote:${input.ip}`, 60, 3600);
  if (!slot.allowed) {
    logger.warn({ event: 'payment_code_rate_limited' }, 'Payment code lookup rate limited');
    throw httpError(429, 'RATE_LIMITED', 'Too many lookups');
  }
  const organization = await findOrganizationByPaymentCode(input.code);
  if (!organization || organization.status !== 'ACTIVE') {
    throw httpError(404, 'NOT_FOUND', 'Shop not found');
  }
  const { queue, lastExpiredEndsAt } = await readQueueFor(organization.id);
  const placement = placePurchase(queue, lastExpiredEndsAt, input.plan, input.months, input.now);
  return {
    name: organization.name, plan: input.plan, months: input.months,
    price: priceFor(input.plan, input.months), ...placement,
  };
}
