import type { Person } from '@prisma/client';
import { config } from '../../config/index.js';
import { httpError } from '../../lib/http-error.js';
import { ADMIN_TOKEN_EXPIRES_IN_SECONDS, signAdminToken } from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { checkAndConsume, resetKey } from '../../lib/rate-limit.js';
import { createTotpSecret, decryptSecret, encryptSecret, verifyTotp } from '../../lib/totp.js';
import { normalizeE164 } from '../../shared/phone.js';
import { issueCode, verifyCode } from '../auth/otp.service.js';
import {
  findByActivePhone,
  toPublicPerson,
  type PublicPerson,
} from '../person/person.repository.js';
import {
  countOtherLiveSuperAdmins,
  findLiveAdministratorById,
  findLiveAdministratorByPerson,
  findPersonEmail,
  findRegisteredPersonByPhone,
  hasLiveAdministrator,
  inTransaction,
  insertAdministrator,
  lockAdministratorRemoval,
  markAdministratorRemoved,
  recordAdminAction,
  setRecoveryEmail,
} from './admin.repository.js';
import type { AdminLoginInput, AppointInput, RemoveInput } from './admin.schemas.js';

const MAX_LOGIN_FAILURES = 5;

let dummyHash: Promise<string> | undefined;
/** Fixed Argon2id hash so unknown numbers cost one verification like known ones (v5.0.0-6.3.8). */
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  return dummyHash;
}

function invalidCredentials(personId?: string) {
  logger.warn(
    { event: 'admin_login_failed', ...(personId ? { personId } : {}) },
    'Admin login failed'
  );
  return httpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
}

/**
 * Signs an administrator in with password and authenticator code (C-29, v5.0.0-6.3.3).
 *
 * One attempt is taken from the `admin:<phone>` counter before anything else, so parallel
 * requests cannot pass a stale count (v5.0.0-6.3.1); a success clears it. Checks run in a
 * fixed order (person, password, live administrator, person not suspended, TOTP) and every
 * failure gives the same 401, with one password verification even for an unknown number
 * (v5.0.0-6.3.8). The token lasts 15 minutes and there is no refresh token (Q-013).
 * Logs ids only.
 *
 * @throws 401 INVALID_CREDENTIALS; 429 LOGIN_LOCKED
 */
export async function adminLogin(
  input: AdminLoginInput
): Promise<{ access_token: string; expires_in: number; role: string }> {
  const phone = normalizeE164(input.phone_number);
  if (phone === null) {
    await verifyPassword(await getDummyHash(), input.password);
    throw invalidCredentials();
  }

  const key = `admin:${phone}`;
  const slot = await checkAndConsume(key, MAX_LOGIN_FAILURES, config.auth.loginLockMinutes * 60);
  if (!slot.allowed) {
    logger.warn({ event: 'admin_login_locked' }, 'Admin attempts locked');
    throw httpError(429, 'LOGIN_LOCKED', 'Too many failed attempts');
  }

  const person = await findByActivePhone(phone);
  const hash = person?.registeredAt && person.passwordHash ? person.passwordHash : null;
  const passwordOk = await verifyPassword(hash ?? (await getDummyHash()), input.password);
  if (!passwordOk || hash === null || !person) throw invalidCredentials(person?.id);

  const administrator = await findLiveAdministratorByPerson(person.id);
  if (!administrator) throw invalidCredentials(person.id);
  if (person.status === 'SUSPENDED') throw invalidCredentials(person.id);

  const totpOk = await verifyTotp(
    administrator.id,
    decryptSecret(administrator.totpSecret),
    input.totp_code
  );
  if (!totpOk) throw invalidCredentials(person.id);

  await resetKey(key);
  logger.info(
    { event: 'admin_login_succeeded', personId: person.id, administratorId: administrator.id },
    'Admin login succeeded'
  );
  return {
    access_token: signAdminToken({
      personId: person.id,
      administratorId: administrator.id,
      role: administrator.role,
    }),
    expires_in: ADMIN_TOKEN_EXPIRES_IN_SECONDS,
    role: administrator.role,
  };
}

/** The signed-in administrator, as set by `adminAuthMiddleware`. */
export interface AdminContext {
  personId: string;
  administratorId: string;
  role: 'MODERATOR' | 'SUPER_ADMIN';
}

/** Refuses the person's own email, whatever the case (C-29); the database repeats the rule. */
async function assertNotOwnEmail(admin: AdminContext, email: string): Promise<void> {
  const own = await findPersonEmail(admin.personId);
  if (own !== null && own.trim().toLowerCase() === email) {
    throw httpError(400, 'VALIDATION_ERROR', 'Recovery email must differ from your own email');
  }
}

/**
 * Sends a verification code to a candidate recovery email (C-29, C-33). Nothing is saved yet
 * (v5.0.0-6.4.3). The code is tied to the administrator's person, the address and the
 * EMAIL_VERIFICATION purpose, so it cannot be used for another address or person
 * (v5.0.0-6.5.1). `email` must already be trimmed and lower-case (the schema does this).
 *
 * @throws 400 VALIDATION_ERROR for the person's own email; 429 OTP_RATE_LIMITED
 */
export async function requestRecoveryEmail(admin: AdminContext, email: string): Promise<void> {
  await assertNotOwnEmail(admin, email);
  await issueCode({
    personId: admin.personId,
    target: email,
    purpose: 'EMAIL_VERIFICATION',
    channel: 'EMAIL',
  });
  logger.info(
    { event: 'admin_recovery_email_code_sent', personId: admin.personId },
    'Recovery email code sent'
  );
}

