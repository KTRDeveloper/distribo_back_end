import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { checkAndConsume } from '../../lib/rate-limit.js';
import { findOrganizationByPaymentCode } from '../organization/organization.repository.js';
import { getPaymentAggregator } from './aggregator.js';
import { confirmPayment } from './confirmation.service.js';

/**
 * Authenticates the aggregator before any payment lookup (ASVS v5.0.0-8.2.1).
 * Only the verified reference is trusted; confirmPayment rechecks the provider status.
 * Rejections log a fixed event only, never the credential or untrusted body (ASVS 16.3.1).
 * @param headers Lower-cased request headers with string values.
 * @param rawBody Original JSON bytes retained by the bounded parser on this exact route.
 * @param parsedBody Untrusted evidence, never authority for payment status or amount.
 * @param now Effective instant passed to the transactional confirmation service.
 * @throws 401 without proof; propagates confirmation errors including 404 and 409.
 */
export async function handleConfirmation(
  headers: Record<string, string | undefined>,
  rawBody: Buffer | undefined,
  parsedBody: unknown,
  now: Date,
): Promise<void> {
  const verified = rawBody && rawBody.length > 0
    ? getPaymentAggregator().verifyConfirmation({ headers, rawBody })
    : null;
  if (!verified) {
    logger.warn({ event: 'payment_confirmation_rejected' }, 'Payment confirmation rejected');
    throw httpError(401, 'UNAUTHORIZED', 'Invalid confirmation proof');
  }
  await confirmPayment(verified.providerReference, parsedBody ?? null, now);
}

const LOOKUP_LIMIT = 30;
const LOOKUP_WINDOW_SECONDS = 3600;

/**
 * Gives the name of the ACTIVE business that holds a payment code, for the public payment site.
 * The lookup is counted per address before any database read (ASVS v5.0.0-2.4.1) to slow code
 * guessing; an unknown, deleted, SUSPENDED or CLOSED business all answer the same 404 so the
 * answer reveals nothing about the code. Only the name leaves (ASVS v5.0.0-15.3.1).
 * The limit (30 an hour) is provisional.
 *
 * @param code - Payment code already trimmed, upper-cased and validated.
 * @param ip - Caller address, used only as the counter key and never logged.
 * @throws 429 RATE_LIMITED after 30 lookups an hour; 404 NOT_FOUND when no ACTIVE business holds the code.
 */
export async function lookupShop(code: string, ip: string): Promise<{ name: string }> {
  const slot = await checkAndConsume(`billing:code:${ip}`, LOOKUP_LIMIT, LOOKUP_WINDOW_SECONDS);
  if (!slot.allowed) {
    logger.warn({ event: 'payment_code_rate_limited' }, 'Payment code lookup rate limited');
    throw httpError(429, 'RATE_LIMITED', 'Too many lookups');
  }
  const organization = await findOrganizationByPaymentCode(code);
  if (!organization || organization.status !== 'ACTIVE') {
    throw httpError(404, 'NOT_FOUND', 'Shop not found');
  }
  return { name: organization.name };
}
