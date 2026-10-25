import type { Prisma } from '@prisma/client';
import { startOrQueueForfait, type ForfaitPurchase } from './forfait.service.js';
import { addDays, addMonths, convertRemainingDays, planRank } from './plan-math.js';
import {
  endPeriod,
  insertConversionPeriod,
  insertEvent,
  insertPeriod,
  insertPurchaseEvent,
  listQueue,
  lockSubscriptions,
  type PeriodRow,
} from './subscription.repository.js';

export type AddedForfait = {
  purchased: PeriodRow;
  conversion: PeriodRow | null;
  endedIds: string[];
};

/**
 * Applies a paid purchase under the organization's transaction-scoped lock (BIL-027).
 * Higher plans replace the entire queue, converting its remaining value before any writes;
 * other purchases retain the existing placement and grace rules. Ending, insertion and
 * journaling share the caller's transaction (ASVS 2.3.3), which must propagate all failures.
 * @param tx Caller-owned transaction, held through commit or rollback.
 * @param purchase Trusted payment, actor and reference instant; never raw request data.
 * @returns The purchased period, optional converted days and replaced period ids.
 * @throws If conversion is invalid, payment was already applied, or any write fails.
 */
export async function addPaidForfait(
  tx: Prisma.TransactionClient,
  purchase: ForfaitPurchase,
): Promise<AddedForfait> {
  await lockSubscriptions(tx, purchase.organizationId);
  const queue = await listQueue(tx, purchase.organizationId);
  const running = queue.find((period) => period.status === 'ACTIVE');
  if (!running || planRank(running.plan) >= planRank(purchase.plan)) {
    return { purchased: await startOrQueueForfait(tx, purchase), conversion: null, endedIds: [] };
  }

  const days = convertRemainingDays(queue.map((period) => ({
    plan: period.plan,
    remainingMs: period.status === 'ACTIVE'
      ? Math.max(0, period.endsAt.getTime() - purchase.now.getTime())
      : period.endsAt.getTime() - period.startsAt.getTime(),
  })), purchase.plan);

  for (const period of queue) {
    await endPeriod(tx, period.id,
      period.status === 'ACTIVE' ? purchase.now : period.startsAt, 'UPGRADED');
    await insertPurchaseEvent(tx, purchase, 'FORFAIT_ENDED', period.id, { reason: 'UPGRADED' });
  }

  const purchased = await insertPeriod(tx, purchase, {
    placement: 'NOW', startsAt: purchase.now, endsAt: addMonths(purchase.now, purchase.months),
  });
  await insertEvent(tx, purchase, purchased);
  const conversion = days > 0
    ? await insertConversionPeriod(tx, purchase, purchased.endsAt, addDays(purchased.endsAt, days))
    : null;
  if (conversion) await insertEvent(tx, purchase, conversion);
  await insertPurchaseEvent(tx, purchase, 'PLAN_CHANGED', null, {
    from: running.plan, to: purchase.plan,
  });
  return { purchased, conversion, endedIds: queue.map((period) => period.id) };
}
