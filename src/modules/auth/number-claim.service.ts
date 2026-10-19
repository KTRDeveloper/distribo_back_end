import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { normalizeE164 } from '../../shared/phone.js';
import { findByActivePhone } from '../person/person.repository.js';
import { latestDeviceActivity } from './auth.repository.js';
import { checkNumberQuota } from './number-check-limit.js';
import { issueCode, type ClientKeys } from './otp.service.js';

const EXPIRES_IN_SECONDS = 600;
const IDLE_MONTHS = 6;

export type ClaimRefusal = 'SUSPENDED' | 'RECENTLY_ACTIVE';

/**
 * The same date and time `months` calendar months before `now`, in UTC. When that month is
 * shorter (31 Aug minus six months), the last day of the month is used, never a later month.
 */
function monthsBefore(now: Date, months: number): Date {
  const target = new Date(now.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/**
 * Says why a registered holder's number cannot be claimed (CM-07, AUTH-031): `SUSPENDED`, or
 * `RECENTLY_ACTIVE` when their latest device activity is within the last six calendar months.
 * A holder with no device is idle. Reused by AUTH-032 (registration re-check) and AUTH-037.
 *
 * @returns The reason, or null when the number may be claimed.
 */
export async function claimRefusal(
  holder: { id: string; status: string },
  now: Date
): Promise<ClaimRefusal | null> {
  if (holder.status === 'SUSPENDED') return 'SUSPENDED';
  const latest = await latestDeviceActivity(holder.id);
  if (latest !== null && latest.getTime() > monthsBefore(now, IDLE_MONTHS).getTime()) {
    return 'RECENTLY_ACTIVE';
  }
  return null;
}

/**
 * Send a REGISTRATION code to a number that belongs to someone else, if that holder is idle
 * (v5.0.0-2.4.1, v5.0.0-6.3.8). Both refusals answer the same 409, so a suspension is never
 * shown. The refusal comes before any code or job, so claims cannot flood a live holder. The
 * challenge has no person: the new holder is not known yet. The log carries ids, never the number.
 *
 * @throws 400 VALIDATION_ERROR, 400 UNSUPPORTED_NUMBER, 409 NUMBER_NOT_AVAILABLE,
 *   429 RATE_LIMITED, 429 OTP_RATE_LIMITED
 */
export async function requestNumberClaim(
  input: { phone_number: string },
  clientKeys: ClientKeys = {}
): Promise<{ sent: true; expires_in: number }> {
  const phone = normalizeE164(input.phone_number);
  if (phone === null) {
    const parsed = parsePhoneNumberFromString(input.phone_number, 'CM');
    if (parsed?.isValid() && parsed.country !== 'CM') {
      throw httpError(400, 'UNSUPPORTED_NUMBER', 'This number is not supported');
    }
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid phone number');
  }

  await checkNumberQuota(clientKeys.ip);

  const holder = await findByActivePhone(phone);
  if (holder?.registeredAt != null) {
    const reason = await claimRefusal(holder, new Date());
    if (reason !== null) {
      logger.warn(
        { event: 'number_claim_refused', personId: holder.id, reason },
        'Number claim refused'
      );
      throw httpError(409, 'NUMBER_NOT_AVAILABLE', 'This number is not available');
    }
  }

  await issueCode(
    { personId: null, target: phone, purpose: 'REGISTRATION', channel: 'SMS', language: 'FR' },
    clientKeys
  );
  return { sent: true, expires_in: EXPIRES_IN_SECONDS };
}
