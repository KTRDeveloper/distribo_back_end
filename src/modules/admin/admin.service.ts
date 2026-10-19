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
import { revokeSessions } from '../auth/session.service.js';
import { releaseNumberOfPerson } from '../auth/support-access.service.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  findByActivePhone,
  toPublicPerson,
  type PublicPerson,
} from '../person/person.repository.js';
import {
  countOtherLiveSuperAdmins,
  findActiveOwnerId,
  findReportRowTx,
  markReportResolved,
  suspendOrganization as suspendOrganizationRow,
  suspendPerson as suspendPersonRow,
  findOrganizationForModeration,
  findPersonStatus,
  transitionOrganizationStatus,
  transitionPersonStatus,
  findLiveAdministratorById,
  findLiveAdministratorByPerson,
  findPersonEmail,
  findRecoveryEmail,
  listOtherLiveSuperAdminPersonIds,
  replaceTotpSecret,
  findReportRow,
  findRegisteredPersonByPhone,
  hasLiveAdministrator,
  inTransaction,
  insertAdministrator,
  insertReport,
  isActiveOwner,
  listAdminActionRows,
  listReportRows,
  lockAdministratorRemoval,
  markAdministratorRemoved,
  organizationExists,
  type ReportRow,
  personExists,
  recordAdminAction,
  setRecoveryEmail,
} from './admin.repository.js';
import type {
  AdminLoginInput,
  AppointInput,
  CreateReportInput,
  ListActionsQuery,
  ListReportsQuery,
  ModerationReasonInput,
  RemoveInput,
  ResolveReportInput,
  TotpRecoveryConfirmInput,
  TotpRecoveryRequestInput,
} from './admin.schemas.js';

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

/**
 * Checks phone and password for a recovery call, with the login rules (C-29, v5.0.0-6.3.1,
 * v5.0.0-6.3.8): one attempt is taken from the `admin:<phone>` counter first, every failure is
 * the same 401, and an unknown number still costs one password verification. The counter is
 * not cleared here: only a real sign-in clears it, so recovery calls cannot be used to reset
 * the attempts of the login route. Returns the person, or throws.
 *
 * @throws 401 INVALID_CREDENTIALS; 429 LOGIN_LOCKED
 */
async function checkRecoveryPassword(phoneNumber: string, password: string): Promise<Person> {
  const phone = normalizeE164(phoneNumber);
  if (phone === null) {
    await verifyPassword(await getDummyHash(), password);
    throw invalidCredentials();
  }
  const slot = await checkAndConsume(
    `admin:${phone}`,
    MAX_LOGIN_FAILURES,
    config.auth.loginLockMinutes * 60
  );
  if (!slot.allowed) {
    logger.warn({ event: 'admin_login_locked' }, 'Admin attempts locked');
    throw httpError(429, 'LOGIN_LOCKED', 'Too many failed attempts');
  }
  const person = await findByActivePhone(phone);
  const hash = person?.registeredAt && person.passwordHash ? person.passwordHash : null;
  const passwordOk = await verifyPassword(hash ?? (await getDummyHash()), password);
  if (!passwordOk || hash === null || !person) throw invalidCredentials(person?.id);
  return person;
}

/**
 * The live administrator who may recover: a registered, non-suspended person with a live
 * administrator row and a verified recovery email. Null otherwise, so callers treat every
 * ineligible case alike.
 */
async function findRecoverableAdministrator(
  person: Person
): Promise<{ administratorId: string; recoveryEmail: string } | null> {
  if (person.status === 'SUSPENDED') return null;
  const administrator = await findLiveAdministratorByPerson(person.id);
  if (!administrator) return null;
  const recoveryEmail = await findRecoveryEmail(administrator.id);
  if (recoveryEmail === null) return null;
  return { administratorId: administrator.id, recoveryEmail };
}

/**
 * Sends a TOTP_RECOVERY code to the administrator's verified recovery email (CM-34, C-33,
 * v5.0.0-6.4.4). The password is checked first, with the login counter and generic 401. Once
 * it is right the answer never tells whether a code left: a person who is not an administrator,
 * a suspended one and an administrator without a recovery email all end quietly with nothing
 * sent. The code is tied to the administrator's person and the recovery address.
 *
 * @throws 401 INVALID_CREDENTIALS; 429 LOGIN_LOCKED, OTP_RATE_LIMITED
 */
