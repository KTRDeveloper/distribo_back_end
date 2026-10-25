import type { Prisma } from '@prisma/client';
import { readPlanFields } from '../organization/organization.repository.js';
import { enforceLimits } from './limits.service.js';
import { recomputeRights } from './rights.service.js';
import {
  activatePeriod,
  endPeriod,
  insertSystemEvent,
  listQueue,
  lockSubscriptions,
} from './subscription.repository.js';

export type AdvanceResult = { ended: number; started: number; planChanged: boolean };

/**
 * Brings one business's periods, rights and paused items to the reference instant.
 * The subscription lock serializes purchases and concurrent clock runs before any
 * reads; all mutations and SYSTEM events share the caller's transaction (ASVS
 * 2.3.3, 8.2.2). Expiries precede activation to preserve the single-ACTIVE rule C-52.
 * @param tx Caller-owned transaction; failures propagate to roll back all changes.
 * @param organizationId Business selected by trusted server code, never client input.
 * @param now Reference instant shared by lifecycle, grace, limits and events.
 * @returns Transition counts; unknown or deleted businesses have no side effects.
 */
export async function advanceSubscription(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date,
): Promise<AdvanceResult> {
  await lockSubscriptions(tx, organizationId);
  const before = await readPlanFields(tx, organizationId);
  const result: AdvanceResult = { ended: 0, started: 0, planChanged: false };
  if (!before) return result;

  const queue = await listQueue(tx, organizationId);
  for (const period of queue) {
    if (period.startsAt.getTime() > now.getTime()) continue;
    if (period.endsAt.getTime() <= now.getTime()) {
      await endPeriod(tx, period.id, period.endsAt, 'EXPIRED');
      await insertSystemEvent(tx, organizationId, 'FORFAIT_ENDED', period.id,
        { period_id: period.id, reason: 'EXPIRED' }, now);
      result.ended++;
    } else if (period.status === 'SCHEDULED') {
      await activatePeriod(tx, period.id);
      result.started++;
    }
  }

  const after = await recomputeRights(tx, organizationId, now);
  await enforceLimits(tx, organizationId, after, now);
  result.planChanged = before.plan !== after.plan ||
    before.graceEndsAt?.getTime() !== after.graceEndsAt?.getTime();
  if (result.planChanged) {
    await insertSystemEvent(tx, organizationId, 'PLAN_CHANGED', null, {
      from: before.plan, to: after.plan, grace_ends_at: after.graceEndsAt?.toISOString() ?? null,
    }, now);
  }
  return result;
}
