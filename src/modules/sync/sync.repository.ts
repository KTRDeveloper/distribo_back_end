import type { CollaborationRole } from '@prisma/client';
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
