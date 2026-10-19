import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { checkAndConsume } from '../../lib/rate-limit.js';
import { findOrganizationByPaymentCode } from '../organization/organization.repository.js';

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
