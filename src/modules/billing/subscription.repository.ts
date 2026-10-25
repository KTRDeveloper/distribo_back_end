import type { Prisma, Subscription } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../lib/db.js';
import type { ForfaitPurchase, Placement, QueuedPeriod } from './forfait.service.js';

export type PeriodRow = Subscription;

/**
 * Runs subscription work atomically on the shared client.
 * @param work Work that must use the supplied transaction for every read and write.
 * @returns The callback result after a successful commit.
 */
export function runInTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(work);
}

/**
 * Serializes purchases even when the organization has no subscription row yet.
 * The transaction-scoped lock is held until the caller commits or rolls back (BIL-011,
 * ASVS 2.3.3); subsequent reads see the previous purchaser's committed queue.
 * @param tx The caller's transaction, shared by the queue, period and journal.
 * @param organizationId The organization whose subscription queue is being changed.
 */
export async function lockSubscriptions(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`billing:subscriptions:${organizationId}`}, 0))
  `;
}

/** Returns only the organization's live queue, in chronological order. */
export async function listQueue(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<QueuedPeriod[]> {
  const rows = await tx.subscription.findMany({
    where: { organizationId, status: { in: ['ACTIVE', 'SCHEDULED'] } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: { plan: true, status: true, startsAt: true, endsAt: true },
  });
  return rows.map((row) => ({
    ...row,
    status: row.status === 'ACTIVE' ? 'ACTIVE' : 'SCHEDULED',
  }));
}

/** Returns the latest natural expiry, excluding upgrades and other ending reasons. */
export async function findLastExpired(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<Date | null> {
  const row = await tx.subscription.findFirst({
    where: { organizationId, status: 'ENDED', endReason: 'EXPIRED' },
    orderBy: [{ endsAt: 'desc' }, { id: 'desc' }],
    select: { endsAt: true },
  });
  return row?.endsAt ?? null;
}

/** Inserts the purchased period using only server-decided placement and status. */
export async function insertPeriod(
  tx: Prisma.TransactionClient,
  purchase: ForfaitPurchase,
  placement: Placement & { placement: 'NOW' | 'QUEUED' },
): Promise<PeriodRow> {
  return tx.subscription.create({
    data: {
      id: uuidv7(),
      organizationId: purchase.organizationId,
      plan: purchase.plan,
      months: purchase.months,
      price: purchase.price,
      origin: 'PAYMENT',
      status: placement.placement === 'NOW' ? 'ACTIVE' : 'SCHEDULED',
      paymentId: purchase.paymentId,
      startsAt: placement.startsAt,
      endsAt: placement.endsAt,
    },
  });
}

/**
 * Appends the payment's journal entry in the same transaction as its period.
 * Actor identifiers come from the trusted caller; payer entries never inherit admin ids.
 * @param tx The caller's transaction; an insert failure must roll back the period.
 * @param purchase The purchase and its authenticated actor context.
 * @param period The newly inserted period to link in the immutable journal.
 */
export async function insertEvent(
  tx: Prisma.TransactionClient,
  purchase: ForfaitPurchase,
  period: PeriodRow,
): Promise<void> {
  const actor = purchase.actor;
  const administratorId = actor.actor === 'ADMINISTRATOR' ? actor.administratorId : null;
  const adminActionId = actor.actor === 'ADMINISTRATOR' ? actor.adminActionId : null;
  const details = JSON.stringify({ plan: period.plan, months: period.months, status: period.status });
  await tx.$executeRaw`
    INSERT INTO subscription_events
      (id, organization_id, kind, actor, administrator_id, admin_action_id,
       subscription_id, payment_id, details, occurred_at)
    VALUES
      (${uuidv7()}::uuid, ${purchase.organizationId}::uuid, 'FORFAIT_ADDED',
       ${actor.actor}::"SubscriptionEventActor", ${administratorId}::uuid,
       ${adminActionId}::uuid, ${period.id}::uuid, ${purchase.paymentId}::uuid,
       ${details}::jsonb, ${purchase.now})
  `;
}
