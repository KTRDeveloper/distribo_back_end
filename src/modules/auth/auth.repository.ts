import type { Person, Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { findOrCreateByPhone } from '../person/person.repository.js';

/** Runs `fn` in one transaction so person and session writes succeed or fail together. */
export function inTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}

/**
 * Turns the (new or guest) holder of a number into a registered person (C-03).
 * The guarded update (`registered_at IS NULL`) makes the loser of a race see null.
 * `preferredLanguage` is written only when given, so an absent value leaves the column as it was.
 *
 * @returns The registered person, or null when a registered holder already exists.
 */
export async function completeRegistration(
  tx: Prisma.TransactionClient,
  input: {
    phone: string;
    fullName: string;
    passwordHash: string;
    preferredLanguage?: 'FR' | 'EN';
  }
): Promise<Person | null> {
  const holder = await findOrCreateByPhone(input.phone, tx);
  const now = new Date();
  const r = await tx.person.updateMany({
    where: { id: holder.id, registeredAt: null },
    data: {
      fullName: input.fullName,
      passwordHash: input.passwordHash,
      ...(input.preferredLanguage ? { preferredLanguage: input.preferredLanguage } : {}),
      registeredAt: now,
      phoneVerifiedAt: now,
      serverUpdatedAt: now,
    },
  });
  if (r.count !== 1) return null;
  return tx.person.findUniqueOrThrow({ where: { id: holder.id } });
}

/**
 * Releases the registered holder of a number (CM-04): the number moves to
 * `released_phone_number`, verification is cleared and `scope_version` is bumped (CM-03).
 * Name, relations and sessions stay untouched.
 *
 * @returns The released person's id, email and verification state, or null when nobody registered holds it.
 */
export async function releaseRegisteredHolder(
  tx: Prisma.TransactionClient,
  phone: string
): Promise<{ id: string; email: string | null; emailVerified: boolean } | null> {
  const holder = await tx.person.findFirst({
    where: { phoneNumber: phone, registeredAt: { not: null } },
  });
  if (!holder) return null;
  await tx.person.update({
    where: { id: holder.id },
    data: {
      phoneNumber: null,
      releasedPhoneNumber: phone,
      phoneVerifiedAt: null,
      scopeVersion: { increment: 1 },
      serverUpdatedAt: new Date(),
    },
  });
  return {
    id: holder.id,
    email: holder.email,
    emailVerified: holder.emailVerifiedAt !== null,
  };
}

/** Reads the saved email and its verification state for a person id (the target never comes from the request). */
export function findEmailState(
  personId: string
): Promise<{ email: string | null; emailVerifiedAt: Date | null } | null> {
  return prisma.person.findUnique({
    where: { id: personId },
    select: { email: true, emailVerifiedAt: true },
  });
}

/** Lists the ids of a person's live (not revoked) devices. */
export async function listLiveDeviceIds(
  tx: Prisma.TransactionClient,
  personId: string
): Promise<string[]> {
  const rows = await tx.device.findMany({
    where: { personId, revokedAt: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** True when another person already holds this verified email (PER-003). */
export async function isEmailVerifiedByOther(email: string, personId: string): Promise<boolean> {
  const n = await prisma.person.count({
    where: { email, emailVerifiedAt: { not: null }, id: { not: personId } },
  });
  return n > 0;
}

/**
 * Marks the saved email verified only if it still equals `email`.
 *
 * @returns false when the address changed meanwhile; throws P2002 if the unique index is hit.
 */
export async function markEmailVerified(personId: string, email: string): Promise<boolean> {
  const now = new Date();
  const r = await prisma.person.updateMany({
    where: { id: personId, email },
    data: { emailVerifiedAt: now, serverUpdatedAt: now },
  });
  return r.count === 1;
}

/**
 * Moves a person to a new verified number and journals the change (C-02, CM-04, C-32).
 * Call inside one transaction so the journal row and the update stand or fall together.
 * The person row is locked first; a unique violation (P2002) means another person won the number.
 *
 * @returns false when the person does not exist or has no current or released number.
 */
export async function movePhoneNumber(
  tx: Prisma.TransactionClient,
  personId: string,
  newPhone: string,
  logId: string
): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM people WHERE id = ${personId}::uuid FOR UPDATE`;
  const person = await tx.person.findUnique({ where: { id: personId } });
  const old = person?.phoneNumber ?? person?.releasedPhoneNumber;
  if (!person || !old) return false;
  const now = new Date();
  await tx.person.update({
    where: { id: personId },
    data: {
      phoneNumber: newPhone,
      releasedPhoneNumber: null,
      phoneVerifiedAt: now,
      serverUpdatedAt: now,
    },
  });
  await tx.phoneNumberChangeLog.create({
    data: {
      id: logId,
      personId,
      oldPhoneNumber: old,
      newPhoneNumber: newPhone,
      verifiedAt: now,
      changedAt: now,
    },
  });
  return true;
}

/**
 * Stores a new password hash for a registered person (C-03); false when none matched.
 * Pass `tx` to write in the caller's transaction.
 */
export async function updatePasswordHash(
  personId: string,
  passwordHash: string,
  client: Prisma.TransactionClient = prisma
): Promise<boolean> {
  const now = new Date();
  const r = await client.person.updateMany({
    where: { id: personId, registeredAt: { not: null } },
    data: { passwordHash, serverUpdatedAt: now },
  });
  return r.count === 1;
}

/** Current password hash of a registered person, or null. */
export async function findPasswordHash(personId: string): Promise<string | null> {
  const p = await prisma.person.findUnique({
    where: { id: personId },
    select: { passwordHash: true, registeredAt: true },
  });
  return p?.registeredAt ? p.passwordHash : null;
}
