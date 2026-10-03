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
 *
 * @returns The registered person, or null when a registered holder already exists.
 */
export async function completeRegistration(
  tx: Prisma.TransactionClient,
  input: { phone: string; fullName: string; passwordHash: string }
): Promise<Person | null> {
  const holder = await findOrCreateByPhone(input.phone, tx);
  const now = new Date();
  const r = await tx.person.updateMany({
    where: { id: holder.id, registeredAt: null },
    data: {
      fullName: input.fullName,
      passwordHash: input.passwordHash,
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
