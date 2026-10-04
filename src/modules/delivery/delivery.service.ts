import { httpError } from '../../lib/http-error.js';
import type { Actor } from '../../types/express.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  findDeliveryInProgress,
  insertDelivery,
  isActiveCollaborator,
  listOwnDeliveries,
  listToDeliverOrders,
  lockOrderToAssign,
  reassignDelivery,
  runInTransaction,
} from './delivery.repository.js';
import type { AssignDeliveryInput, MineQuery, PageQuery } from './delivery.schemas.js';
import {
  projectDelivery,
  projectDeliveryForDriver,
  projectOrderForDriver,
  type DeliveryView,
  type MyDeliveryItem,
  type ToDeliverItem,
} from './delivery.views.js';

/**
 * Lists the orders waiting for a driver: CONFIRMED, with an applied delivery address, not deleted,
 * newest first. Any active member (DRIVER and above, so every role) sees the same pool; the actor
 * is loaded from the path and the query starts from its organization (v5.0.0-8.2.2).
 *
 * @param actor - Actor loaded from the path.
 * @param query - Validated page size and cursor.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listToDeliver(
  actor: Actor,
  query: PageQuery
): Promise<{ items: ToDeliverItem[]; next_cursor: string | null }> {
  const { rows, nextCursor } = await listToDeliverOrders(actor, query);
  return { items: rows.map(projectOrderForDriver), next_cursor: nextCursor };
}

/**
 * Lists the caller's own deliveries, optionally by status (in_progress, done, failed). The driver
 * is always the actor, never a client-sent id.
 *
 * @param actor - Actor loaded from the path.
 * @param query - Validated page size, cursor and status.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listMyDeliveries(
  actor: Actor,
  query: MineQuery
): Promise<{ items: MyDeliveryItem[]; next_cursor: string | null }> {
  const { rows, nextCursor } = await listOwnDeliveries(actor, query);
  return { items: rows.map(projectDeliveryForDriver), next_cursor: nextCursor };
}

const ASSIGNED_CONTENT = {
  FR: 'Une livraison vous a été assignée.',
  EN: 'A delivery was assigned to you.',
} as const;

/**
 * A MANAGER or OWNER assigns a CONFIRMED order with a delivery address to a driver (DLV-004). One
 * transaction (v5.0.0-2.3.3): the order of the caller's organization is locked (another business's
 * order is 404, v5.0.0-8.2.2), then a delivery already departed is refused (v5.0.0-2.3.1), the
 * order status and address are checked, the driver must be an ACTIVE collaborator of the caller's
 * organization (C-21), and a not-yet-departed delivery in progress is reassigned on the same row.
 * Otherwise a delivery with the gesture id is created. The driver is notified `delivery.assigned`.
 * Any refusal rolls everything back. Replays with the same `id` are answered by `idempotent()`.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked `assign Delivery`.
 * @param orderId - Order from the path.
 * @param input - Validated body: gesture id and driver person.
 * @returns The delivery after the assignment.
 * @throws 404 `NOT_FOUND` (order outside the business, or driver not an ACTIVE collaborator); 409
 * `DELIVERY_IN_PROGRESS` (departed); 409 `INVALID_TRANSITION` (order not CONFIRMED); 400
 * `VALIDATION_ERROR` (no delivery address).
 */
export function assignDelivery(
  actor: Actor,
  orderId: string,
  input: AssignDeliveryInput
): Promise<DeliveryView> {
  return runInTransaction(async (tx) => {
    const order = await lockOrderToAssign(tx, orderId, actor.organizationId);
    if (!order) throw httpError(404, 'NOT_FOUND', 'Order not found.');

    const inProgress = await findDeliveryInProgress(tx, orderId);
    if (inProgress?.departedAt) {
      throw httpError(409, 'DELIVERY_IN_PROGRESS', 'The delivery has already departed.');
    }
    if (order.status !== 'CONFIRMED') {
      throw httpError(409, 'INVALID_TRANSITION', 'Only a CONFIRMED order can be assigned.');
    }
    if (order.deliveryAddress === null || order.deliveryAddress.trim() === '') {
      throw httpError(400, 'VALIDATION_ERROR', 'The order has no delivery address.');
    }
    if (!(await isActiveCollaborator(tx, input.driver_person_id, actor.organizationId))) {
      throw httpError(404, 'NOT_FOUND', 'Driver not found.');
    }

    const delivery = inProgress
      ? await reassignDelivery(tx, inProgress.id, input.driver_person_id)
      : await insertDelivery(tx, {
          id: input.id,
          orderId,
          assignedToId: input.driver_person_id,
        });

    const language = await recipientLanguage(input.driver_person_id, tx);
    await notify(
      {
        recipientId: input.driver_person_id,
        organizationId: actor.organizationId,
        sourceEvent: 'delivery.assigned',
        content: language === 'EN' ? ASSIGNED_CONTENT.EN : ASSIGNED_CONTENT.FR,
        related: { type: 'order', id: orderId },
      },
      tx
    );
    return projectDelivery(delivery);
  });
}
