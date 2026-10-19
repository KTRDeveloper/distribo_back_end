import type { Order, OrderStatus, Prisma } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';
import { findOrderById, updateStatusIfIn, type StatusStepData } from './order.repository.js';

export type TransitionFields = { cancellationReason?: string; acceptedAt?: Date };

export type TransitionActor = { personId: string; party: 'CUSTOMER' | 'SUPPLIER' };

/** Statuses an order may come from, per target status (CM-12). */
const ALLOWED_FROM: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: [],
  CONFIRMED: ['PENDING', 'IN_DELIVERY'],
  IN_DELIVERY: ['CONFIRMED'],
  DELIVERED: ['CONFIRMED', 'IN_DELIVERY'],
  CANCELLED: ['PENDING', 'CONFIRMED'],
};

const PENDING_ONLY: readonly OrderStatus[] = ['PENDING'];

export const SYNC_ISSUE_DELIVERED_AFTER_CANCELLATION = 'Livrée après annulation';
export const SYNC_ISSUE_CANCELLATION_IMPOSSIBLE = 'Annulation impossible : commande livrée';

const NO_CANCELLATION = {
  cancelledByParty: null,
  cancelledById: null,
  cancelledAt: null,
  cancellationReason: null,
} as const;

/**
 * Changes an order's status by a permitted step; the one function every route and the
 * sync judge use (CM-12, C-18, C-16).
 *
 * The step is a single conditional UPDATE on the current status (v5.0.0-2.3.1), so parallel
 * steps are settled by the row update and exactly one wins (v5.0.0-2.3.4). Who may take the
 * step is the caller's concern (routes, ACC rules).
 *
 * With `acceptedAt`, the step to CONFIRMED is an acceptance: it is allowed from PENDING only and
 * writes `accepted_at` in the same conditional update, so two parallel acceptances cannot both
 * win and a second one never rewrites the date (ORD-023, C-51). Without it (a failed delivery
 * attempt, IN_DELIVERY to CONFIRMED) the date is left as it was.
 *
 * With `viaSync`, delivery wins over cancellation: CANCELLED to DELIVERED is accepted and
 * flagged in `sync_issue`, and cancelling a DELIVERED order leaves it unchanged except for
 * `sync_issue` (the unchanged order is returned, no error).
 *
 * @param tx the caller's transaction, so the step joins the caller's other writes
 * @returns the order after the step
 * @throws 400 VALIDATION_ERROR when a SUPPLIER cancels without a reason
 * @throws 404 NOT_FOUND when the order does not exist
 * @throws 409 INVALID_TRANSITION (naming the current status) when the step is not permitted
 */
export async function transitionOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  to: OrderStatus,
  actor: TransitionActor,
  fields: TransitionFields = {},
  options: { viaSync?: boolean } = {}
): Promise<Order> {
  const reason = fields.cancellationReason?.trim() || null;
  if (to === 'CANCELLED' && actor.party === 'SUPPLIER' && reason === null) {
    throw httpError(400, 'VALIDATION_ERROR', 'A cancellation reason is required.');
  }

  const now = new Date();
  const data: StatusStepData = { status: to };
  if (to === 'CANCELLED') {
    Object.assign(data, {
      cancelledByParty: actor.party,
      cancelledById: actor.personId,
      cancelledAt: now,
      cancellationReason: reason,
    });
  } else if (to === 'DELIVERED') {
    Object.assign(data, { deliveredAt: now, deliveredById: actor.personId });
  }

  const isAcceptance = to === 'CONFIRMED' && fields.acceptedAt !== undefined;
  if (isAcceptance) data.acceptedAt = fields.acceptedAt;
  const allowedFrom = isAcceptance ? PENDING_ONLY : ALLOWED_FROM[to];

  if ((await updateStatusIfIn(tx, orderId, allowedFrom, data)) === 1) {
    return current(tx, orderId);
  }

  if (options.viaSync) {
    if (to === 'DELIVERED') {
      const done = await updateStatusIfIn(tx, orderId, ['CANCELLED'], {
        ...data,
        ...NO_CANCELLATION,
        syncIssue: SYNC_ISSUE_DELIVERED_AFTER_CANCELLATION,
      });
      if (done === 1) return current(tx, orderId);
    } else if (to === 'CANCELLED') {
      const flagged = await updateStatusIfIn(tx, orderId, ['DELIVERED'], {
        syncIssue: SYNC_ISSUE_CANCELLATION_IMPOSSIBLE,
      });
      if (flagged === 1) return current(tx, orderId);
    }
  }

  const order = await findOrderById(tx, orderId);
  if (!order) throw httpError(404, 'NOT_FOUND', 'Order not found.');
  throw httpError(409, 'INVALID_TRANSITION', `Order cannot go from ${order.status} to ${to}.`);
}

async function current(tx: Prisma.TransactionClient, orderId: string): Promise<Order> {
  const order = await findOrderById(tx, orderId);
  if (!order) throw httpError(404, 'NOT_FOUND', 'Order not found.');
  return order;
}
