import { Prisma, type Person } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { newId } from '../../shared/ids.js';

export type PublicPerson = {
  public_name: string | null;
  phone_number: string | null;
  registered: boolean;
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

/** Builds the closed-list person view permitted outside the identity boundary. */
export function toPublicPerson(person: Person): PublicPerson {
  return {
    public_name: person.fullName,
    phone_number: person.phoneNumber,
    registered: person.registeredAt !== null,
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
