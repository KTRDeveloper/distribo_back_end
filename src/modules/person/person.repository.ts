import { Prisma, type Person } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { imageUrl } from '../../lib/image-keys.js';
import { newId } from '../../shared/ids.js';

export type PublicPerson = {
  public_name: string | null;
  phone_number: string | null;
  registered: boolean;
  avatar_url: string | null;
};

/**
 * Finds the person currently assigned the normalized phone number.
 *
 * @param e164 - A normalized E.164 phone number.
 * @returns The active owner, or null when the number is absent or released.
 */
export async function findByActivePhone(e164: string): Promise<Person | null> {
  return prisma.person.findFirst({
    where: {
      phoneNumber: e164,
    },
  });
}

/**
 * Finds a person by verified email, case-insensitively (AUTH-015).
 *
 * @param email - The email as typed; unverified emails never match.
 */
export async function findByVerifiedEmail(email: string): Promise<Person | null> {
  return prisma.person.findFirst({
    where: { email: { equals: email.trim(), mode: 'insensitive' }, emailVerifiedAt: { not: null } },
  });
}

/**
 * Returns the active owner of a number, creating an unregistered guest if needed.
 * The conflict-safe insert keeps concurrent callers from creating duplicate identities.
 *
 * @param e164 - A normalized E.164 phone number.
 * @param tx - Optional transaction that must contain both the insert and lookup.
 * @returns The existing or newly created person.
 */
export async function findOrCreateByPhone(
  e164: string,
  tx?: Prisma.TransactionClient
): Promise<Person> {
  const client = tx ?? prisma;

  await client.$executeRaw`
    INSERT INTO "people" (
      "id",
      "phone_number",
      "created_at",
      "server_updated_at"
    )
    VALUES (${newId()}::uuid, ${e164}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT DO NOTHING
  `;

  return client.person.findFirstOrThrow({
    where: {
      phoneNumber: e164,
    },
  });
}

/**
 * Builds the closed-list person view permitted outside the identity boundary (CM-20).
 * Four explicit fields only (ASVS v5.0.0-8.2.3); the photo is exposed as an address
 * built by `imageUrl`, never as the stored key.
 */
export function toPublicPerson(person: Person): PublicPerson {
  return {
    public_name: person.fullName,
    phone_number: person.phoneNumber,
    registered: person.registeredAt !== null,
    avatar_url: imageUrl(person.avatarKey),
  };
}

/**
 * Invalidates cached authorization scope by atomically advancing its version.
 *
 * @param personId - Person whose effective rights changed.
 * @param tx - Optional transaction containing the rights change.
 * @returns The newly persisted scope version.
 */
export async function bumpScopeVersion(
  personId: string,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const client = tx ?? prisma;
  const person = await client.person.update({
    where: { id: personId },
    data: { scopeVersion: { increment: 1 } },
    select: { scopeVersion: true },
  });

  return person.scopeVersion;
}
