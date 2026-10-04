import { httpError } from '../../lib/http-error.js';
import type { Actor } from '../../types/express.js';
import { newId } from '../../shared/ids.js';
import { parseQuantity } from '../../shared/money.js';
import { appendLedgerEntry } from '../finance/ledger.service.js';
import { lineAmountOf, orderTotal } from '../order/order.calculations.js';
import { transitionOrder } from '../order/order.state.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  findDeliveryInProgress,
  findRegisteredCustomerRecipient,
  insertDelivery,
  insertDepartedDelivery,
  insertRestOrder,
  isActiveCollaborator,
  listLiveLines,
  listOwnDeliveries,
  listOwnerAndManagerIds,
  listToDeliverOrders,
  lockDeliveryToFail,
  lockOrderToAssign,
  lockOrderToDeliver,
  lockRelationshipForCredit,
  markArrived,
  markDeparted,
  markFailed,
  reassignDelivery,
  runInTransaction,
  setLineDelivered,
  setOrderTotal,
} from './delivery.repository.js';
import type {
  AssignDeliveryInput,
  DeliverInput,
  DepartInput,
  FailDeliveryInput,
  MineQuery,
  PageQuery,
} from './delivery.schemas.js';
import {
  projectDeliveredEntry,
  projectDeliveredOrder,
  projectDelivery,
  projectDeliveryForDriver,
  projectFailedDelivery,
  projectOrderForDriver,
  type DeliveredEntryView,
  type DeliveredOrderView,
  type DeliveryView,
  type FailedDeliveryView,
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

const DEPARTED_CONTENT = {
  FR: 'Votre commande est en cours de livraison.',
  EN: 'Your order is out for delivery.',
} as const;

/**
 * A DRIVER (or above) leaves with a CONFIRMED order that has a delivery address (DLV-005, C-21,
 * CM-12). One transaction (v5.0.0-2.3.3): the order of the caller's organization is locked, so two
 * parallel departures wait for each other and the loser sees the new status (v5.0.0-2.3.4; the
 * unique in-progress index and the conditional update of `transitionOrder` back it up). An order of
 * another business is 404 (v5.0.0-8.2.2). A delivery already departed, or an order already
 * IN_DELIVERY, is refused (v5.0.0-2.3.1). A not-yet-departed delivery assigned to someone else may
 * be taken only by a MANAGER or OWNER, who then becomes its driver. Otherwise a delivery with the
 * gesture id is created for the caller. The order becomes IN_DELIVERY and the customer is notified
 * `order.status_changed`. Any refusal rolls everything back. Replays with the same `id` are
 * answered by `idempotent()`.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked `depart Order`.
 * @param orderId - Order from the path.
 * @param input - Validated body: gesture id.
 * @returns The departed delivery and the new order status.
 * @throws 404 `NOT_FOUND` (order outside the business); 409 `DELIVERY_IN_PROGRESS` (already on the
 * road); 409 `INVALID_TRANSITION` (not CONFIRMED); 400 `VALIDATION_ERROR` (no delivery address);
 * 409 `ASSIGNED_TO_OTHER` (assigned to another driver and the caller is not a MANAGER or OWNER).
 */
export function departWithOrder(
  actor: Actor,
  orderId: string,
  input: DepartInput
): Promise<{ delivery: DeliveryView; order_status: 'IN_DELIVERY' }> {
  return runInTransaction(async (tx) => {
    const order = await lockOrderToAssign(tx, orderId, actor.organizationId);
    if (!order) throw httpError(404, 'NOT_FOUND', 'Order not found.');

    const inProgress = await findDeliveryInProgress(tx, orderId);
    if (inProgress?.departedAt || order.status === 'IN_DELIVERY') {
      throw httpError(409, 'DELIVERY_IN_PROGRESS', 'The order is already out for delivery.');
    }
    if (order.status !== 'CONFIRMED') {
      throw httpError(409, 'INVALID_TRANSITION', 'Only a CONFIRMED order can depart.');
    }
    if (order.deliveryAddress === null || order.deliveryAddress.trim() === '') {
      throw httpError(400, 'VALIDATION_ERROR', 'The order has no delivery address.');
    }
    const mayTakeOver = actor.role === 'MANAGER' || actor.role === 'OWNER';
    if (inProgress && inProgress.assignedToId !== actor.personId && !mayTakeOver) {
      throw httpError(409, 'ASSIGNED_TO_OTHER', 'The order is assigned to another driver.');
    }

    await transitionOrder(tx, orderId, 'IN_DELIVERY', {
      personId: actor.personId,
      party: 'SUPPLIER',
    });

    const departedAt = new Date();
    const delivery = inProgress
      ? await markDeparted(tx, inProgress.id, actor.personId, departedAt)
      : await insertDepartedDelivery(tx, {
          id: input.id,
          orderId,
          assignedToId: actor.personId,
          departedAt,
        });

    const recipientId = await findRegisteredCustomerRecipient(tx, orderId);
    if (recipientId !== null) {
      const language = await recipientLanguage(recipientId, tx);
      await notify(
        {
          recipientId,
          organizationId: actor.organizationId,
          sourceEvent: 'order.status_changed',
          content: language === 'EN' ? DEPARTED_CONTENT.EN : DEPARTED_CONTENT.FR,
          related: { type: 'order', id: orderId },
        },
        tx
      );
    }
    return { delivery: projectDelivery(delivery), order_status: 'IN_DELIVERY' };
  });
}

const FAILED_CONTENT = {
  FR: 'Une livraison a échoué.',
  EN: 'A delivery failed.',
} as const;

/**
 * The assigned DRIVER, or any MANAGER or OWNER, reports a delivery in progress as failed (DLV-006,
 * C-21, CM-12). One transaction (v5.0.0-2.3.3): the order of the delivery, found through the
 * caller's organization, is locked, so a parallel failure or arrival waits (v5.0.0-2.3.4). A
 * delivery of another business, or of another driver when the caller is a DRIVER, is 404, never
 * confirming it exists (v5.0.0-8.2.2). A delivery that is not departed, or already arrived or
 * failed, is refused (v5.0.0-2.3.1). The delivery gets `failed_at` and the reason, the order goes
 * back from IN_DELIVERY to CONFIRMED by a conditional update, and the owner and managers are
 * notified `delivery.failed`. Any refusal rolls everything back. Replays with the same `id` are
 * answered by `idempotent()`.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked `fail_delivery`.
 * @param deliveryId - Delivery from the path.
 * @param input - Validated body: gesture id and trimmed reason.
 * @returns The failed delivery and the new order status.
 * @throws 404 `NOT_FOUND` (delivery outside the business, or of another driver); 409
 * `INVALID_TRANSITION` (not departed, already arrived or failed, or order not IN_DELIVERY).
 */
export function failDelivery(
  actor: Actor,
  deliveryId: string,
  input: FailDeliveryInput
): Promise<{ delivery: FailedDeliveryView; order_status: 'CONFIRMED' }> {
  return runInTransaction(async (tx) => {
    const found = await lockDeliveryToFail(tx, deliveryId, actor.organizationId);
    const mayFailAny = actor.role === 'MANAGER' || actor.role === 'OWNER';
    if (!found || (!mayFailAny && found.assignedToId !== actor.personId)) {
      throw httpError(404, 'NOT_FOUND', 'Delivery not found.');
    }
    if (found.departedAt === null || found.arrivedAt !== null || found.failedAt !== null) {
      throw httpError(409, 'INVALID_TRANSITION', 'The delivery is not in progress.');
    }

    await transitionOrder(tx, found.orderId, 'CONFIRMED', {
      personId: actor.personId,
      party: 'SUPPLIER',
    });
    const delivery = await markFailed(tx, found.id, new Date(), input.reason);
    if (!delivery) throw httpError(409, 'INVALID_TRANSITION', 'The delivery is not in progress.');

    for (const recipientId of await listOwnerAndManagerIds(tx, actor.organizationId)) {
      const language = await recipientLanguage(recipientId, tx);
      await notify(
        {
          recipientId,
          organizationId: actor.organizationId,
          sourceEvent: 'delivery.failed',
          content: language === 'EN' ? FAILED_CONTENT.EN : FAILED_CONTENT.FR,
          related: { type: 'order', id: found.orderId },
        },
        tx
      );
    }
    return { delivery: projectFailedDelivery(delivery), order_status: 'CONFIRMED' };
  });
}

const DELIVERED_CONTENT = {
  FR: 'Votre commande a été livrée.',
  EN: 'Your order has been delivered.',
} as const;

/** Thousandths as the decimal text the database stores, always with 3 places. */
function formatQuantity(milli: bigint): string {
  return `${milli / 1000n}.${(milli % 1000n).toString().padStart(3, '0')}`;
}

export type DeliverResult = {
  order: DeliveredOrderView;
  sale: DeliveredEntryView;
  payment: DeliveredEntryView | null;
};

/**
 * The one gesture that closes an order, "Commande livrée" (DLV-007, CM-13, CM-15). One transaction
 * (v5.0.0-2.3.3): the order of the caller's organization is locked (another business's order is
 * 404, v5.0.0-8.2.2), then its customer relationship row is locked before the credit check, so
 * two deliveries for one customer cannot both pass it (v5.0.0-2.3.4, CWE-362). A DRIVER needs the
 * order IN_DELIVERY with a departed delivery of their own (another's is 404; any other status is
 * 409); a SELLER or above delivers a CONFIRMED order in the shop. Every line gets
 * `delivered_quantity` = `quantity`, line amounts and the order total are recomputed by the
 * server, and the SALE entry is the order total: the phone never sends it (v5.0.0-2.2.1). When
 * `collected_amount` is above 0 a PAYMENT entry of that amount is written with the mode. The
 * credit rule `balance + total - collected <= credit_limit` (null: no limit) is checked before
 * any write; a refusal names the smallest allowed collection and rolls everything back. Both
 * entries are recorded by the caller. The customer is notified `order.status_changed`. Replays
 * with the same `id` are answered by `idempotent()`.
 *
 * Partial delivery (DLV-008, CM-22): `lines` gives the delivered quantity of the listed lines
 * (parsed with `parseQuantity`, from 0 up to the ordered one); unlisted lines are fully delivered
 * and at least one line must be delivered above 0. When a line is short, `rest` is required:
 * `LATER` creates, in the same transaction, a CONFIRMED order linked by `parent_order_id` with one
 * line per short line at the original prices and price author, `ABANDON` creates nothing (the
 * order keeps its short lines). Sale and credit rule use the total of the delivered quantities.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked `deliver Order`.
 * @param orderId - Order from the path.
 * @param input - Validated body: gesture id, collected amount, mode and entry ids.
 * @param options - `viaSync` lets `transitionOrder` apply the sync judgment (delivery wins).
 * @returns The delivered order, the sale and the payment (null when nothing was collected).
 * @throws 404 `NOT_FOUND` (order outside the business, a DRIVER's order of another driver, or a line
 * of another order); 400 `VALIDATION_ERROR` (quantity above the ordered one, short line without
 * `rest`, nothing delivered); 409 `INVALID_TRANSITION` (status does not fit the caller's role);
 * 409 `CREDIT_INSUFFICIENT` with `details.min_collect`.
 */
export function deliverOrder(
  actor: Actor,
  orderId: string,
  input: DeliverInput,
  options: { viaSync?: boolean } = {}
): Promise<DeliverResult> {
  return runInTransaction(async (tx) => {
    const order = await lockOrderToDeliver(tx, orderId, actor.organizationId);
    if (!order) throw httpError(404, 'NOT_FOUND', 'Order not found.');

    const isDriver = actor.role === 'DRIVER';
    if (order.status !== (isDriver ? 'IN_DELIVERY' : 'CONFIRMED')) {
      throw httpError(409, 'INVALID_TRANSITION', `Order cannot be delivered from ${order.status}.`);
    }
    const inProgress = isDriver ? await findDeliveryInProgress(tx, orderId) : null;
    if (isDriver && (!inProgress?.departedAt || inProgress.assignedToId !== actor.personId)) {
      throw httpError(404, 'NOT_FOUND', 'Order not found.');
    }

    const relationship = await lockRelationshipForCredit(tx, order.customerRelationshipId);
    if (!relationship) throw httpError(404, 'NOT_FOUND', 'Order not found.');

    const lines = await listLiveLines(tx, orderId);
    const requested = new Map<string, bigint>();
    for (const entry of input.lines ?? []) {
      if (!lines.some((line) => line.id === entry.line_id)) {
        throw httpError(404, 'NOT_FOUND', 'Line not found.');
      }
      try {
        requested.set(entry.line_id, parseQuantity(String(entry.delivered_quantity)));
      } catch {
        throw httpError(400, 'VALIDATION_ERROR', 'Invalid delivered quantity.');
      }
    }
    const delivered = lines.map((line) => {
      const quantityMilli = parseQuantity(line.quantity.toFixed(3));
      const deliveredMilli = requested.get(line.id) ?? quantityMilli;
      if (deliveredMilli > quantityMilli) {
        throw httpError(400, 'VALIDATION_ERROR', 'Delivered quantity above the ordered one.');
      }
      const amount = lineAmountOf({
        quantityMilli,
        deliveredQuantityMilli: deliveredMilli,
        unitPriceApplied: line.unitPriceApplied,
      });
      return { line, quantityMilli, deliveredMilli, amount };
    });
    if (!delivered.some(({ deliveredMilli }) => deliveredMilli > 0n)) {
      throw httpError(400, 'VALIDATION_ERROR', 'At least one line must be delivered.');
    }
    const shortLines = delivered.filter(
      ({ deliveredMilli, quantityMilli }) => deliveredMilli < quantityMilli
    );
    if (shortLines.length > 0 && input.rest === undefined) {
      throw httpError(400, 'VALIDATION_ERROR', 'Say what happens to the rest.');
    }
    const total = orderTotal(
      delivered.map(({ amount }) => amount),
      order.deliveryCost
    );

    const collected = BigInt(input.collected_amount);
    if (
      relationship.creditLimit !== null &&
      relationship.balance + total - collected > relationship.creditLimit
    ) {
      const minCollect = relationship.balance + total - relationship.creditLimit;
      throw httpError(409, 'CREDIT_INSUFFICIENT', 'The credit limit would be exceeded.', {
        min_collect: Number(minCollect),
      });
    }

    for (const { line, deliveredMilli, amount } of delivered) {
      await setLineDelivered(tx, line.id, formatQuantity(deliveredMilli), amount);
    }
    await setOrderTotal(tx, orderId, total);
    const closed = await transitionOrder(
      tx,
      orderId,
      'DELIVERED',
      { personId: actor.personId, party: 'SUPPLIER' },
      {},
      { viaSync: options.viaSync }
    );
    if (inProgress && !(await markArrived(tx, inProgress.id, closed.deliveredAt ?? new Date()))) {
      throw httpError(409, 'INVALID_TRANSITION', 'The delivery is not in progress.');
    }

    if (input.rest === 'LATER' && shortLines.length > 0) {
      const restLines = shortLines.map(({ line, quantityMilli, deliveredMilli }) => {
        const remaining = quantityMilli - deliveredMilli;
        return {
          id: newId(),
          productId: line.productId,
          labelApplied: line.labelApplied,
          quantity: formatQuantity(remaining),
          referencePrice: line.referencePrice,
          unitPriceApplied: line.unitPriceApplied,
          amount: lineAmountOf({
            quantityMilli: remaining,
            unitPriceApplied: line.unitPriceApplied,
          }),
          priceSetById: line.priceSetById,
          priceSetAt: line.priceSetAt,
        };
      });
      await insertRestOrder(tx, {
        id: newId(),
        parentOrderId: orderId,
        customerRelationshipId: order.customerRelationshipId,
        enteredById: actor.personId,
        deliveryAddressApplied: order.deliveryAddress,
        totalAmount: orderTotal(
          restLines.map(({ amount }) => amount),
          0n
        ),
        lines: restLines,
      });
    }

    const occurredAt = new Date();
    const sale = await appendLedgerEntry(tx, {
      id: input.sale_entry_id,
      relationshipId: relationship.id,
      kind: 'SALE',
      amount: closed.totalAmount,
      orderId,
      recordedById: actor.personId,
      organizationId: actor.organizationId,
      occurredAt,
    });
    const payment =
      collected > 0n && input.mode !== undefined && input.payment_entry_id !== undefined
        ? await appendLedgerEntry(tx, {
            id: input.payment_entry_id,
            relationshipId: relationship.id,
            kind: 'PAYMENT',
            amount: collected,
            mode: input.mode,
            orderId,
            recordedById: actor.personId,
            organizationId: actor.organizationId,
            occurredAt,
          })
        : null;

    const recipientId = await findRegisteredCustomerRecipient(tx, orderId);
    if (recipientId !== null) {
      const language = await recipientLanguage(recipientId, tx);
      await notify(
        {
          recipientId,
          organizationId: actor.organizationId,
          sourceEvent: 'order.status_changed',
          content: language === 'EN' ? DELIVERED_CONTENT.EN : DELIVERED_CONTENT.FR,
          related: { type: 'order', id: orderId },
        },
        tx
      );
    }
    return {
      order: projectDeliveredOrder(closed),
      sale: projectDeliveredEntry(sale),
      payment: payment ? projectDeliveredEntry(payment) : null,
    };
  });
}
