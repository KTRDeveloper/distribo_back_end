import { Prisma, type OrganizationContact } from '@prisma/client';
import { prisma } from '../../lib/db.js';

/** The two live-row conflicts a new contact can meet in its business (C-43). */
export type ContactConflict = 'SLOT_TAKEN' | 'ALREADY_EXISTS' | null;

/**
 * Looks for a live contact (not deleted) of the business that already holds this value or this
 * place. A value already listed wins over a taken place. Pending contacts count too (C-43).
 * The place of a phone is its slot; an email (slot null) has the single email place of the business.
 *
 * @param organizationId - Organization from the loaded actor.
 * @param slot - Slot of a phone, or null for an email.
 * @param tx - Transaction of the gesture; omit it to read the committed state.
 */
export async function findContactConflict(
  organizationId: string,
  slot: number | null,
  value: string,
  tx?: Prisma.TransactionClient
): Promise<ContactConflict> {
  const client = tx ?? prisma;
  const live = await client.organizationContact.findMany({
    where: {
      organizationId,
      deletedAt: null,
      OR: [{ value }, slot === null ? { kind: 'EMAIL' } : { slot }],
    },
    select: { kind: true, slot: true, value: true },
  });
  if (live.some((row) => row.value === value)) return 'ALREADY_EXISTS';
  const placeTaken = live.some((row) => (slot === null ? row.kind === 'EMAIL' : row.slot === slot));
  return placeTaken ? 'SLOT_TAKEN' : null;
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

/**
 * Inserts an EMAIL contact: no slot, never verified at once (C-43, C-44, CWE-290). The database
 * has the last word on the uniqueness rules.
 */
export function insertEmailContact(
  tx: Prisma.TransactionClient,
  data: { id: string; organizationId: string; value: string; createdById: string }
): Promise<OrganizationContact> {
  return tx.organizationContact.create({
    data: {
      id: data.id,
      organizationId: data.organizationId,
      kind: 'EMAIL',
      slot: null,
      value: data.value,
      createdById: data.createdById,
    },
  });
}

/**
 * Lists the live (not deleted) contacts of the business, pending ones included, ordered by slot
 * then id. Only the three fields a notice needs are read (ASVS v5.0.0-8.2.1: the organization
 * comes from the loaded actor).
 */
export async function listLiveContacts(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<{ kind: 'PHONE' | 'EMAIL'; slot: number | null; value: string }[]> {
  return tx.organizationContact.findMany({
    where: { organizationId, deletedAt: null },
    select: { kind: true, slot: true, value: true },
    orderBy: [{ slot: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Sends every verified live PHONE contact holding this number, of any business, back to pending
 * (CM-36, C-43: both verification fields are emptied together). Value, slot and the other columns
 * stay. One guarded UPDATE finds and changes the rows, so a contact verified or deleted by a
 * parallel gesture is judged on its committed state.
 *
 * @param tx - The transaction that frees the number.
 * @returns The distinct ids of the businesses touched.
 */
export async function clearVerificationByNumber(
  tx: Prisma.TransactionClient,
  phoneNumber: string
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ organization_id: string }[]>`
    UPDATE organization_contacts
    SET verified_at = NULL, verification_method = NULL
    WHERE kind = 'PHONE' AND value = ${phoneNumber}
      AND deleted_at IS NULL AND verified_at IS NOT NULL
    RETURNING organization_id`;
  return [...new Set(rows.map((row) => row.organization_id))];
}

/**
 * Finds the ACTIVE owner of each given business; a business without one is simply absent.
 *
 * @returns One entry per business that has an ACTIVE owner.
 */
export async function findActiveOwners(
  tx: Prisma.TransactionClient,
  organizationIds: string[]
): Promise<{ organizationId: string; personId: string }[]> {
  return tx.collaboration.findMany({
    where: { organizationId: { in: organizationIds }, role: 'OWNER', status: 'ACTIVE' },
    select: { organizationId: true, personId: true },
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
