import type { Prisma } from '@prisma/client';
import {
  listPausedProducts,
  listProductsOnSale,
  setProductsPaused,
} from '../catalog/catalog.repository.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { countOrderedLinesByVariant } from '../order/order.repository.js';
import { findActiveOwnerId } from '../organization/organization.repository.js';
import { insertProductsEvent } from './limits.repository.js';
import { productsNotice } from './notices.js';
import type { OrganizationRights } from './rights.service.js';
import { enforceSeatLimit, type SeatEnforcement } from './seat-limit.service.js';
import { findLatestKeepChoice } from './subscription.repository.js';

export type LimitsEnforcement = {
  seats: SeatEnforcement;
  productsPaused: number;
  productsResumed: number;
};

/**
 * Fits seats first, then ranks sale-eligible products by owner choice, 90-day demand,
 * newest creation and id. Choices can only prioritize tenant-scoped candidates (ASVS 8.2.2).
 * The seat enforcer's transaction-scoped subscription lock also serializes product
 * enforcement, including simultaneous repeats. Changes, count-only SYSTEM events and
 * localized owner notices share the caller's transaction (ASVS 2.3.3, 16.3.1).
 * @param tx Caller-owned transaction; enforcement errors must propagate to roll it back.
 * @param organizationId Tenant selected by trusted server code.
 * @param rights Server-computed rights; null limits restore all eligible candidates.
 * @param now Effective time for pauses, journal entries and the 90-day demand window.
 * @returns Seat outcome and the numbers of products actually paused and resumed.
 * @throws RangeError for an invalid product limit; errors also abort on missing owner or failed writes.
 */
export async function enforceLimits(
  tx: Prisma.TransactionClient,
  organizationId: string,
  rights: OrganizationRights,
  now: Date
): Promise<LimitsEnforcement> {
  if (
    rights.maxProducts !== null &&
    (!Number.isSafeInteger(rights.maxProducts) || rights.maxProducts < 0)
  ) {
    throw new RangeError('Product limit must be a nonnegative integer or null');
  }
  const seats = await enforceSeatLimit(tx, organizationId, rights.maxCollaborators, now);
  const onSale = await listProductsOnSale(tx, organizationId);
  const paused = await listPausedProducts(tx, organizationId);
  const choice = await findLatestKeepChoice(tx, organizationId);
  const demand = await countOrderedLinesByVariant(
    tx,
    organizationId,
    new Date(now.getTime() - 90 * 86_400_000)
  );
  const priorities = new Map<string, number>();
  for (const id of choice?.productIds ?? []) {
    if (!priorities.has(id)) priorities.set(id, priorities.size);
  }
  const ranked = [...onSale, ...paused].map((product) => ({
    ...product,
    demand: product.variantIds.reduce((sum, id) => sum + (demand.get(id) ?? 0), 0),
  }));
  ranked.sort((a, b) => {
    const aPriority = priorities.get(a.productId) ?? Infinity;
    const bPriority = priorities.get(b.productId) ?? Infinity;
    if (aPriority !== bPriority) return aPriority < bPriority ? -1 : 1;
    return (
      b.demand - a.demand ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      a.productId.localeCompare(b.productId)
    );
  });
  const keep = new Set(
    ranked.slice(0, rights.maxProducts ?? ranked.length).map((row) => row.productId)
  );
  const toPause = onSale.filter((row) => !keep.has(row.productId)).map((row) => row.productId);
  const toResume = paused.filter((row) => keep.has(row.productId)).map((row) => row.productId);
  const productsPaused = (await setProductsPaused(tx, organizationId, toPause, true, now)).length;
  const productsResumed = (await setProductsPaused(tx, organizationId, toResume, false, now))
    .length;

  if (productsPaused || productsResumed) {
    const ownerId = await findActiveOwnerId(tx, organizationId);
    if (!ownerId) throw new Error('Product limit enforcement requires an active owner');
    const language = await recipientLanguage(ownerId, tx);
    for (const [kind, count] of [
      ['PAUSED', productsPaused],
      ['RESUMED', productsResumed],
    ] as const) {
      if (!count) continue;
      await insertProductsEvent(tx, organizationId, kind, count, now);
      await notify(
        {
          recipientId: ownerId,
          organizationId,
          sourceEvent:
            kind === 'PAUSED' ? 'subscription.products_paused' : 'subscription.products_resumed',
          content: productsNotice(kind, language, count),
        },
        tx
      );
    }
  }
  return { seats, productsPaused, productsResumed };
}
