import type { Prisma } from '@prisma/client';
import { PLANS, type PlanCode } from '../../shared/plans.js';
import { writePlanFields, type PlanFields } from '../organization/organization.repository.js';
import type { QueuedPeriod } from './forfait.service.js';
import { addDays, GRACE_DAYS } from './plan-math.js';
import { findLastExpiredPeriod, listQueue, lockSubscriptions } from './subscription.repository.js';

export type OrganizationRights = PlanFields;
export type ExpiredPeriod = Pick<QueuedPeriod, 'plan' | 'endsAt'>;

function rights(
  plan: PlanCode,
  planEndsAt: Date | null,
  graceEndsAt: Date | null = null,
): OrganizationRights {
  const { maxCollaborators, maxProducts } = PLANS[plan];
  return { plan, planEndsAt, graceEndsAt, maxCollaborators, maxProducts };
}

/**
 * Derives rights from paid time, not stale lifecycle statuses (C-41).
 * Only contiguous periods of the running plan extend its end; grace is strictly
 * less than seven elapsed days and is unavailable when another period follows.
 * @param queue The organization's ACTIVE and SCHEDULED periods, in any order.
 * @param lastExpiredPeriod The latest naturally expired ending, with its paid plan.
 * @param now The reference instant shared by the caller's transaction.
 * @returns Exactly the five server-owned plan fields, with limits from PLANS.
 */
export function computeRights(
  queue: QueuedPeriod[],
  lastExpiredPeriod: ExpiredPeriod | null,
  now: Date,
): OrganizationRights {
  const ordered = [...queue].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const instant = now.getTime();
  const running = ordered.findIndex(
    (period) => period.startsAt.getTime() <= instant && instant < period.endsAt.getTime(),
  );
  if (running !== -1) {
    const current = ordered[running];
    let end = current.endsAt;
    for (const next of ordered.slice(running + 1)) {
      if (next.plan !== current.plan || next.startsAt.getTime() !== end.getTime()) break;
      end = next.endsAt;
    }
    return rights(current.plan, end);
  }

  let expired = lastExpiredPeriod;
  for (const period of ordered) {
    if (
      period.status === 'ACTIVE' && period.endsAt.getTime() <= instant &&
      (!expired || period.endsAt.getTime() > expired.endsAt.getTime())
    ) {
      expired = period;
    }
  }
  if (expired) {
    const end = expired.endsAt.getTime();
    const graceEnd = addDays(expired.endsAt, GRACE_DAYS);
    const hasFollowing = ordered.some((period) => period.startsAt.getTime() >= end);
    if (end <= instant && instant < graceEnd.getTime() && !hasFollowing) {
      return rights(expired.plan, expired.endsAt, graceEnd);
    }
  }
  return rights('FREE', null);
}

/**
 * Serializes rights with subscription purchases using their organization-scoped lock.
 * All reads and the organization contract write use the caller's transaction so
 * failures roll back together (ASVS 8.2.2, 2.3.3); errors intentionally propagate.
 * @param tx The transaction owning the queue lock and plan write.
 * @param organizationId The organization selected by server code, never request input.
 * @param now The reference instant used throughout the operation.
 * @returns The five plan fields written through the organization contract.
 */
export async function recomputeRights(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date,
): Promise<OrganizationRights> {
  await lockSubscriptions(tx, organizationId);
  const queue = await listQueue(tx, organizationId);
  const lastExpired = await findLastExpiredPeriod(tx, organizationId);
  const result = computeRights(queue, lastExpired, now);
  await writePlanFields(tx, organizationId, result);
  return result;
}
