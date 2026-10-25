import type { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

/**
 * Journals one aggregate product transition without exposing product identifiers (BIL-020).
 * @param tx Caller-owned transaction shared with product changes and the owner's notice.
 * @param organizationId Tenant selected by trusted server code.
 * @param kind Transition that actually changed products.
 * @param count Number of products changed, never the requested batch size.
 * @param now Effective time shared by the enforcement operation.
 */
export async function insertProductsEvent(
  tx: Prisma.TransactionClient,
  organizationId: string,
  kind: 'PAUSED' | 'RESUMED',
  count: number,
  now: Date
): Promise<void> {
  const details = JSON.stringify({ target: 'PRODUCTS', count });
  await tx.$executeRaw`
    INSERT INTO subscription_events (id, organization_id, kind, actor, details, occurred_at)
    VALUES (${uuidv7()}::uuid, ${organizationId}::uuid,
            ${kind}::"SubscriptionEventKind", 'SYSTEM', ${details}::jsonb, ${now})
  `;
}
