import { config } from '../../config/index.js';
import { httpError, type HttpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { checkAndConsume, resetKey } from '../../lib/rate-limit.js';
import { revokeSessions } from '../auth/session.service.js';
import {
  anonymizeRows,
  findDebtSupplierNames,
  findDeletionIdentity,
  findOwnedOrganizationNames,
  inTransaction,
} from './privacy.repository.js';
import type { DeleteAccountInput, DeletionCheck } from './privacy.schemas.js';

/** Same limit as the login counter: five failures lock the number (v5.0.0-6.3.1). */
const MAX_PASSWORD_FAILURES = 5;
let dummyHash: Promise<string> | undefined;
/** Fixed hash used when no hash exists, so every failing case costs one verification. */
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  return dummyHash;
}

/** 409 DELETION_BLOCKED error; carries the blockers so the route can return them. */
export type DeletionBlockedError = HttpError & { blockers: DeletionCheck['blockers'] };

/** Type guard used by the route to answer 409 with the blockers. */
export function isDeletionBlocked(err: unknown): err is DeletionBlockedError {
  return err instanceof Error && 'code' in err && err.code === 'DELETION_BLOCKED';
}

/**
 * Lists what blocks the deletion of the caller's account (CM-02): a positive balance as a
 * customer, or ownership of an ACTIVE or SUSPENDED organization. Fails closed: if either
 * query throws, no answer is given, so a person is never told they may delete.
 *
 * @param personId - The caller, from the token only.
 */
export async function deletionCheck(personId: string): Promise<DeletionCheck> {
  const [debtors, owned] = await Promise.all([
    findDebtSupplierNames(personId),
    findOwnedOrganizationNames(personId),
  ]);
  const blockers = [
    ...debtors.map((label) => ({ code: 'POSITIVE_BALANCE' as const, label })),
    ...owned.map((label) => ({ code: 'OWNS_ORGANIZATION' as const, label })),
  ];
  return { can_delete: blockers.length === 0, blockers };
}

/**
 * Anonymizes the person in one transaction (CM-01, C-02, C-03, v5.0.0-14.2.4): personal
 * columns and dependent rows are erased, the number is released, collaborations are
 * revoked and every session ends (v5.0.0-7.4.2). Any failing step rolls everything back.
 * Sessions end with reason LOGOUT_ALL: no dedicated reason exists and none is worth a migration.
 * Does not check blockers or the password: callers must (see `deleteAccount`).
 *
 * @throws httpError 404 NOT_FOUND when the person is absent or already anonymized
 */
export async function anonymizePerson(personId: string): Promise<void> {
  await inTransaction(async (tx) => {
    if (!(await anonymizeRows(tx, personId))) {
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }
    await revokeSessions(personId, 'LOGOUT_ALL', { tx });
  });
  logger.info({ event: 'account_anonymized', personId }, 'Account anonymized');
}

/**
 * Deletes the caller's account (v5.0.0-6.2.3): the password is checked first, counted on
 * the same counter as login for the person's number, then blockers are checked (CM-02),
 * then the person is anonymized. A wrong password never reveals the blockers.
 *
 * @param personId - The caller, from the token only.
 * @throws 401 INVALID_CREDENTIALS; 409 DELETION_BLOCKED; 429 LOGIN_LOCKED
 */
export async function deleteAccount(personId: string, input: DeleteAccountInput): Promise<void> {
  const identity = await findDeletionIdentity(personId);
  if (!identity) throw httpError(404, 'NOT_FOUND', 'Not found');

  const key = `login:fail:${identity.phoneNumber}`;
  const slot = await checkAndConsume(key, MAX_PASSWORD_FAILURES, config.auth.loginLockMinutes * 60);
  if (!slot.allowed) {
    logger.warn({ event: 'account_deletion_locked', personId }, 'Attempts locked');
    throw httpError(429, 'LOGIN_LOCKED', 'Too many failed attempts');
  }
  const ok = await verifyPassword(identity.passwordHash ?? (await getDummyHash()), input.password);
  if (!ok || identity.passwordHash === null) {
    logger.warn({ event: 'account_deletion_failed', personId }, 'Account deletion refused');
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }
  await resetKey(key);

  const { blockers } = await deletionCheck(personId);
  if (blockers.length > 0) {
    throw Object.assign(httpError(409, 'DELETION_BLOCKED', 'Account deletion is blocked'), {
      blockers,
    });
  }
  await anonymizePerson(personId);
}
