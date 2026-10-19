import { checkAndConsume } from '../../lib/rate-limit.js';
import { configService } from '../../lib/config-service.js';
import { logger } from '../../lib/logger.js';
import { httpError } from '../../lib/http-error.js';

const HOUR_SECONDS = 3600;

/**
 * Count one number check for this IP and refuse past the hourly limit
 * (`auth.max_number_checks_per_ip_per_hour`; unset or invalid = off). Sign-in answers
 * now say whether a number has an account, so every check is counted to stop
 * automated scans (v5.0.0-6.3.1, v5.0.0-2.4.1). No device id exists before
 * sign-in, so the IP is the only key. The log never carries the number (v5.0.0-16.3.1).
 *
 * @throws 429 RATE_LIMITED
 */
export async function checkNumberQuota(ip: string | undefined): Promise<void> {
  if (!ip) return;
  const limit = await configService.get<number>('auth', 'max_number_checks_per_ip_per_hour');
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return;
  const slot = await checkAndConsume(`numcheck:ip:${ip}`, limit, HOUR_SECONDS);
  if (!slot.allowed) {
    logger.warn({ event: 'number_check_limited' }, 'Number check limit reached');
    throw httpError(429, 'RATE_LIMITED', 'Too many number checks');
  }
}
