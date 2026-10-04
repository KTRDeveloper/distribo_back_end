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

/**
 * True when the person's device is revoked. A device row that does not exist counts as not
 * revoked: the lookup filters on the person as well, so another person's device is never read.
 */
export async function isDeviceRevoked(personId: string, deviceId: string): Promise<boolean> {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, personId },
    select: { revokedAt: true },
  });
  return device?.revokedAt != null;
}

/**
 * Records a pull on the person's live device: `last_synced_at` is server time, and
 * `scope_version_seen` is written only when `scopeVersionSeen` is given. The update filters on
 * person and device together and skips revoked devices (C-34).
 */
export async function markDevicePulled(
  personId: string,
  deviceId: string,
  scopeVersionSeen: number | null
): Promise<void> {
  await prisma.device.updateMany({
    where: { id: deviceId, personId, revokedAt: null },
    data: {
      lastSyncedAt: new Date(),
      ...(scopeVersionSeen === null ? {} : { scopeVersionSeen }),
    },
  });
}
