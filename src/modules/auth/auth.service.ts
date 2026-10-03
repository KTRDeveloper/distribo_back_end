import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { httpError } from '../../lib/http-error.js';
import { normalizeE164 } from '../../shared/phone.js';
import { findByActivePhone, findByVerifiedEmail } from '../person/person.repository.js';
import { hashPassword, validatePasswordRules, verifyPassword } from '../../lib/password.js';
import { checkAndConsume, getCount, resetKey } from '../../lib/rate-limit.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { enqueueOtpDelivery } from '../../lib/otp-delivery-queue.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  completeRegistration,
  findEmailState,
  inTransaction,
  isEmailVerifiedByOther,
  markEmailVerified,
  movePhoneNumber,
  listLiveDeviceIds,
  releaseRegisteredHolder,
  updatePasswordHash,
  findPasswordHash,
} from './auth.repository.js';
import { issueCode, verifyCode, type ClientKeys } from './otp.service.js';
import { newId } from '../../shared/ids.js';
import { issueSession, revokeSessions, type DeviceInfo } from './session.service.js';
import { sessionRepository } from './session.repository.js';

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

/**
 * Send a PASSWORD_RESET code to a registered holder's own channel (C-33, CM-07,
 * v5.0.0-6.4.3): SMS, or the verified email when `use_email`. Every other case
 * (invalid, foreign, unknown, guest, unverified email) sends nothing and answers
 * identically (v5.0.0-6.3.8); only `masked_name` differs, as the design requires.
 *
 * @throws 429 OTP_RATE_LIMITED
 */
