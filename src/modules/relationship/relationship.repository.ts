import type { CustomerRelationship, Prisma } from '@prisma/client';
import { newId } from '../../shared/ids.js';

/**
 * Creates a counter: an ACTIVE relationship of an organization with no customer, used by
 * anonymous sales (C-06: no customer needs `customer_label`; C-10: a counter's credit limit is 0).
 *
 * Runs on the caller's transaction so the counter commits or rolls back with its organization
 * (ASVS v5.0.0-2.3.3). The limit stays at the database default 0 and no author is recorded: this
 * is creation, not a limit change, so no `credit_limit_changes` row is written.
 *
 * @param tx - Transaction client of the caller.
 * @param input - Supplier organization, counter label and the person who creates it.
 * @returns The stored relationship.
 */
export function createCounter(
  tx: Prisma.TransactionClient,
  input: { supplierOrganizationId: string; label: string; createdById: string }
): Promise<CustomerRelationship> {
  return tx.customerRelationship.create({
    data: {
      id: newId(),
      supplierOrganizationId: input.supplierOrganizationId,
      customerLabel: input.label,
      creditLimit: 0n,
      status: 'ACTIVE',
      createdById: input.createdById,
    },
  });
}