export async function requestTotpRecovery(input: TotpRecoveryRequestInput): Promise<void> {
  const person = await checkRecoveryPassword(input.phone_number, input.password);
  const target = await findRecoverableAdministrator(person);
  if (!target) {
    logger.info(
      { event: 'admin_totp_recovery_ignored', personId: person.id },
      'Authenticator recovery request ignored'
    );
    return;
  }
  await issueCode({
    personId: person.id,
    target: target.recoveryEmail,
    purpose: 'TOTP_RECOVERY',
    channel: 'EMAIL',
  });
  logger.info(
    { event: 'admin_totp_recovery_code_sent', personId: person.id },
    'Authenticator recovery code sent'
  );
}

/** Alert text fixed by the story for every recipient, whatever their language. */
const TOTP_RECOVERED_CONTENT = "Ce n'était pas vous ? Bloquer";

/**
 * Installs a new authenticator key after password and recovery email code (CM-34, C-33,
 * v5.0.0-6.4.4). Only the key changes: no session is issued, nothing else is touched (AB-1).
 * A person who cannot recover and a wrong, expired, consumed or foreign code all give the same
 * 400 OTP_INVALID, and the password is checked before the code so a wrong password burns no
 * attempt of the code. The new encrypted secret, the `RECOVER_2FA` journal row (the
 * administrator as author, their person as target, reason "totp recovery") and the
 * `admin.totp_recovered` notifications to the administrator and to every other live
 * SUPER_ADMIN are saved in one transaction, so a recovery is never silent (v5.0.0-16.3.1).
 * The new URI is returned here and nowhere else.
 *
 * @throws 400 OTP_INVALID; 401 INVALID_CREDENTIALS; 429 LOGIN_LOCKED, OTP_LOCKED
 */