export async function requestPasswordReset(
  input: { phone_number: string; use_email?: boolean },
  clientKeys: ClientKeys = {}
): Promise<{ sent: true; expires_in: number; existing_account: { masked_name: string } | null }> {
  const nothing = { sent: true as const, expires_in: EXPIRES_IN_SECONDS, existing_account: null };
  const phone = normalizeE164(input.phone_number);
  if (phone === null) return nothing;
  const holder = await findByActivePhone(phone);
  if (!holder?.registeredAt || !holder.fullName) return nothing;
  const viaEmail = input.use_email === true;
  if (viaEmail && (!holder.email || !holder.emailVerifiedAt)) return nothing;
  await issueCode(
    {
      personId: holder.id,
      target: viaEmail ? (holder.email ?? '') : phone,
      purpose: 'PASSWORD_RESET',
      channel: viaEmail ? 'EMAIL' : 'SMS',
    },
    clientKeys
  );
  logger.info({ event: 'password_reset_code_sent', personId: holder.id }, 'Reset code sent');
  return { ...nothing, existing_account: { masked_name: maskName(holder.fullName) } };
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

export type LoginInput = {
  phone_number?: string | undefined;
  email?: string | undefined;
  password: string;
  use_email?: boolean | undefined;
};

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
  if (input.email !== undefined)
    return requestLoginByEmail(input.email, input.password, clientKeys);
  const phone = normalizeE164(input.phone_number ?? '');
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
 * Email variant of the first login step (AUTH-015, v5.0.0-6.4.3): only a person with
 * no active number may use it, so it never bypasses the SIM. Every failing case gives
 * the same 401 as the number route and sends nothing (v5.0.0-6.3.8).
 */
async function requestLoginByEmail(
  rawEmail: string,
  password: string,
  clientKeys: ClientKeys
): Promise<{ sent: true; channel: 'EMAIL'; expires_in: number }> {
  const email = rawEmail.trim().toLowerCase();
  const key = `login:fail:email:${email}`;
  if ((await getCount(key)) >= MAX_LOGIN_FAILURES) {
    logger.warn({ event: 'login_locked' }, 'Login locked');
    throw httpError(429, 'LOGIN_LOCKED', 'Too many failed attempts');
  }
  const found = await findByVerifiedEmail(email);
  const holder = found && found.phoneNumber === null ? found : null;
  const hash = holder?.registeredAt && holder.passwordHash ? holder.passwordHash : null;
  const ok = await verifyPassword(hash ?? (await getDummyHash()), password);
  if (!ok || hash === null || !holder) {
    await checkAndConsume(key, Number.MAX_SAFE_INTEGER, config.auth.loginLockMinutes * 60);
    logger.warn(
      { event: 'login_failed', ...(found ? { personId: found.id } : {}) },
      'Login failed'
    );
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }
  await resetKey(key);
  if (holder.status === 'SUSPENDED') {
    logger.warn({ event: 'login_refused_suspended', personId: holder.id }, 'Login refused');
    throw httpError(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
  }
  await issueCode(
    { personId: holder.id, target: holder.email ?? email, purpose: 'LOGIN', channel: 'EMAIL' },
    clientKeys
  );
  logger.info(
    { event: 'login_code_sent', personId: holder.id, channel: 'EMAIL' },
    'Login code sent'
  );
  return { sent: true, channel: 'EMAIL', expires_in: EXPIRES_IN_SECONDS };
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

/**
 * Confirm an EMAIL_VERIFICATION code against the saved email (C-33, v5.0.0-6.5.1).
 * The target is read from the database, so a code sent to an older address or to
 * another person never matches. EMAIL_TAKEN is checked before the code is spent.
 *
 * @throws 400 OTP_INVALID, OTP_EXPIRED; 409 EMAIL_TAKEN; 429 OTP_LOCKED
 */
export async function confirmEmail(personId: string, code: string): Promise<void> {
  const state = await findEmailState(personId);
  if (!state?.email) throw httpError(400, 'OTP_INVALID', 'Invalid code');
  const taken = () => httpError(409, 'EMAIL_TAKEN', 'Email already in use');
  if (await isEmailVerifiedByOther(state.email, personId)) throw taken();
  const r = await verifyCode({ target: state.email, purpose: 'EMAIL_VERIFICATION', code });
  if (r.personId !== personId) throw httpError(400, 'OTP_INVALID', 'Invalid code');
  let ok: boolean;
  try {
    ok = await markEmailVerified(personId, state.email);
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw taken();
    throw e;
  }
  if (!ok) throw httpError(400, 'OTP_INVALID', 'Invalid code');
  logger.info({ event: 'email_verified', personId }, 'Email verified');
}

/**
 * Send a PHONE_CHANGE code to a new +237 mobile (C-33, C-02, CM-07). The person
 * comes from the session; the code goes to the new number only (v5.0.0-6.6.1).
 * The 409 never reveals who holds the number (Q-031); caps apply as for any code.
 *
 * @throws 400 VALIDATION_ERROR, 400 UNSUPPORTED_NUMBER, 400 SAME_NUMBER,
 *   409 PHONE_TAKEN, 429 OTP_RATE_LIMITED
 */
export async function requestPhoneChange(
  personId: string,
  input: { new_phone_number: string },
  clientKeys: ClientKeys = {}
): Promise<{ sent: true; expires_in: number }> {
  const phone = normalizeE164(input.new_phone_number);
  if (phone === null) {
    const parsed = parsePhoneNumberFromString(input.new_phone_number, 'CM');
    if (parsed?.isValid() && parsed.country !== 'CM') {
      throw httpError(400, 'UNSUPPORTED_NUMBER', 'This number is not supported');
    }
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid phone number');
  }
  const holder = await findByActivePhone(phone);
  if (holder?.id === personId) throw httpError(400, 'SAME_NUMBER', 'This is already your number');
  if (holder) throw httpError(409, 'PHONE_TAKEN', 'This number is not available');
  await issueCode({ personId, target: phone, purpose: 'PHONE_CHANGE', channel: 'SMS' }, clientKeys);
  logger.info({ event: 'phone_change_code_sent', personId }, 'Phone change code sent');
  return { sent: true, expires_in: EXPIRES_IN_SECONDS };
}

/**
 * Move the account to a new number with a PHONE_CHANGE code bound to that number
 * and purpose (v5.0.0-6.5.1). Number update and journal row share one transaction
 * (v5.0.0-2.3.3); the loser of a race for the number gets PHONE_TAKEN. Logs ids only.
 *
 * @throws 400 VALIDATION_ERROR, OTP_INVALID, OTP_EXPIRED; 409 PHONE_TAKEN; 429 OTP_LOCKED
 */
export async function confirmPhoneChange(
  personId: string,
  input: { new_phone_number: string; code: string }
): Promise<void> {
  const phone = normalizeE164(input.new_phone_number);
  if (phone === null) throw httpError(400, 'VALIDATION_ERROR', 'Invalid phone number');
  const taken = () => httpError(409, 'PHONE_TAKEN', 'This number is not available');
  const holder = await findByActivePhone(phone);
  if (holder && holder.id !== personId) throw taken();
  const r = await verifyCode({ target: phone, purpose: 'PHONE_CHANGE', code: input.code });
  if (r.personId !== personId || holder?.id === personId) {
    throw httpError(400, 'OTP_INVALID', 'Invalid code');
  }
  let ok: boolean;
  try {
    ok = await inTransaction((tx) => movePhoneNumber(tx, personId, phone, newId()));
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw taken();
    throw e;
  }
  if (!ok) throw httpError(400, 'OTP_INVALID', 'Invalid code');
  logger.info({ event: 'phone_changed', personId }, 'Phone number changed');
}

export type LoginVerifyInput = {
  phone_number?: string | undefined;
  email?: string | undefined;
  code: string;
  device: DeviceInfo;
  use_email?: boolean;
};

/**
 * Second login step (CM-08, C-33): check the LOGIN code bound to the number (or the
 * verified email) and open a new device session (v5.0.0-6.5.1, v5.0.0-7.2.4). A suspended
 * person is refused before the code is spent. Every other live device gets one
 * `device.new_login` notification in the same transaction. Unknown numbers and
 * missing emails answer OTP_INVALID like a wrong code. Logs ids only.
 *
 * @throws 400 VALIDATION_ERROR, OTP_INVALID, OTP_EXPIRED; 403 ACCOUNT_SUSPENDED; 429 OTP_LOCKED
 */
export async function completeLogin(input: LoginVerifyInput): Promise<SessionResponse> {
  const byEmail = input.email !== undefined;
  const phone = byEmail ? null : normalizeE164(input.phone_number ?? '');
  if (!byEmail && phone === null) throw httpError(400, 'VALIDATION_ERROR', 'Invalid phone number');
  const found = byEmail
    ? await findByVerifiedEmail((input.email ?? '').trim())
    : await findByActivePhone(phone ?? '');
  // The email route is only for people with no active number (v5.0.0-6.4.3).
  const holder = byEmail && found?.phoneNumber != null ? null : found;
  if (!holder?.registeredAt) throw httpError(400, 'OTP_INVALID', 'Invalid code');
  if (holder.status === 'SUSPENDED') {
    logger.warn({ event: 'login_refused_suspended', personId: holder.id }, 'Login refused');
    throw httpError(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
  }
  const viaEmail = byEmail || input.use_email === true;
  const target = viaEmail ? holder.email : phone;
  if (!target || (viaEmail && !holder.emailVerifiedAt)) {
    throw httpError(400, 'OTP_INVALID', 'Invalid code');
  }
  const { personId } = await verifyCode({ target, purpose: 'LOGIN', code: input.code });
  if (personId !== holder.id) throw httpError(400, 'OTP_INVALID', 'Invalid code');

  const language = await recipientLanguage(holder.id);
  const model = input.device.model;
  const content =
    language === 'EN'
      ? `New sign-in on ${model ?? 'a new device'}. Wasn't you? Sign it out.`
      : `Nouvelle connexion sur ${model ?? 'un nouvel appareil'}. Ce n'était pas vous ? Déconnectez-le.`;
  const session = await inTransaction(async (tx) => {
    const others = await listLiveDeviceIds(tx, holder.id);
    const opened = await issueSession(holder.id, input.device, tx);
    for (const deviceId of others) {
      await notify(
        {
          recipientId: holder.id,
          sourceEvent: 'device.new_login',
          content,
          related: { type: 'device', id: deviceId },
        },
        tx
      );
    }
    return opened;
  });
  logger.info(
    { event: 'login_succeeded', personId: holder.id, deviceId: session.deviceId },
    'Login succeeded'
  );
  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_in: session.expiresIn,
    token_type: 'Bearer',
    person: { id: holder.id, full_name: holder.fullName },
  };
}

export type DeviceView = {
  id: string;
  platform: string;
  model: string | null;
  app_version: string;
  created_at: string;
  last_synced_at: string | null;
  current: boolean;
};

/** Live devices of the person with an explicit field list (v5.0.0-15.3.1); no push token or verdict. */
export async function listDevices(
  personId: string,
  currentDeviceId: string
): Promise<DeviceView[]> {
  const rows = await sessionRepository.listLive(personId);
  return rows.map((d) => ({
    id: d.id,
    platform: d.platform,
    model: d.model,
    app_version: d.appVersion,
    created_at: d.createdAt.toISOString(),
    last_synced_at: d.lastSyncedAt ? d.lastSyncedAt.toISOString() : null,
    current: d.id === currentDeviceId,
  }));
}

export type PasswordResetConfirmInput = {
  phone_number: string;
  code: string;
  new_password: string;
  use_email?: boolean;
};

/**
 * Set a new password with a PASSWORD_RESET code bound to the number (or verified
 * email), then end every session of the person (CM-05, v5.0.0-6.4.3, v5.0.0-7.4.3).
 * Password rules are checked before the code is spent, so a weak password keeps it.
 * Unknown or unregistered numbers answer OTP_INVALID. Never logs password or code.
 *
 * @throws 400 VALIDATION_ERROR, WEAK_PASSWORD, OTP_INVALID, OTP_EXPIRED; 429 OTP_LOCKED
 */
export async function confirmPasswordReset(input: PasswordResetConfirmInput): Promise<void> {
  const invalid = () => httpError(400, 'OTP_INVALID', 'Invalid code');
  const phone = normalizeE164(input.phone_number);
  if (phone === null) throw httpError(400, 'VALIDATION_ERROR', 'Invalid phone number');
  if ((await validatePasswordRules(input.new_password)).length > 0) {
    throw httpError(400, 'WEAK_PASSWORD', 'Password is too weak');
  }
  const holder = await findByActivePhone(phone);
  if (!holder?.registeredAt || !holder.fullName) throw invalid();
  const viaEmail = input.use_email === true;
  const target = viaEmail ? holder.email : phone;
  if (!target || (viaEmail && !holder.emailVerifiedAt)) throw invalid();
  const r = await verifyCode({ target, purpose: 'PASSWORD_RESET', code: input.code });
  if (r.personId !== holder.id) throw invalid();
  if (!(await updatePasswordHash(holder.id, await hashPassword(input.new_password)))) {
    throw invalid();
  }
  await revokeSessions(holder.id, 'PASSWORD_RESET');
  await resetKey(`login:fail:${phone}`);
  logger.info({ event: 'password_reset', personId: holder.id }, 'Password reset');
}

/**
 * Change the password of the signed-in person (CM-05, v5.0.0-6.2.2, v5.0.0-6.2.3,
 * v5.0.0-7.4.3). The current password is checked first; five failures lock the
 * attempts for `loginLockMinutes`. Other devices are revoked, this one stays live.
 *
 * @throws 400 WEAK_PASSWORD, VALIDATION_ERROR; 401 INVALID_CREDENTIALS; 429 LOGIN_LOCKED
 */
export async function changePassword(
  personId: string,
  deviceId: string,
  input: { current_password: string; new_password: string }
): Promise<void> {
  const key = `pwchange:${personId}`;
  if ((await getCount(key)) >= MAX_LOGIN_FAILURES) {
    logger.warn({ event: 'password_change_locked', personId }, 'Password change locked');
    throw httpError(429, 'LOGIN_LOCKED', 'Too many failed attempts');
  }
  const hash = await findPasswordHash(personId);
  const ok = await verifyPassword(hash ?? (await getDummyHash()), input.current_password);
  if (!ok || hash === null) {
    await checkAndConsume(key, Number.MAX_SAFE_INTEGER, config.auth.loginLockMinutes * 60);
    logger.warn({ event: 'password_change_failed', personId }, 'Password change failed');
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }
  await resetKey(key);
  if ((await validatePasswordRules(input.new_password)).length > 0) {
    throw httpError(400, 'WEAK_PASSWORD', 'Password is too weak');
  }
  if (input.new_password === input.current_password) {
    throw httpError(400, 'VALIDATION_ERROR', 'New password must differ');
  }
  const newHash = await hashPassword(input.new_password);
  // One transaction: a failed revocation must not leave the new password with other sessions live.
  await inTransaction(async (tx) => {
    if (!(await updatePasswordHash(personId, newHash, tx))) {
      throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }
    await revokeSessions(personId, 'PASSWORD_RESET', { exceptDeviceId: deviceId, tx });
  });
  logger.info({ event: 'password_changed', personId }, 'Password changed');
}
