import type { Prisma } from '@prisma/client';
import { findActiveOwnerId } from '../organization/organization.repository.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { adjustmentNotice, type AdjustmentInput } from './notices.js';

/**
 * Notifies only this organization's active owner within the caller's transaction.
 * All lookups and insertion share the transaction so a rollback leaves no notice
 * for an adjustment that did not commit (BIL-036, ASVS v5.0.0-2.3.3).
 * @param tx Transaction applying the administrator's adjustment.
 * @param organizationId Business whose plan was adjusted.
 * @param input Applied adjustment, without administrator identity or reason.
 * @returns Nothing when the business has no active owner.
 * @throws Propagates lookup or notification errors to abort the transaction.
 */
export async function notifyOwnerOfAdjustment(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: AdjustmentInput
): Promise<void> {
  const recipientId = await findActiveOwnerId(tx, organizationId);
  if (!recipientId) return;

  const language = await recipientLanguage(recipientId, tx);
  await notify({
    recipientId,
    organizationId,
    sourceEvent: 'subscription.adjusted',
    content: adjustmentNotice(language, input),
  }, tx);
}
