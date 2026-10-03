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
