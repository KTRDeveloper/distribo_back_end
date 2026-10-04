import { findDebtSupplierNames, findOwnedOrganizationNames } from './privacy.repository.js';
import type { DeletionCheck } from './privacy.schemas.js';

/**
 * Lists what blocks the deletion of the caller's account (CM-02): a positive balance as a
 * customer, or ownership of an ACTIVE or SUSPENDED organization. Fails closed: if either
 * query throws, no answer is given, so a person is never told they may delete.
 *
 * @param personId - The caller, from the token only.
 */
export async function deletionCheck(personId: string): Promise<DeletionCheck> {
  const [debtors, owned] = await Promise.all([
    findDebtSupplierNames(personId),
    findOwnedOrganizationNames(personId),
  ]);
  const blockers = [
    ...debtors.map((label) => ({ code: 'POSITIVE_BALANCE' as const, label })),
    ...owned.map((label) => ({ code: 'OWNS_ORGANIZATION' as const, label })),
  ];
  return { can_delete: blockers.length === 0, blockers };
}
