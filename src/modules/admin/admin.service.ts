import { config } from '../../config/index.js';
import { httpError } from '../../lib/http-error.js';
import { ADMIN_TOKEN_EXPIRES_IN_SECONDS, signAdminToken } from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { checkAndConsume, resetKey } from '../../lib/rate-limit.js';
import { decryptSecret, verifyTotp } from '../../lib/totp.js';
import { normalizeE164 } from '../../shared/phone.js';
import { findByActivePhone } from '../person/person.repository.js';
import { findLiveAdministratorByPerson } from './admin.repository.js';
import type { AdminLoginInput } from './admin.schemas.js';

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
