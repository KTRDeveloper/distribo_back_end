import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { httpError } from '../../lib/http-error.js';
import { normalizeE164 } from '../../shared/phone.js';
import { findByActivePhone } from '../person/person.repository.js';
import { hashPassword, validatePasswordRules, verifyPassword } from '../../lib/password.js';
import { checkAndConsume, getCount, resetKey } from '../../lib/rate-limit.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { enqueueOtpDelivery } from '../../lib/otp-delivery-queue.js';
import { notify } from '../notification/notification.service.js';
import {
  completeRegistration,
  findEmailState,
  inTransaction,
  releaseRegisteredHolder,
} from './auth.repository.js';
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
  new_holder?: boolean;
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
  return registerInternal(input, input.new_holder === true);
}

/**
 * Register as the new holder of a recycled number (CM-04, C-02): the code proves the
 * SIM, the previous registered holder is released in the same transaction, notified
 * (`phone.taken_over`, plus an email when verified, without the number) and keeps
 * everything else. Nothing of theirs is reassigned (v5.0.0-8.2.2).
 *
 * @throws 400 OTP_INVALID, OTP_EXPIRED, WEAK_PASSWORD, VALIDATION_ERROR; 409 ACCOUNT_EXISTS
 */
export function releaseHolderAndRegister(input: RegisterInput): Promise<SessionResponse> {
  return registerInternal(input, true);
}

const TAKEN_OVER_TEXT =
  "Votre numéro est maintenant utilisé par quelqu'un d'autre. Ajoutez votre nouveau numéro.";

async function registerInternal(input: RegisterInput, release: boolean): Promise<SessionResponse> {
  const phone = normalizeE164(input.phone_number);
  if (phone === null) throw httpError(400, 'VALIDATION_ERROR', 'Invalid phone number');
  if ((await validatePasswordRules(input.password)).length > 0) {
    throw httpError(400, 'WEAK_PASSWORD', 'Password is too weak');
  }
  await verifyCode({ target: phone, purpose: 'REGISTRATION', code: input.code });
  const passwordHash = await hashPassword(input.password);

  let released: Awaited<ReturnType<typeof releaseRegisteredHolder>> = null;
  const result = await inTransaction(async (tx) => {
    released = release ? await releaseRegisteredHolder(tx, phone) : null;
    if (released) {
      await notify(
        { recipientId: released.id, sourceEvent: 'phone.taken_over', content: TAKEN_OVER_TEXT },
        tx
      );
    }
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
  const prev = released as Awaited<ReturnType<typeof releaseRegisteredHolder>>;
  if (prev) {
    logger.warn(
      { event: 'phone_released', previousPersonId: prev.id, personId: result.person.id },
      'Phone number released'
    );
    if (prev.emailVerified && prev.email) {
      await enqueueOtpDelivery({
        channel: 'EMAIL',
        to: prev.email,
        message: TAKEN_OVER_TEXT,
        subject: 'Distribo',
      });
    }
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

export type LoginInput = { phone_number: string; password: string; use_email?: boolean };

const MAX_LOGIN_FAILURES = 5;
let dummyHash: Promise<string> | undefined;
/** Fixed Argon2id hash so unknown numbers cost one verification like known ones (v5.0.0-6.3.8). */
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  return dummyHash;
}

/**
 * First login step (CM-05, C-33): check number and password, then send a LOGIN code;
 * the password alone never opens a session (v5.0.0-6.3.3). Five failures per number
 * lock it for `loginLockMinutes` (v5.0.0-6.3.1). Every failing credential case does the
 * same work and gives the same answer (v5.0.0-6.3.8). Logs ids only.
 *
 * @throws 400 VALIDATION_ERROR, EMAIL_NOT_VERIFIED; 401 INVALID_CREDENTIALS;
 *   403 ACCOUNT_SUSPENDED; 429 LOGIN_LOCKED, OTP_RATE_LIMITED
 */
export async function requestLogin(
  input: LoginInput,
  clientKeys: ClientKeys = {}
): Promise<{ sent: true; channel: 'SMS' | 'EMAIL'; expires_in: number }> {
  const phone = normalizeE164(input.phone_number);
  if (phone === null) throw httpError(400, 'VALIDATION_ERROR', 'Invalid phone number');
  const key = `login:fail:${phone}`;
  if ((await getCount(key)) >= MAX_LOGIN_FAILURES) {
    logger.warn({ event: 'login_locked' }, 'Login locked');
    throw httpError(429, 'LOGIN_LOCKED', 'Too many failed attempts');
  }

  const holder = await findByActivePhone(phone);
  const hash = holder?.registeredAt && holder.passwordHash ? holder.passwordHash : null;
  const ok = await verifyPassword(hash ?? (await getDummyHash()), input.password);
  if (!ok || hash === null || !holder) {
    await checkAndConsume(key, Number.MAX_SAFE_INTEGER, config.auth.loginLockMinutes * 60);
    logger.warn(
      { event: 'login_failed', ...(holder ? { personId: holder.id } : {}) },
      'Login failed'
    );
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }
  await resetKey(key);
  if (holder.status === 'SUSPENDED') {
    logger.warn({ event: 'login_refused_suspended', personId: holder.id }, 'Login refused');
    throw httpError(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
  }
  const viaEmail = input.use_email === true;
  if (viaEmail && (!holder.email || !holder.emailVerifiedAt)) {
    throw httpError(400, 'EMAIL_NOT_VERIFIED', 'Email is not verified');
  }
  const channel = viaEmail ? 'EMAIL' : 'SMS';
  await issueCode(
    {
      personId: holder.id,
      target: viaEmail ? (holder.email ?? '') : phone,
      purpose: 'LOGIN',
      channel,
    },
    clientKeys
  );
  logger.info({ event: 'login_code_sent', personId: holder.id, channel }, 'Login code sent');
  return { sent: true, channel, expires_in: EXPIRES_IN_SECONDS };
}

/**
 * Send an EMAIL_VERIFICATION code to the person's saved email (C-33, CM-07). The
 * target is read from the database, never from the request (v5.0.0-6.5.1); the
 * per-target limits apply as for any code (v5.0.0-2.4.1).
 *
 * @returns null when the email is already verified (nothing sent)
 * @throws 400 EMAIL_MISSING, 429 OTP_RATE_LIMITED
 */
export async function requestEmailVerification(
  personId: string,
  clientKeys: ClientKeys = {}
): Promise<{ sent: true; expires_in: number } | null> {
  const state = await findEmailState(personId);
  if (!state?.email) throw httpError(400, 'EMAIL_MISSING', 'No email saved');
  if (state.emailVerifiedAt) return null;
  await issueCode(
    { personId, target: state.email, purpose: 'EMAIL_VERIFICATION', channel: 'EMAIL' },
    clientKeys
  );
  logger.info({ event: 'email_verification_code_sent', personId }, 'Email code sent');
  return { sent: true, expires_in: EXPIRES_IN_SECONDS };
}
