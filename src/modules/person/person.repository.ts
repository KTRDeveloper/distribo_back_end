import { Prisma, type Person } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { httpError } from '../../lib/http-error.js';
import { imageKeySchema, imageUrl } from '../../lib/image-keys.js';
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

/**
 * The one writer of `Person.avatar_key` (C-49, ASVS v5.0.0-15.3.3): sets, replaces or clears
 * (`null`) the profile photo key and returns the previous key, so the images module can delete
 * the old file after its commit.
 *
 * The person row is locked before the previous key is read, so two concurrent writers never
 * return the same previous key (v5.0.0-2.2.3). Without `tx` it opens its own transaction.
 * A guest or an anonymized person cannot hold a key: the database CHECK error is not caught.
 *
 * @param personId - Person whose photo key changes.
 * @param key - Canonical `avatars/<uuid>.webp` key, or null to clear.
 * @param tx - Optional caller transaction; the write commits or rolls back with it.
 * @returns The previous key, or null when there was none.
 * @throws {RangeError} when the key is not canonical or not in the `avatars` folder.
 * @throws {HttpError} 404 `NOT_FOUND` when the person does not exist.
 */
export async function setAvatarKey(
  personId: string,
  key: string | null,
  tx?: Prisma.TransactionClient
): Promise<string | null> {
  if (key !== null && (!imageKeySchema.safeParse(key).success || !key.startsWith('avatars/'))) {
    throw new RangeError('Invalid avatar key');
  }

  const run = async (client: Prisma.TransactionClient): Promise<string | null> => {
    const rows = await client.$queryRaw<{ avatar_key: string | null }[]>`
      SELECT "avatar_key" FROM "people" WHERE "id" = ${personId}::uuid FOR UPDATE
    `;
    if (rows.length === 0) throw httpError(404, 'NOT_FOUND', 'Not found');

    await client.person.update({ where: { id: personId }, data: { avatarKey: key } });
    return rows[0].avatar_key;
  };

  return tx ? run(tx) : prisma.$transaction(run);
}
