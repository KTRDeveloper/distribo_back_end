import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';

/**
 * Relationships where the person is the customer and still owes money (balance above 0).
 * Filters on the person id from the token (ASVS v5.0.0-8.2.2).
 *
 * @returns The supplier names to show; a supplier without a name yields an empty string.
 */
export async function findDebtSupplierNames(personId: string): Promise<string[]> {
  const rows = await prisma.customerRelationship.findMany({
    where: { customerPersonId: personId, balance: { gt: 0n }, deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      supplierLabel: true,
      supplierOrganization: { select: { name: true } },
      supplierPerson: { select: { fullName: true } },
    },
  });
  return rows.map(
    (row) =>
      row.supplierOrganization?.name ?? row.supplierPerson?.fullName ?? row.supplierLabel ?? ''
  );
}

/**
 * Names of the ACTIVE or SUSPENDED organizations the person owns through an active OWNER
 * membership. CLOSED or deleted organizations and other roles never appear.
 */
export async function findOwnedOrganizationNames(personId: string): Promise<string[]> {
  const rows = await prisma.collaboration.findMany({
    where: {
      personId,
      role: 'OWNER',
      status: 'ACTIVE',
      deletedAt: null,
      organization: { status: { in: ['ACTIVE', 'SUSPENDED'] }, deletedAt: null },
    },
    orderBy: [{ invitedAt: 'asc' }, { id: 'asc' }],
    select: { organization: { select: { name: true } } },
  });
  return rows.map((row) => row.organization.name);
}

/** Runs `fn` in one database transaction: everything inside commits together or not at all. */
export function inTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}

/** What the deletion needs to know about the caller: the number to check against and the hash. */
export async function findDeletionIdentity(
  personId: string
): Promise<{ phoneNumber: string; passwordHash: string | null } | null> {
  const row = await prisma.person.findFirst({
    where: { id: personId, status: { not: 'ANONYMIZED' }, phoneNumber: { not: null } },
    select: { phoneNumber: true, passwordHash: true, registeredAt: true },
  });
  if (!row?.phoneNumber || !row.registeredAt) return null;
  return { phoneNumber: row.phoneNumber, passwordHash: row.passwordHash };
}

/**
 * Erases the person's personal columns and dependent rows inside the caller's transaction
 * (CM-01, C-02, C-03). Relationships, orders, ledger entries and journals are not touched.
 * Collaborations are ended (REVOKED, no public contact); their held amount stays.
 *
 * @returns false when the person is absent or already anonymized (nothing was changed).
 */
export async function anonymizeRows(
  tx: Prisma.TransactionClient,
  personId: string
): Promise<boolean> {
  const person = await tx.person.findFirst({
    where: { id: personId, status: { not: 'ANONYMIZED' } },
    select: { phoneNumber: true, releasedPhoneNumber: true, email: true },
  });
  if (!person) return false;

  const now = new Date();
  await tx.collaboration.updateMany({
    where: { personId, status: { in: ['ACTIVE', 'INVITED'] } },
    data: { status: 'REVOKED', isPublicContact: false },
  });
  await tx.notification.deleteMany({ where: { recipientId: personId } });
  const targets = [person.phoneNumber, person.releasedPhoneNumber, person.email].filter(
    (t): t is string => t !== null
  );
  await tx.otpChallenge.deleteMany({
    where: { OR: [{ personId }, ...(targets.length > 0 ? [{ target: { in: targets } }] : [])] },
  });
  await tx.device.updateMany({ where: { personId }, data: { pushToken: null } });
  await tx.task.deleteMany({ where: { accountId: personId } });

  const done = await tx.person.updateMany({
    where: { id: personId, status: { not: 'ANONYMIZED' } },
    data: {
      fullName: null,
      email: null,
      emailVerifiedAt: null,
      preferredLanguage: null,
      passwordHash: null,
      phoneNumber: null,
      phoneVerifiedAt: null,
      releasedPhoneNumber: person.phoneNumber ?? person.releasedPhoneNumber,
      status: 'ANONYMIZED',
      anonymizedAt: now,
      scopeVersion: { increment: 1 },
      serverUpdatedAt: now,
    },
  });
  return done.count === 1;
}
