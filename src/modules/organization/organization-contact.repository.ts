import { Prisma, type OrganizationContact } from '@prisma/client';
import { prisma } from '../../lib/db.js';

/** The two live-row conflicts a new phone contact can meet in its business (C-43). */
export type ContactConflict = 'SLOT_TAKEN' | 'ALREADY_EXISTS' | null;

/**
 * Looks for a live contact (not deleted) of the business that already holds this number or this
 * slot. A number already listed wins over a taken slot. Pending contacts count too (C-43).
 *
 * @param organizationId - Organization from the loaded actor.
 * @param tx - Transaction of the gesture; omit it to read the committed state.
 */
export async function findContactConflict(
  organizationId: string,
  slot: number,
  value: string,
  tx?: Prisma.TransactionClient
): Promise<ContactConflict> {
  const client = tx ?? prisma;
  const live = await client.organizationContact.findMany({
    where: { organizationId, deletedAt: null, OR: [{ value }, { slot }] },
    select: { slot: true, value: true },
  });
  if (live.some((row) => row.value === value)) return 'ALREADY_EXISTS';
  if (live.some((row) => row.slot === slot)) return 'SLOT_TAKEN';
  return null;
}

/** Inserts a PHONE contact; the database has the last word on the uniqueness rules (C-43). */
export function insertPhoneContact(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    organizationId: string;
    slot: number;
    value: string;
    createdById: string;
    verified: boolean;
  }
): Promise<OrganizationContact> {
  return tx.organizationContact.create({
    data: {
      id: data.id,
      organizationId: data.organizationId,
      kind: 'PHONE',
      slot: data.slot,
      value: data.value,
      createdById: data.createdById,
      ...(data.verified ? { verifiedAt: new Date(), verificationMethod: 'OWNER_PHONE' } : {}),
    },
  });
}

/** The stored shape of a contact. */
export type ContactRow = OrganizationContact;

/**
 * Reads a live (not deleted) contact of the business; a contact of another business is not
 * found, so its existence is never confirmed (ASVS v5.0.0-8.2.1).
 */
export function findLiveContact(
  contactId: string,
  organizationId: string
): Promise<ContactRow | null> {
  return prisma.organizationContact.findFirst({
    where: { id: contactId, organizationId, deletedAt: null },
  });
}

/**
 * Marks a contact verified by code with one guarded UPDATE: it changes a row only while the
 * contact is still pending and live in this business, so two parallel confirmations cannot
 * both write (C-44). Returns null when no row changed.
 *
 * @param now - Server time stored as `verified_at`.
 */
export async function markContactVerified(
  contactId: string,
  organizationId: string,
  now: Date
): Promise<ContactRow | null> {
  const result = await prisma.organizationContact.updateMany({
    where: { id: contactId, organizationId, deletedAt: null, verifiedAt: null },
    data: { verifiedAt: now, verificationMethod: 'CODE' },
  });
  if (result.count !== 1) return null;
  return findLiveContact(contactId, organizationId);
}

/**
 * Soft-deletes a contact with one guarded UPDATE: it changes a row only while the contact is
 * still live and of this business, so a second delete, a contact of another business and two
 * parallel deletes all change nothing. The row stays so telephones learn the deletion; the
 * database sets `server_updated_at` (C-35) and the place is free again (C-43).
 *
 * @param now - Server time stored as `deleted_at`.
 * @returns true when exactly one row was deleted.
 */
export async function softDeleteContact(
  contactId: string,
  organizationId: string,
  now: Date
): Promise<boolean> {
  const result = await prisma.organizationContact.updateMany({
    where: { id: contactId, organizationId, deletedAt: null },
    data: { deletedAt: now },
  });
  return result.count === 1;
}

/** Tells whether an error is a unique violation (PostgreSQL 23505, reported by Prisma as P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
