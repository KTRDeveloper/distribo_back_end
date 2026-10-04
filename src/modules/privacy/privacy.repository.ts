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