export async function confirmTotpRecovery(
  input: TotpRecoveryConfirmInput
): Promise<{ otpauth_uri: string }> {
  const invalid = () => httpError(400, 'OTP_INVALID', 'Invalid code');
  const person = await checkRecoveryPassword(input.phone_number, input.password);
  const target = await findRecoverableAdministrator(person);
  if (!target) throw invalid();

  let result: Awaited<ReturnType<typeof verifyCode>>;
  try {
    result = await verifyCode({
      target: target.recoveryEmail,
      purpose: 'TOTP_RECOVERY',
      code: input.code,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'OTP_EXPIRED') throw invalid();
    throw e;
  }
  if (result.personId !== person.id) throw invalid();

  const { secret, otpauthUri } = createTotpSecret();
  await inTransaction(async (tx) => {
    if (!(await replaceTotpSecret(tx, target.administratorId, encryptSecret(secret)))) {
      throw invalid();
    }
    await recordAdminAction(tx, {
      administratorId: target.administratorId,
      action: 'RECOVER_2FA',
      targetPersonId: person.id,
      reason: 'totp recovery',
    });
    const recipients = [
      person.id,
      ...(await listOtherLiveSuperAdminPersonIds(tx, target.administratorId)),
    ];
    for (const recipientId of new Set(recipients)) {
      await notify(
        {
          recipientId,
          sourceEvent: 'admin.totp_recovered',
          content: TOTP_RECOVERED_CONTENT,
          related: { type: 'administrator', id: target.administratorId },
        },
        tx
      );
    }
  });
  logger.warn(
    {
      event: 'admin_totp_recovered',
      personId: person.id,
      administratorId: target.administratorId,
    },
    'Administrator authenticator replaced through recovery'
  );
  return { otpauth_uri: otpauthUri };
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

const REPORTS_PER_DAY = 10;
const DAY_SECONDS = 86_400;

/** What the reporter gets back: the report id, its status and when it was filed. */
export interface ReportView {
  id: string;
  status: 'PENDING';
  reported_at: string;
}

/**
 * Files a report against a person or an organization (C-28). The reporter is always the caller
 * and the status always PENDING; the schema already refused status, decision and resolver
 * (v5.0.0-15.3.3). The target must exist (404) and may not be the caller or an organization the
 * caller owns (400). Refused requests do not use up the allowance: one slot of the 10-a-day
 * per-person limit (provisional, v5.0.0-2.4.1) is taken only once the request is valid, and the
 * 11th is refused with 429 before anything is stored. Logs ids only.
 *
 * @throws 400 VALIDATION_ERROR (own person or organization); 404 NOT_FOUND; 429 RATE_LIMITED
 */
export async function createReport(
  personId: string,
  input: CreateReportInput
): Promise<ReportView> {
  const targetPersonId = input.target_person_id ?? null;
  const targetOrganizationId = input.target_organization_id ?? null;
  const ownTarget = () => httpError(400, 'VALIDATION_ERROR', 'You cannot report yourself');

  if (targetPersonId === personId) throw ownTarget();
  const stored = await inTransaction(async (tx) => {
    if (targetPersonId !== null && !(await personExists(tx, targetPersonId))) {
      throw httpError(404, 'NOT_FOUND', 'Target not found');
    }
    if (targetOrganizationId !== null) {
      if (!(await organizationExists(tx, targetOrganizationId))) {
        throw httpError(404, 'NOT_FOUND', 'Target not found');
      }
      if (await isActiveOwner(tx, personId, targetOrganizationId)) throw ownTarget();
    }

    const slot = await checkAndConsume(`report:${personId}`, REPORTS_PER_DAY, DAY_SECONDS);
    if (!slot.allowed) {
      logger.warn({ event: 'report_rate_limited', personId }, 'Report rate limited');
      throw httpError(429, 'RATE_LIMITED', 'Too many reports today');
    }

    return insertReport(tx, {
      id: input.id,
      reporterId: personId,
      targetPersonId,
      targetOrganizationId,
      reason: input.reason,
      description: input.description,
    });
  });
  logger.info(
    {
      event: 'report_created',
      personId,
      reportId: stored.id,
      targetPersonId,
      targetOrganizationId,
    },
    'Report created'
  );
  return { id: stored.id, status: stored.status, reported_at: stored.reportedAt.toISOString() };
}

/** What a moderator sees of a report: both people through `toPublicPerson`, explicit fields only. */
export interface AdminReportView {
  id: string;
  reporter: PublicPerson;
  target_person: PublicPerson | null;
  target_organization: { id: string; name: string; status: string } | null;
  reason: string;
  description: string;
  status: string;
  decision: string | null;
  resolved_by_id: string | null;
  reported_at: string;
  resolved_at: string | null;
}

function toAdminReportView(row: ReportRow): AdminReportView {
  return {
    id: row.id,
    reporter: toPublicPerson(row.reporter),
    target_person: row.targetPerson ? toPublicPerson(row.targetPerson) : null,
    target_organization: row.targetOrganization
      ? {
          id: row.targetOrganization.id,
          name: row.targetOrganization.name,
          status: row.targetOrganization.status,
        }
      : null,
    reason: row.reason,
    description: row.description,
    status: row.status,
    decision: row.decision,
    resolved_by_id: row.resolvedById,
    reported_at: row.reportedAt.toISOString(),
    resolved_at: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

/**
 * Lists reports for a moderator (v5.0.0-8.2.1: the route only lets live administrators in).
 * PENDING is oldest first, anything else newest first. People go through `toPublicPerson`
 * (v5.0.0-15.3.1).
 */
export async function listReports(
  query: ListReportsQuery
): Promise<{ items: AdminReportView[]; next_cursor: string | null }> {
  const { rows, nextCursor } = await listReportRows(query);
  return { items: rows.map(toAdminReportView), next_cursor: nextCursor };
}

/** Opens one report; a missing id is a 404. */
export async function getReport(reportId: string): Promise<AdminReportView> {
  const row = await findReportRow(reportId);
  if (!row) throw httpError(404, 'NOT_FOUND', 'Report not found');
  return toAdminReportView(row);
}

const SUSPENDED_CONTENT = {
  FR: 'Votre compte a été suspendu à la suite d\u2019un signalement.',
  EN: 'Your account has been suspended following a report.',
};
const ORG_SUSPENDED_CONTENT = {
  FR: (name: string) =>
    `L\u2019organisation ${name} a été suspendue à la suite d\u2019un signalement.`,
  EN: (name: string) => `The organization ${name} has been suspended following a report.`,
};

/**
 * Resolves a PENDING report (CM-33, C-28; v5.0.0-8.2.1: the route only lets live moderators in).
 * DISMISSED writes a `DISMISS_REPORT` journal row. SUSPENSION sets the target SUSPENDED (a
 * person also loses every session, reason ACCOUNT_SUSPENDED, and `scope_version` rises) and
 * writes a `SUSPEND` row naming the report, then notifies the person or the organization's
 * owner. All of it is one transaction (v5.0.0-2.3.3), so a failed journal insert leaves the
 * report, the target and the sessions untouched (v5.0.0-16.3.1).
 *
 * The report is claimed by a conditional update on PENDING, so of two parallel resolutions one
 * gets 409 (CWE-362). A target already SUSPENDED stays so and the decision is still recorded.
 *
 * @throws 404 NOT_FOUND; 409 ALREADY_RESOLVED; 409 TARGET_ANONYMIZED (SUSPENSION of an
 * anonymized person)
 */
export async function resolveReport(
  admin: AdminContext,
  reportId: string,
  input: ResolveReportInput
): Promise<AdminReportView> {
  const row = await inTransaction(async (tx) => {
    const report = await findReportRowTx(tx, reportId);
    if (!report) throw httpError(404, 'NOT_FOUND', 'Report not found');
    if (report.status !== 'PENDING') {
      throw httpError(409, 'ALREADY_RESOLVED', 'The report is already resolved');
    }
    if (input.decision === 'SUSPENSION' && report.targetPerson?.status === 'ANONYMIZED') {
      throw httpError(409, 'TARGET_ANONYMIZED', 'The target is anonymized');
    }
    if (
      !(await markReportResolved(tx, reportId, {
        decision: input.decision,
        administratorId: admin.administratorId,
      }))
    ) {
      throw httpError(409, 'ALREADY_RESOLVED', 'The report is already resolved');
    }

    if (input.decision === 'DISMISSED') {
      await recordAdminAction(tx, {
        administratorId: admin.administratorId,
        action: 'DISMISS_REPORT',
        targetPersonId: report.targetPersonId,
        targetOrganizationId: report.targetOrganizationId,
        reportId,
        reason: input.reason,
      });
    } else if (report.targetPersonId !== null) {
      await suspendPersonRow(tx, report.targetPersonId);
      await revokeSessions(report.targetPersonId, 'ACCOUNT_SUSPENDED', { tx });
      await recordAdminAction(tx, {
        administratorId: admin.administratorId,
        action: 'SUSPEND',
        targetPersonId: report.targetPersonId,
        reportId,
        reason: input.reason,
      });
      const language = await recipientLanguage(report.targetPersonId, tx);
      await notify(
        {
          recipientId: report.targetPersonId,
          sourceEvent: 'account.suspended',
          content: SUSPENDED_CONTENT[language],
          related: { type: 'report', id: reportId },
        },
        tx
      );
    } else if (report.targetOrganizationId !== null && report.targetOrganization) {
      const organizationId = report.targetOrganizationId;
      await suspendOrganizationRow(tx, organizationId);
      await recordAdminAction(tx, {
        administratorId: admin.administratorId,
        action: 'SUSPEND',
        targetOrganizationId: organizationId,
        reportId,
        reason: input.reason,
      });
      const ownerId = await findActiveOwnerId(tx, organizationId);
      if (ownerId !== null) {
        const language = await recipientLanguage(ownerId, tx);
        await notify(
          {
            recipientId: ownerId,
            organizationId,
            sourceEvent: 'account.suspended',
            content: ORG_SUSPENDED_CONTENT[language](report.targetOrganization.name),
            related: { type: 'report', id: reportId },
          },
          tx
        );
      }
    } else {
      throw new Error('Report has no target (C-28)');
    }

    const updated = await findReportRowTx(tx, reportId);
    if (!updated) throw httpError(404, 'NOT_FOUND', 'Report not found');
    return updated;
  });
  logger.info(
    {
      event: 'report_resolved',
      administratorId: admin.administratorId,
      reportId,
      decision: input.decision,
    },
    'Report resolved'
  );
  return toAdminReportView(row);
}

const PERSON_NOTICE = {
  suspend: {
    event: 'account.suspended',
    FR: 'Votre compte a été suspendu par un modérateur.',
    EN: 'Your account has been suspended by a moderator.',
  },
  reactivate: {
    event: 'account.reactivated',
    FR: 'Votre compte a été réactivé par un modérateur.',
    EN: 'Your account has been reactivated by a moderator.',
  },
};
const ORG_NOTICE = {
  suspend: {
    event: 'account.suspended',
    FR: (name: string) => `L\u2019organisation ${name} a été suspendue par un modérateur.`,
    EN: (name: string) => `The organization ${name} has been suspended by a moderator.`,
  },
  reactivate: {
    event: 'account.reactivated',
    FR: (name: string) => `L\u2019organisation ${name} a été réactivée par un modérateur.`,
    EN: (name: string) => `The organization ${name} has been reactivated by a moderator.`,
  },
};

async function changePersonStatus(
  admin: AdminContext,
  personId: string,
  input: ModerationReasonInput,
  verb: 'suspend' | 'reactivate'
): Promise<void> {
  const suspending = verb === 'suspend';
  await inTransaction(async (tx) => {
    const status = await findPersonStatus(tx, personId);
    if (status === null) throw httpError(404, 'NOT_FOUND', 'Person not found');
    if (status === 'ANONYMIZED')
      throw httpError(409, 'TARGET_ANONYMIZED', 'The target is anonymized');
    const changed = await transitionPersonStatus(tx, personId, {
      from: suspending ? 'ACTIVE' : 'SUSPENDED',
      to: suspending ? 'SUSPENDED' : 'ACTIVE',
      bumpScope: suspending,
    });
    if (!changed) {
      throw httpError(
        409,
        'INVALID_STATE',
        suspending ? 'The person is already suspended' : 'The person is not suspended'
      );
    }
    if (suspending) await revokeSessions(personId, 'ACCOUNT_SUSPENDED', { tx });
    await recordAdminAction(tx, {
      administratorId: admin.administratorId,
      action: suspending ? 'SUSPEND' : 'REACTIVATE',
      targetPersonId: personId,
      reason: input.reason,
    });
    const notice = PERSON_NOTICE[verb];
    const language = await recipientLanguage(personId, tx);
    await notify(
      { recipientId: personId, sourceEvent: notice.event, content: notice[language] },
      tx
    );
  });
  logger.info(
    {
      event: suspending ? 'person_suspended' : 'person_reactivated',
      administratorId: admin.administratorId,
      targetPersonId: personId,
    },
    suspending ? 'Person suspended' : 'Person reactivated'
  );
}

async function changeOrganizationStatus(
  admin: AdminContext,
  organizationId: string,
  input: ModerationReasonInput,
  verb: 'suspend' | 'reactivate'
): Promise<void> {
  const suspending = verb === 'suspend';
  await inTransaction(async (tx) => {
    const organization = await findOrganizationForModeration(tx, organizationId);
    if (!organization) throw httpError(404, 'NOT_FOUND', 'Organization not found');
    const changed = await transitionOrganizationStatus(tx, organizationId, {
      from: suspending ? 'ACTIVE' : 'SUSPENDED',
      to: suspending ? 'SUSPENDED' : 'ACTIVE',
    });
    if (!changed) {
      throw httpError(
        409,
        'INVALID_STATE',
        suspending ? 'The organization cannot be suspended' : 'The organization is not suspended'
      );
    }
    await recordAdminAction(tx, {
      administratorId: admin.administratorId,
      action: suspending ? 'SUSPEND' : 'REACTIVATE',
      targetOrganizationId: organizationId,
      reason: input.reason,
    });
    const ownerId = await findActiveOwnerId(tx, organizationId);
    if (ownerId !== null) {
      const notice = ORG_NOTICE[verb];
      const language = await recipientLanguage(ownerId, tx);
      await notify(
        {
          recipientId: ownerId,
          organizationId,
          sourceEvent: notice.event,
          content: notice[language](organization.name),
        },
        tx
      );
    }
  });
  logger.info(
    {
      event: suspending ? 'organization_suspended' : 'organization_reactivated',
      administratorId: admin.administratorId,
      targetOrganizationId: organizationId,
    },
    suspending ? 'Organization suspended' : 'Organization reactivated'
  );
}

/**
 * Suspends an ACTIVE person without a report (CM-33; v5.0.0-8.2.1: the route only lets live
 * moderators in). Status, `scope_version`, every session (reason ACCOUNT_SUSPENDED, v5.0.0-7.4.2),
 * the `SUSPEND` journal row (no report) and the notice are one transaction (v5.0.0-16.3.1). The
 * status change is conditional on ACTIVE, so of two parallel requests one gets 409 (CWE-362).
 *
 * @throws 404 NOT_FOUND; 409 TARGET_ANONYMIZED; 409 INVALID_STATE when not ACTIVE
 */
export function suspendPerson(
  admin: AdminContext,
  personId: string,
  input: ModerationReasonInput
): Promise<void> {
  return changePersonStatus(admin, personId, input, 'suspend');
}

/**
 * Returns a SUSPENDED person to ACTIVE, with a `REACTIVATE` journal row and a notice in one
 * transaction. The person can then pass the login status check again.
 *
 * @throws 404 NOT_FOUND; 409 TARGET_ANONYMIZED; 409 INVALID_STATE when not SUSPENDED
 */
export function reactivatePerson(
  admin: AdminContext,
  personId: string,
  input: ModerationReasonInput
): Promise<void> {
  return changePersonStatus(admin, personId, input, 'reactivate');
}

/**
 * Suspends an ACTIVE organization without a report (CM-33), with a `SUSPEND` journal row and a
 * notice to its owner in one transaction. A CLOSED organization is refused too, so a closure
 * cannot be turned into a suspension that a later reactivation would undo.
 *
 * @throws 404 NOT_FOUND; 409 INVALID_STATE when not ACTIVE
 */
export function suspendOrganization(
  admin: AdminContext,
  organizationId: string,
  input: ModerationReasonInput
): Promise<void> {
  return changeOrganizationStatus(admin, organizationId, input, 'suspend');
}

/**
 * Returns a SUSPENDED organization to ACTIVE, with a `REACTIVATE` journal row and a notice to
 * its owner. An organization CLOSED by its owner stays closed: only the owner reopens it.
 *
 * @throws 404 NOT_FOUND; 409 INVALID_STATE when not SUSPENDED
 */
export function reactivateOrganization(
  admin: AdminContext,
  organizationId: string,
  input: ModerationReasonInput
): Promise<void> {
  return changeOrganizationStatus(admin, organizationId, input, 'reactivate');
}

const PHONE_RELEASED_NOTICE = {
  FR: 'Le support a libéré votre numéro. Ajoutez votre nouveau numéro pour continuer.',
  EN: 'Support has released your number. Add your new number to keep using the app.',
};

/**
 * Releases the active number of a person on behalf of support (CM-41, CM-04, C-29;
 * v5.0.0-8.2.1: the route only lets SUPER_ADMIN in). The release (and the phone-released
 * handlers), the `RELEASE_PHONE` journal row (caller as author, the person as target, the
 * reason) and the `admin.phone_released` notice are one transaction, so a failed handler,
 * journal insert or notice leaves the number in place (v5.0.0-16.3.1). Sessions are kept.
 * The log holds ids only, never the number.
 *
 * @throws 404 NOT_FOUND; 409 TARGET_ANONYMIZED; 409 NO_ACTIVE_NUMBER (guest, or number already released)
 */
export async function releasePhone(
  admin: AdminContext,
  personId: string,
  input: ModerationReasonInput
): Promise<void> {
  await inTransaction(async (tx) => {
    const status = await findPersonStatus(tx, personId);
    if (status === null) throw httpError(404, 'NOT_FOUND', 'Person not found');
    if (status === 'ANONYMIZED') {
      throw httpError(409, 'TARGET_ANONYMIZED', 'The target is anonymized');
    }
    if ((await releaseNumberOfPerson(tx, personId)) === null) {
      throw httpError(409, 'NO_ACTIVE_NUMBER', 'The person has no active number');
    }
    await recordAdminAction(tx, {
      administratorId: admin.administratorId,
      action: 'RELEASE_PHONE',
      targetPersonId: personId,
      reason: input.reason,
    });
    const language = await recipientLanguage(personId, tx);
    await notify(
      {
        recipientId: personId,
        sourceEvent: 'admin.phone_released',
        content: PHONE_RELEASED_NOTICE[language],
      },
      tx
    );
  });
  logger.warn(
    {
      event: 'phone_released_by_support',
      administratorId: admin.administratorId,
      targetPersonId: personId,
    },
    'Phone number released by support'
  );
}

/** One journal row as administrators see it: ids, kind, reason and time, nothing else. */
export interface AdminActionView {
  id: string;
  administrator_id: string;
  action: string;
  target_person_id: string | null;
  target_organization_id: string | null;
  report_id: string | null;
  sync_archive_id: string | null;
  reason: string;
  occurred_at: string;
}

/**
 * Lists the administration journal, newest first (v5.0.0-16.3.3: readable for audit). The
 * route only lets live administrators in (v5.0.0-8.2.1). The view is built field by field.
 */
export async function listAdminActions(
  query: ListActionsQuery
): Promise<{ items: AdminActionView[]; next_cursor: string | null }> {
  const { rows, nextCursor } = await listAdminActionRows(query);
  return {
    items: rows.map((row) => ({
      id: row.id,
      administrator_id: row.administratorId,
      action: row.action,
      target_person_id: row.targetPersonId,
      target_organization_id: row.targetOrganizationId,
      report_id: row.reportId,
      sync_archive_id: row.syncArchiveId,
      reason: row.reason,
      occurred_at: row.occurredAt.toISOString(),
    })),
    next_cursor: nextCursor,
  };
}
