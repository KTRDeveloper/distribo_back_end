import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { httpError } from '../../lib/http-error.js';
import { normalizeE164 } from '../../shared/phone.js';
import { findByActivePhone } from '../person/person.repository.js';
import { hashPassword, validatePasswordRules } from '../../lib/password.js';
import { logger } from '../../lib/logger.js';
import { completeRegistration, inTransaction } from './auth.repository.js';
import { issueCode, verifyCode, type ClientKeys } from './otp.service.js';
import { issueSession, type DeviceInfo } from './session.service.js';

const EXPIRES_IN_SECONDS = 600;

/** First word in full, then the initial of each further word and "…" (one word: its initial and "…"). */
export function maskName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const [first = '', ...rest] = words;
  if (rest.length === 0) return `${Array.from(first)[0] ?? ''}…`;
  return `${first} ${rest.map((w) => Array.from(w)[0] ?? '').join(' ')}…`;
}

/**
 * Send a REGISTRATION code to a +237 mobile (CM-07, v5.0.0-6.6.1). Foreign or
 * invalid numbers are refused before any limit is consumed or SMS queued.
 * `masked_name` is the one deliberate disclosure (v5.0.0-6.3.8).
 *
 * @throws 400 VALIDATION_ERROR, 400 UNSUPPORTED_NUMBER, 429 OTP_RATE_LIMITED
 */
export async function requestRegistrationCode(
  input: { phone_number: string },
  clientKeys: ClientKeys = {}
): Promise<{ sent: true; expires_in: number; existing_account: { masked_name: string } | null }> {
  const phone = normalizeE164(input.phone_number);
  if (phone === null) {
    const parsed = parsePhoneNumberFromString(input.phone_number, 'CM');
    if (parsed?.isValid() && parsed.country !== 'CM') {
      throw httpError(400, 'UNSUPPORTED_NUMBER', 'This number is not supported');
    }
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid phone number');
  }

  const holder = await findByActivePhone(phone);
  const registered = holder?.registeredAt != null && holder.fullName;
  await issueCode(
    {
      personId: holder?.id ?? null,
      target: phone,
      purpose: 'REGISTRATION',
      channel: 'SMS',
      ...(registered ? {} : { language: 'FR' as const }),
    },
    clientKeys
  );
  return {
    sent: true,
    expires_in: EXPIRES_IN_SECONDS,
    existing_account: registered ? { masked_name: maskName(holder.fullName ?? '') } : null,
  };
}

export type RegisterInput = {
  phone_number: string;
  code: string;
  full_name: string;
  password: string;
  device: DeviceInfo;
};

export type SessionResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
  person: { id: string; full_name: string | null };
};

/**
 * Register a person with a REGISTRATION code, creating the account or completing
 * a guest row (same id, so relations stay intact) and opening a session (CM-05, C-02, C-03).
 * Password rules are checked before the code is consumed; the code proves number
 * ownership. Person and session are written in one transaction. Never logs the
 * password or code.
 *
 * @throws 400 VALIDATION_ERROR, OTP_INVALID, OTP_EXPIRED, WEAK_PASSWORD; 409 ACCOUNT_EXISTS
 */
export async function register(input: RegisterInput): Promise<SessionResponse> {
  const phone = normalizeE164(input.phone_number);
  if (phone === null) throw httpError(400, 'VALIDATION_ERROR', 'Invalid phone number');
  if ((await validatePasswordRules(input.password)).length > 0) {
    throw httpError(400, 'WEAK_PASSWORD', 'Password is too weak');
  }
  await verifyCode({ target: phone, purpose: 'REGISTRATION', code: input.code });
  const passwordHash = await hashPassword(input.password);

  const result = await inTransaction(async (tx) => {
    const person = await completeRegistration(tx, {
      phone,
      fullName: input.full_name,
      passwordHash,
    });
    if (!person) return null;
    return { person, session: await issueSession(person.id, input.device, tx) };
  });
  if (!result) {
    logger.warn({ event: 'registration_refused_account_exists' }, 'Registration refused');
    throw httpError(409, 'ACCOUNT_EXISTS', 'An account already exists for this number');
  }
  logger.info({ event: 'registered', personId: result.person.id }, 'Person registered');
  return {
    access_token: result.session.accessToken,
    refresh_token: result.session.refreshToken,
    expires_in: result.session.expiresIn,
    token_type: 'Bearer',
    person: { id: result.person.id, full_name: result.person.fullName },
  };
}
