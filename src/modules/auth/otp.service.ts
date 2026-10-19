import { checkAndConsume } from '../../lib/rate-limit.js';
import { enqueueOtpDelivery } from '../../lib/otp-delivery-queue.js';
import { generateOtp, hashOtp, verifyOtp } from '../../lib/otp.js';
import { configService } from '../../lib/config-service.js';
import { logger } from '../../lib/logger.js';
import { otpDailyCapReachedTotal } from '../../lib/metrics.js';
import { httpError } from '../../lib/http-error.js';
import { isCameroonMobile } from '../../shared/phone.js';
import { recipientLanguage } from '../notification/notification.service.js';
import { otpRepository, type OtpPurpose } from './otp.repository.js';

export type { OtpPurpose };

export type IssueCodeInput = {
  personId: string | null;
  target: string;
  purpose: OtpPurpose;
  channel: 'SMS' | 'EMAIL';
  /** Skips the recipient lookup (guests have no notification profile); default is the person's language. */
  language?: 'FR' | 'EN';
  /**
   * The contact being verified and the name of its business: required with
   * ORG_CONTACT_VERIFICATION, refused with any other purpose (C-33).
   */
  contact?: { id: string; organizationName: string };
};

const CODE_TTL_MS = 10 * 60 * 1000;
const HOUR_LIMIT = 3;
const HOUR_SECONDS = 3600;
const COOLDOWN_SECONDS = 60;
const DAY_SECONDS = 86400;

export type ClientKeys = { deviceId?: string; ip?: string };

async function capOf(key: string): Promise<number | null> {
  const v = await configService.get<number>('otp', key);
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Apply device, IP and global daily caps; an unset cap is off (CM-07, v5.0.0-2.4.1). */
async function enforceCaps(keys: ClientKeys): Promise<void> {
  const refuse = () => httpError(429, 'OTP_RATE_LIMITED', 'Too many code requests');
  const deviceCap = keys.deviceId ? await capOf('max_per_device_per_hour') : null;
  if (keys.deviceId && deviceCap !== null) {
    const r = await checkAndConsume(`otp:device:${keys.deviceId}`, deviceCap, HOUR_SECONDS);
    if (!r.allowed) throw refuse();
  }
  const ipCap = keys.ip ? await capOf('max_per_ip_per_hour') : null;
  if (keys.ip && ipCap !== null) {
    const r = await checkAndConsume(`otp:ip:${keys.ip}`, ipCap, HOUR_SECONDS);
    if (!r.allowed) throw refuse();
  }
  const dayCap = await capOf('max_per_day');
  if (dayCap !== null) {
    const r = await checkAndConsume('otp:day', dayCap, DAY_SECONDS);
    if (!r.allowed) {
      const first = await checkAndConsume('otp:day:alerted', 1, DAY_SECONDS);
      if (first.allowed) {
        logger.error({ event: 'otp_daily_cap_reached' }, 'OTP daily cap reached');
        otpDailyCapReachedTotal.inc();
      }
      throw refuse();
    }
  }
}

function messageFor(code: string, language: 'FR' | 'EN'): string {
  return language === 'EN'
    ? `Your Distribo code: ${code}. It expires in 10 minutes.`
    : `Votre code Distribo : ${code}. Il expire dans 10 minutes.`;
}

const NAME_MAX_LENGTH = 40;

/** Removes control and line/paragraph separator characters, then cuts at 40 characters. */
function cleanBusinessName(name: string): string {
  return Array.from(name.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ''))
    .slice(0, NAME_MAX_LENGTH)
    .join('');
}

/**
 * Fixed text of a code that confirms a contact of a business (ORG-041). The
 * business name is cleaned so it cannot add a line or a second message
 * (v5.0.0-6.6.3). Nothing else of the caller's input enters the text.
 */
export function contactCodeMessage(
  code: string,
  language: 'FR' | 'EN',
  organizationName: string,
  channel: 'SMS' | 'EMAIL'
): string {
  const name = cleanBusinessName(organizationName);
  if (language === 'EN') {
    const what = channel === 'EMAIL' ? 'this address' : 'this number';
    return `Code ${code}. ${name} wants to show ${what} as a contact on Distribo. Only give this code if you agree.`;
  }
  const what = channel === 'EMAIL' ? 'cette adresse' : 'ce numéro';
  return `Code ${code}. ${name} veut afficher ${what} comme contact sur Distribo. Ne donnez ce code que si vous acceptez.`;
}

/**
 * Create and queue a one-time code (CM-06, CM-07, C-33). Every check runs
 * before the row is written or anything is queued (v5.0.0-2.4.1); SMS goes
 * only to +237 mobiles (v5.0.0-6.6.1). Nothing here logs the code or target.
 *
 * With `contact`, the code is tied to that contact and the text names the business.
 *
 * @throws Error when `contact` does not match the purpose (a programming mistake)
 * @throws 400 UNSUPPORTED_NUMBER for a non Cameroon mobile SMS target
 * @throws 429 OTP_RATE_LIMITED when the hourly or resend limit is hit
 */
