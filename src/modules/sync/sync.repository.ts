import type { CollaborationRole, Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';

/** Reads a person's scope version and ACTIVE memberships; null when the person does not exist. */
export async function findViewerData(personId: string): Promise<{
  scopeVersion: number;
  memberships: Array<{ organizationId: string; role: CollaborationRole }>;
} | null> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      scopeVersion: true,
      collaborations: {
        where: { status: 'ACTIVE', deletedAt: null },
        select: { organizationId: true, role: true },
      },
    },
  });
  return person ? { scopeVersion: person.scopeVersion, memberships: person.collaborations } : null;
}

/**
 * Runs the reads of one pull on a single snapshot, so every table of the response agrees with the
 * others (REPEATABLE READ).
 */
export async function withPullSnapshot<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(work, { isolationLevel: 'RepeatableRead' });
}
