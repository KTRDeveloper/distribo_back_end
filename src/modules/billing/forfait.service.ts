import type { Prisma } from '@prisma/client';
import type { PackMonths, PaidPlanCode } from '../../shared/plans.js';
import { addMonths, GRACE_DAYS, planRank } from './plan-math.js';
import {
  findLastExpired,
  insertEvent,
  insertPeriod,
  listQueue,
  lockSubscriptions,
  type PeriodRow,
} from './subscription.repository.js';

export type Placement = {
  placement: 'NOW' | 'QUEUED' | 'UPGRADE';
  startsAt: Date;
  endsAt: Date;
};

export type QueuedPeriod = {
  plan: PaidPlanCode;
  status: 'ACTIVE' | 'SCHEDULED';
  startsAt: Date;
  endsAt: Date;
};

export type ForfaitActor =
  | { actor: 'PAYER' }
  | { actor: 'ADMINISTRATOR'; administratorId: string; adminActionId: string };

export type ForfaitPurchase = {
  organizationId: string;
  plan: PaidPlanCode;
  months: PackMonths;
  price: bigint;
  paymentId: string;
  actor: ForfaitActor;
  now: Date;
};

/** Signals that conversion must be handled by the upgrade flow, without writing a period. */
export class UpgradeRequiredError extends Error {
  constructor() {
    super('A higher plan requires the upgrade flow');
    this.name = 'UpgradeRequiredError';
  }
}

/**
 * Computes placement without database access so purchases and quotes share date arithmetic.
 * Grace is strictly less than seven elapsed days, and queued purchases preserve every paid day.
 * @param queue The organization's ACTIVE and SCHEDULED periods.
 * @param lastExpiredEndsAt The latest natural expiry, or null for no such history.
 * @param plan The purchased paid plan.
 * @param months The purchased pack duration.
 * @param now The caller's reference instant, reused for the entire transaction.
 * @returns Placement and UTC calendar bounds; upgrades are only signaled, not converted.
 */
export function placePurchase(
  queue: QueuedPeriod[],
  lastExpiredEndsAt: Date | null,
  plan: PaidPlanCode,
  months: PackMonths,
  now: Date,
): Placement {
  let placement: Placement['placement'] = 'NOW';
  let startsAt = now;
  if (queue.length > 0) {
    const running = queue.find((period) => period.status === 'ACTIVE');
    if (running && planRank(running.plan) < planRank(plan)) {
      placement = 'UPGRADE';
    } else {
      placement = 'QUEUED';
      startsAt = new Date(Math.max(...queue.map((period) => period.endsAt.getTime())));
    }
  } else if (lastExpiredEndsAt) {
    const elapsed = now.getTime() - lastExpiredEndsAt.getTime();
    if (elapsed >= 0 && elapsed < GRACE_DAYS * 86_400_000) startsAt = lastExpiredEndsAt;
  }
  return { placement, startsAt, endsAt: addMonths(startsAt, months) };
}

/**
 * Locks, places and journals a purchase entirely inside the caller's transaction (ASVS 2.3.3).
 * Callers must propagate failures so a failed journal insert cannot leave an unjournaled period.
 * @param tx The transaction that owns the advisory lock, period and event.
 * @param purchase Trusted purchase data and actor identity, never raw request input.
 * @returns The inserted ACTIVE or SCHEDULED payment period.
 * @throws UpgradeRequiredError before any write when conversion to a higher plan is required.
 */
export async function startOrQueueForfait(
  tx: Prisma.TransactionClient,
  purchase: ForfaitPurchase,
): Promise<PeriodRow> {
  await lockSubscriptions(tx, purchase.organizationId);
  const queue = await listQueue(tx, purchase.organizationId);
  const lastExpired = queue.length === 0
    ? await findLastExpired(tx, purchase.organizationId)
    : null;
  const placement = placePurchase(queue, lastExpired, purchase.plan, purchase.months, purchase.now);
  if (placement.placement === 'UPGRADE') throw new UpgradeRequiredError();
  const period = await insertPeriod(tx, purchase, { ...placement, placement: placement.placement });
  await insertEvent(tx, purchase, period);
  return period;
}
