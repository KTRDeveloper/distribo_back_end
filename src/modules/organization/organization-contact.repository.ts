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

/** Tells whether an error is a unique violation (PostgreSQL 23505, reported by Prisma as P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
