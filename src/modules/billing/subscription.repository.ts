import type { Prisma, Subscription } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../lib/db.js';
import type { ForfaitPurchase, Placement, QueuedPeriod } from './forfait.service.js';
import type { ExpiredPeriod } from './rights.service.js';

export type PeriodRow = Subscription;

/**
 * Reads only this organization's latest owner choice; stale or foreign seat ids are
 * resolved against the tenant-scoped team list by the caller (ASVS 8.2.2).
 * @param tx Transaction shared with seat enforcement.
 * @param organizationId Organization selected by trusted server code.
 * @returns The explicit ordered choices, or null when no choice was recorded.
 */
export async function findLatestKeepChoice(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<{ collaborationIds: string[]; productIds: string[] } | null> {
  const [row] = await tx.$queryRaw<Array<{
    details: { collaboration_ids: string[]; product_ids: string[] };
  }>>`
    SELECT details FROM subscription_events
    WHERE organization_id = ${organizationId}::uuid AND kind = 'KEEP_CHOICE'
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1
  `;
  return row ? {
    collaborationIds: row.details.collaboration_ids,
    productIds: row.details.product_ids,
  } : null;
}

/**
 * Journals a server-decided seat transition in the caller's transaction (BIL-019).
 * @param tx Transaction shared by the seat change and its notice.
 * @param organizationId Tenant whose scoped seat was changed.
 * @param collaborationId Changed seat; details deliberately contain ids only.
 * @param kind Successful transition, never a deferred or unchanged seat.
 * @param now Effective time supplied by the caller.
 */
export async function insertSeatEvent(
  tx: Prisma.TransactionClient,
  organizationId: string,
  collaborationId: string,
  kind: 'PAUSED' | 'RESUMED',
  now: Date,
): Promise<void> {
  const details = JSON.stringify({ collaboration_id: collaborationId });
  await tx.$executeRaw`
    INSERT INTO subscription_events (id, organization_id, kind, actor, details, occurred_at)
    VALUES (${uuidv7()}::uuid, ${organizationId}::uuid,
            ${kind}::"SubscriptionEventKind", 'SYSTEM', ${details}::jsonb, ${now})
  `;
}

/**
 * Appends an owner's choice without altering previous choices or current plan rights (BIL-018).
 * C-55: only the authenticated owner's person id is set; no payer or administrator references.
 * @param tx Transaction shared with the tenant-scoped eligibility checks.
 * @param organizationId Organization from the server-loaded actor.
 * @param personId Authenticated owner recording the choice.
 * @param details Explicitly selected lists, never a raw request body.
 */
export async function insertKeepChoiceEvent(
  tx: Prisma.TransactionClient,
  organizationId: string,
  personId: string,
  details: { collaboration_ids: string[]; product_ids: string[] }
): Promise<void> {
  const json = JSON.stringify(details);
  await tx.$executeRaw`
    INSERT INTO subscription_events (id, organization_id, kind, actor, person_id, details)
    VALUES (${uuidv7()}::uuid, ${organizationId}::uuid, 'KEEP_CHOICE', 'OWNER',
            ${personId}::uuid, ${json}::jsonb)
  `;
}

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
): Promise<Array<QueuedPeriod & { id: string }>> {
  const rows = await tx.subscription.findMany({
    where: { organizationId, status: { in: ['ACTIVE', 'SCHEDULED'] } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: { id: true, plan: true, status: true, startsAt: true, endsAt: true },
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

/**
 * Reads the organization's latest ended period for grace, retaining its paid plan.
 * A newer non-expiry ending suppresses older expiries: upgrades, closure and refunds
 * must never revive previously paid rights (BIL-013, ASVS 8.2.2).
 * @param tx The caller's transaction, after taking the subscription lock.
 * @param organizationId The organization selected by trusted server code.
 * @returns The latest ending only if it expired naturally, otherwise null.
 */
export async function findLastExpiredPeriod(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<ExpiredPeriod | null> {
  const row = await tx.subscription.findFirst({
    where: { organizationId, status: 'ENDED' },
    orderBy: [{ endsAt: 'desc' }, { id: 'desc' }],
    select: { plan: true, endsAt: true, endReason: true },
  });
  return row?.endReason === 'EXPIRED' ? { plan: row.plan, endsAt: row.endsAt } : null;
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
 * Ends a locked, tenant-scoped queue period before inserting its replacement (C-52).
 * @param tx Transaction shared with the replacement periods and journal.
 * @param id Period id obtained from the organization's locked queue, never a request id.
 * @param endsAt Effective end, or the scheduled start for an absorbed future period.
 * @param reason Server-decided ending reason, required exactly for ENDED periods.
 */
export async function endPeriod(
  tx: Prisma.TransactionClient,
  id: string,
  endsAt: Date,
  reason: 'EXPIRED' | 'UPGRADED' | 'CLOSED' | 'REFUNDED',
): Promise<void> {
  await tx.subscription.update({ where: { id }, data: { status: 'ENDED', endsAt, endReason: reason } });
}

/**
 * Activates a due period selected from the tenant's locked queue (C-52).
 * @param tx Caller transaction holding the subscription lock until commit.
 * @param id Server-selected SCHEDULED period; an unexpected state aborts the operation.
 */
export async function activatePeriod(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.subscription.update({ where: { id, status: 'SCHEDULED' }, data: { status: 'ACTIVE' } });
}

/**
 * Journals a clock-driven transition without attributing it to a person or payment.
 * Period changes and their immutable events must commit together (ASVS 2.3.3).
 * @param tx Caller transaction holding the organization's subscription lock.
 * @param organizationId Tenant selected by trusted server code.
 * @param kind Lifecycle or rights transition decided by the server.
 * @param subscriptionId Locked period id, or null for an organization-wide rights change.
 * @param details Explicit non-personal transition fields.
 * @param now Reference instant shared with lifecycle and rights calculations.
 */
export async function insertSystemEvent(
  tx: Prisma.TransactionClient,
  organizationId: string,
  kind: 'FORFAIT_ENDED' | 'PLAN_CHANGED',
  subscriptionId: string | null,
  details: Prisma.InputJsonObject,
  now: Date,
): Promise<void> {
  const json = JSON.stringify(details);
  await tx.$executeRaw`
    INSERT INTO subscription_events
      (id, organization_id, kind, actor, subscription_id, details, occurred_at)
    VALUES (${uuidv7()}::uuid, ${organizationId}::uuid, ${kind}::"SubscriptionEventKind",
            'SYSTEM', ${subscriptionId}::uuid, ${json}::jsonb, ${now})
  `;
}

/** Inserts the zero-price converted days after the purchased period, without payment or months. */
export async function insertConversionPeriod(
  tx: Prisma.TransactionClient,
  purchase: ForfaitPurchase,
  startsAt: Date,
  endsAt: Date,
): Promise<PeriodRow> {
  return tx.subscription.create({ data: {
    id: uuidv7(), organizationId: purchase.organizationId, plan: purchase.plan,
    origin: 'CONVERSION', status: 'SCHEDULED', price: 0n, startsAt, endsAt,
  } });
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
  await insertPurchaseEvent(tx, purchase, 'FORFAIT_ADDED', period.id, {
    plan: period.plan, months: period.months, status: period.status,
  });
}

/**
 * Appends an upgrade or purchase event with the trusted payment's actor and timestamp.
 * All events share the caller's transaction so a journal failure aborts the whole upgrade.
 * @param tx Transaction holding the organization's subscription lock.
 * @param purchase Trusted purchase context, including payer or administrator provenance.
 * @param kind Server-decided journal event.
 * @param subscriptionId Period being added or ended, or null for an organization plan change.
 * @param details Explicit event fields; never raw request input.
 */
export async function insertPurchaseEvent(
  tx: Prisma.TransactionClient,
  purchase: ForfaitPurchase,
  kind: 'FORFAIT_ADDED' | 'FORFAIT_ENDED' | 'PLAN_CHANGED',
  subscriptionId: string | null,
  details: Prisma.InputJsonObject,
): Promise<void> {
  const actor = purchase.actor;
  const administratorId = actor.actor === 'ADMINISTRATOR' ? actor.administratorId : null;
  const adminActionId = actor.actor === 'ADMINISTRATOR' ? actor.adminActionId : null;
  const json = JSON.stringify(details);
  await tx.$executeRaw`
    INSERT INTO subscription_events
      (id, organization_id, kind, actor, administrator_id, admin_action_id,
       subscription_id, payment_id, details, occurred_at)
    VALUES
      (${uuidv7()}::uuid, ${purchase.organizationId}::uuid, ${kind}::"SubscriptionEventKind",
       ${actor.actor}::"SubscriptionEventActor", ${administratorId}::uuid,
       ${adminActionId}::uuid, ${subscriptionId}::uuid, ${purchase.paymentId}::uuid,
       ${json}::jsonb, ${purchase.now})
  `;
}
