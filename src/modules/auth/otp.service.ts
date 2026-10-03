import { checkAndConsume } from '../../lib/rate-limit.js';
import { enqueueOtpDelivery } from '../../lib/otp-delivery-queue.js';
import { generateOtp, hashOtp } from '../../lib/otp.js';
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
};

const CODE_TTL_MS = 10 * 60 * 1000;
const HOUR_LIMIT = 3;
const HOUR_SECONDS = 3600;
const COOLDOWN_SECONDS = 60;

function messageFor(code: string, language: 'FR' | 'EN'): string {
  return language === 'EN'
    ? `Your Distribo code: ${code}. It expires in 10 minutes.`
    : `Votre code Distribo : ${code}. Il expire dans 10 minutes.`;
}

/**
 * Create and queue a one-time code (CM-06, CM-07, C-33). Every check runs
 * before the row is written or anything is queued (v5.0.0-2.4.1); SMS goes
 * only to +237 mobiles (v5.0.0-6.6.1). Nothing here logs the code or target.
 *
 * @throws 400 UNSUPPORTED_NUMBER for a non Cameroon mobile SMS target
 * @throws 429 OTP_RATE_LIMITED when the hourly or resend limit is hit
 */
export async function issueCode(
  input: IssueCodeInput
): Promise<{ challengeId: string; expiresAt: Date }> {
  if (input.channel === 'SMS' && !isCameroonMobile(input.target)) {
    throw httpError(400, 'UNSUPPORTED_NUMBER', 'This number is not supported');
  }

  const cooldown = await checkAndConsume(
    `otp:cooldown:${input.purpose}:${input.target}`,
    1,
    COOLDOWN_SECONDS
  );
  if (!cooldown.allowed) throw httpError(429, 'OTP_RATE_LIMITED', 'Too many code requests');
  const hourly = await checkAndConsume(`otp:hour:${input.target}`, HOUR_LIMIT, HOUR_SECONDS);
  if (!hourly.allowed) throw httpError(429, 'OTP_RATE_LIMITED', 'Too many code requests');

  const language = input.personId ? await recipientLanguage(input.personId) : 'FR';
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  const challengeId = await otpRepository.createChallenge({
    personId: input.personId,
    target: input.target,
    purpose: input.purpose,
    channel: input.channel,
    codeHash: await hashOtp(code),
    expiresAt,
  });

  await enqueueOtpDelivery({
    channel: input.channel,
    to: input.target,
    message: messageFor(code, language),
    ...(input.channel === 'EMAIL' ? { subject: 'Distribo' } : {}),
  });
  return { challengeId, expiresAt };
}