/**
 * Stores the recovery email once the code received at that address is right (v5.0.0-6.4.3).
 * A wrong, expired, consumed or foreign code all give the same 400 OTP_INVALID: the story
 * does not distinguish expiry. The challenge must belong to this administrator's person.
 *
 * @throws 400 VALIDATION_ERROR (own email), 400 OTP_INVALID; 429 OTP_LOCKED
 */
export async function confirmRecoveryEmail(
  admin: AdminContext,
  email: string,
  code: string
): Promise<void> {
  const invalid = () => httpError(400, 'OTP_INVALID', 'Invalid code');
  await assertNotOwnEmail(admin, email);
  let result: Awaited<ReturnType<typeof verifyCode>>;
  try {
    result = await verifyCode({ target: email, purpose: 'EMAIL_VERIFICATION', code });
  } catch (e) {
    if ((e as { code?: string }).code === 'OTP_EXPIRED') throw invalid();
    throw e;
  }
  if (result.personId !== admin.personId) throw invalid();
  if (!(await setRecoveryEmail(admin.administratorId, email))) throw invalid();
  logger.info(
    { event: 'admin_recovery_email_set', personId: admin.personId },
    'Recovery email set'
  );
}

/** What the super administrator gets back once: the new administrator and the enrolment URI. */
export interface AppointedView {
  id: string;
  person_public: PublicPerson;
  role: 'MODERATOR' | 'SUPER_ADMIN';
  /** Holds the plaintext secret; shown only in this response (Q-032). */
  otpauth_uri: string;
}

/**
 * Appoints a registered person as MODERATOR or SUPER_ADMIN (C-29, v5.0.0-8.2.1: the route only
 * lets super administrators in). The administrator row (secret stored encrypted) and its
 * `APPOINT_ADMIN` journal row, with the caller as author, the person as target and the reason,
 * are saved in one transaction (v5.0.0-2.3.3, v5.0.0-16.3.1). The `otpauth://` URI is returned
 * here and nowhere else, so a repeat of the same request does not replay it: it is refused with
 * 409 like any second appointment (Q-032).
 *
 * A guest and an unknown number give the same 404. The unique index on live administrators
 * decides a race between two appointments of one person: the loser gets the 409 too.
 *
 * @throws 404 NOT_FOUND; 409 ALREADY_ADMINISTRATOR
 */
export async function appointAdministrator(
  admin: AdminContext,
  input: AppointInput
): Promise<AppointedView> {
  const alreadyAdministrator = () =>
    httpError(409, 'ALREADY_ADMINISTRATOR', 'The person is already an administrator');
  const { secret, otpauthUri } = createTotpSecret();
  let person: Person;
  try {
    person = await inTransaction(async (tx) => {
      const found = await findRegisteredPersonByPhone(tx, input.phone_number);
      if (!found) throw httpError(404, 'NOT_FOUND', 'Person not found');
      if (await hasLiveAdministrator(tx, found.id)) throw alreadyAdministrator();
      await insertAdministrator(tx, {
        id: input.id,
        personId: found.id,
        role: input.role,
        encryptedTotpSecret: encryptSecret(secret),
      });
      await recordAdminAction(tx, {
        administratorId: admin.administratorId,
        action: 'APPOINT_ADMIN',
        targetPersonId: found.id,
        reason: input.reason,
      });
      return found;
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw alreadyAdministrator();
    throw e;
  }
  logger.info(
    {
      event: 'admin_appointed',
      administratorId: admin.administratorId,
      targetPersonId: person.id,
      role: input.role,
    },
    'Administrator appointed'
  );
  return {
    id: input.id,
    person_public: toPublicPerson(person),
    role: input.role,
    otpauth_uri: otpauthUri,
  };
}

/**
 * Removes an administrator (C-29, v5.0.0-8.2.1: the route only lets super administrators in).
 * `removed_at` is set and the row stays, so earlier journal rows keep their author; the
 * `REMOVE_ADMIN` journal row (caller as author, the person as target, the reason) is saved in
 * the same transaction (v5.0.0-2.3.3, v5.0.0-16.3.1). The administrator middleware looks the
 * row up on every request, so the token stops working at once.
 *
 * The last live SUPER_ADMIN cannot be removed. A lock taken first makes two parallel removals
 * of the last two super administrators run one after the other, so exactly one succeeds.
 * An unknown or already removed id gives 404.
 *
 * @throws 404 NOT_FOUND; 409 LAST_SUPER_ADMIN
 */
export async function removeAdministrator(
  admin: AdminContext,
  administratorId: string,
  input: RemoveInput
): Promise<void> {
  const target = await inTransaction(async (tx) => {
    await lockAdministratorRemoval(tx);
    const found = await findLiveAdministratorById(tx, administratorId);
    if (!found) throw httpError(404, 'NOT_FOUND', 'Administrator not found');
    if (found.role === 'SUPER_ADMIN' && (await countOtherLiveSuperAdmins(tx, found.id)) === 0) {
      throw httpError(409, 'LAST_SUPER_ADMIN', 'The last super administrator cannot be removed');
    }
    if (!(await markAdministratorRemoved(tx, found.id))) {
      throw httpError(404, 'NOT_FOUND', 'Administrator not found');
    }
    await recordAdminAction(tx, {
      administratorId: admin.administratorId,
      action: 'REMOVE_ADMIN',
      targetPersonId: found.personId,
      reason: input.reason,
    });
    return found;
  });
  logger.info(
    {
      event: 'admin_removed',
      administratorId: admin.administratorId,
      targetAdministratorId: target.id,
      targetPersonId: target.personId,
    },
    'Administrator removed'
  );
}
