import type { Prisma } from '@prisma/client';
import { enforceLimits } from '../billing/limits.service.js';
import { recomputeRights } from '../billing/rights.service.js';

/**
 * Fits the catalog of each organization touched by a push to its plan (C-46, SYNC-035): billing
 * recomputes the rights, then pauses what exceeds the limit or resumes what now fits, and tells
 * the owner. Nothing is refused: the pushed lines stay accepted.
 *
 * Runs in the push's transaction, so the catalog and its limit change together (ASVS 2.3.3);
 * `paused_at` is written by billing only (ASVS 15.3.3). Organizations are visited in id order so
 * two concurrent pushes lock subscriptions in the same order and cannot deadlock.
 *
 * @param tx - The push's transaction; an error here rolls the whole batch back.
 * @param organizationIds - Organizations of the catalog lines the judge passed, from the server's
 * own scope, never from the phone. Duplicates are visited once.
 * @param now - The effective time for rights, pauses and notices.
 */
export async function enforceCatalogLimits(
  tx: Prisma.TransactionClient,
  organizationIds: string[],
  now: Date
): Promise<void> {
  for (const organizationId of [...new Set(organizationIds)].sort()) {
    const rights = await recomputeRights(tx, organizationId, now);
    await enforceLimits(tx, organizationId, rights, now);
  }
}
