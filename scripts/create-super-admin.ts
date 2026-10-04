import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/db.js';
import { createTotpSecret, encryptSecret } from '../src/lib/totp.js';
import { normalizeE164 } from '../src/shared/phone.js';
import {
  findRegisteredPersonIdByPhone,
  hasLiveSuperAdmin,
  insertSuperAdministrator,
  lockSuperAdminBootstrap,
  recordAdminAction,
} from '../src/modules/admin/admin.repository.js';

/**
 * Creates the first SUPER_ADMIN of the platform (v5.0.0-6.3.2: no default account, the first
 * one is explicit). Refuses, creating nothing, when the number is invalid, the person is not
 * registered, or a live SUPER_ADMIN already exists. Everything runs in one transaction under an
 * advisory lock, so two concurrent runs cannot both succeed. The secret is stored encrypted and
 * only returned in the `otpauth://` URI, for the caller to show once (v5.0.0-13.3.2). The error
 * messages say nothing about which person exists.
 *
 * @param phoneNumber - Phone number of an already registered person.
 * @returns The new administrator id and the enrolment URI (contains the plaintext secret).
 * @throws If the number is invalid, not a registered person, or a SUPER_ADMIN already exists.
 */
export async function createFirstSuperAdmin(
  phoneNumber: string
): Promise<{ administratorId: string; otpauthUri: string }> {
  const e164 = normalizeE164(phoneNumber);
  if (!e164) throw new Error('Invalid phone number');

  return prisma.$transaction(async (tx) => {
    await lockSuperAdminBootstrap(tx);
    if (await hasLiveSuperAdmin(tx)) {
      throw new Error('A super administrator already exists');
    }
    const personId = await findRegisteredPersonIdByPhone(tx, e164);
    if (!personId) throw new Error('No registered person for this phone number');

    const { secret, otpauthUri } = createTotpSecret();
    const administratorId = await insertSuperAdministrator(tx, personId, encryptSecret(secret));
    await recordAdminAction(tx, {
      administratorId,
      action: 'APPOINT_ADMIN',
      targetPersonId: personId,
      reason: 'bootstrap',
    });
    return { administratorId, otpauthUri };
  });
}

async function main(): Promise<void> {
  const phone = process.argv[2];
  if (!phone || process.argv.length > 3) {
    process.stderr.write('Usage: npm run admin:create-super -- <phone_number>\n');
    process.exitCode = 2;
    return;
  }
  try {
    const { administratorId, otpauthUri } = await createFirstSuperAdmin(phone);
    process.stdout.write(`Super administrator created: ${administratorId}\n`);
    process.stdout.write('Scan this URI in an authenticator app. It is shown only once:\n');
    process.stdout.write(`${otpauthUri}\n`);
  } catch (error) {
    process.stderr.write(`Refused: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly, not when a test imports createFirstSuperAdmin.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
  // The Redis client pulled in by the totp module would keep the process alive.
  process.exit(process.exitCode ?? 0);
}