export async function issueCode(
  input: IssueCodeInput,
  clientKeys: ClientKeys = {}
): Promise<{ challengeId: string; expiresAt: Date }> {
  const isContactCode = input.purpose === 'ORG_CONTACT_VERIFICATION';
  if (isContactCode !== (input.contact !== undefined)) {
    throw new Error(
      'issueCode: contact is required with ORG_CONTACT_VERIFICATION and refused otherwise'
    );
  }
  if (input.channel === 'SMS' && !isCameroonMobile(input.target)) {
    throw httpError(400, 'UNSUPPORTED_NUMBER', 'This number is not supported');
  }

  await enforceCaps(clientKeys);

  const cooldown = await checkAndConsume(
    `otp:cooldown:${input.purpose}:${input.target}`,
    1,
    COOLDOWN_SECONDS
  );
  if (!cooldown.allowed) throw httpError(429, 'OTP_RATE_LIMITED', 'Too many code requests');
  const hourly = await checkAndConsume(`otp:hour:${input.target}`, HOUR_LIMIT, HOUR_SECONDS);
  if (!hourly.allowed) throw httpError(429, 'OTP_RATE_LIMITED', 'Too many code requests');

  const language =
    input.language ?? (input.personId ? await recipientLanguage(input.personId) : 'FR');
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  const challengeId = await otpRepository.createChallenge({
    personId: input.personId,
    target: input.target,
    purpose: input.purpose,
    channel: input.channel,
    codeHash: await hashOtp(code),
    expiresAt,
    ...(input.contact ? { organizationContactId: input.contact.id } : {}),
  });

  await enqueueOtpDelivery({
    channel: input.channel,
    to: input.target,
    message: input.contact
      ? contactCodeMessage(code, language, input.contact.organizationName, input.channel)
      : messageFor(code, language),
    ...(input.channel === 'EMAIL' ? { subject: 'Distribo' } : {}),
  });
  return { challengeId, expiresAt };
}

const MAX_ATTEMPTS = 5;

/**
 * Check a code against the newest challenge for (target, purpose), and for one
 * contact with ORG_CONTACT_VERIFICATION, so a code never serves another contact (CM-06, C-33).
 * An attempt is reserved with a guarded UPDATE before the hash is checked, and
 * consumption is a guarded UPDATE, so parallel calls cannot exceed 5 tries or
 * use a code twice (v5.0.0-6.5.3, v5.0.0-6.6.3, v5.0.0-2.3.4).
 *
 * With `spend: false` the code is only checked (the attempt still counts) and stays usable:
 * the caller must then call `spendCode` with the returned `challengeId` (AUTH-032).
 *
 * @throws 400 OTP_INVALID (also for a contact id that does not match the purpose), 400 OTP_EXPIRED, 429 OTP_LOCKED
 */
export async function verifyCode(
  input: {
    target: string;
    purpose: OtpPurpose;
    code: string;
    /** Required with ORG_CONTACT_VERIFICATION, refused with any other purpose. */
    organizationContactId?: string;
  },
  options: { spend?: boolean } = {}
): Promise<{ challengeId: string; personId: string | null }> {
  const invalid = () => httpError(400, 'OTP_INVALID', 'Invalid code');
  const isContactCode = input.purpose === 'ORG_CONTACT_VERIFICATION';
  if (isContactCode !== (input.organizationContactId !== undefined)) throw invalid();
  const row = await otpRepository.findLatest(
    input.target,
    input.purpose,
    input.organizationContactId
  );
  if (!row || row.consumedAt) throw invalid();
  if (row.expiresAt.getTime() <= Date.now()) throw httpError(400, 'OTP_EXPIRED', 'Code expired');
  if (!(await otpRepository.reserveAttempt(row.id, MAX_ATTEMPTS))) {
    throw httpError(429, 'OTP_LOCKED', 'Too many attempts');
  }
  if (!(await verifyOtp(input.code, row.codeHash))) throw invalid();
  if (options.spend !== false) await spendCode(row.id);
  return { challengeId: row.id, personId: row.personId };
}

/**
 * Consume a code already checked by `verifyCode(..., { spend: false })`. The guarded UPDATE
 * means a parallel use of the same code fails here.
 *
 * @throws 400 OTP_INVALID when the code was already consumed
 */
export async function spendCode(challengeId: string): Promise<void> {
  if (!(await otpRepository.consume(challengeId))) {
    throw httpError(400, 'OTP_INVALID', 'Invalid code');
  }
}
