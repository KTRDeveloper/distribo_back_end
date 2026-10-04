import type { Delivery, LedgerEntry, Order, OrderLine } from '@prisma/client';
import {
  projectForDriver,
  type DriverRelationshipView,
  type RelationshipRow,
} from '../relationship/relationship.visibility.js';

export type OrderForDriver = Order & { lines: OrderLine[]; customerRelationship: RelationshipRow };
export type DeliveryForDriver = Delivery & { order: OrderForDriver };

export type DriverLineView = {
  label: string;
  quantity: string;
  unit_price_applied: number;
  amount: number;
};

export type ToDeliverItem = {
  order_id: string;
  delivery_address: string | null;
  desired_delivery_date: string | null;
  customer_note: string | null;
  total_amount: number;
  lines: DriverLineView[];
  customer: DriverRelationshipView;
};

export type MyDeliveryItem = ToDeliverItem & {
  delivery_id: string;
  departed_at: string | null;
  arrived_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
};

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

/**
 * The order fields a driver needs, listed one by one (v5.0.0-15.3.1). The customer part comes only
 * from `projectForDriver`, so no balance, limit, note or ledger data can leave (v5.0.0-8.2.3).
 */
export function projectOrderForDriver(order: OrderForDriver): ToDeliverItem {
  return {
    order_id: order.id,
    delivery_address: order.deliveryAddressApplied,
    desired_delivery_date: order.desiredDeliveryDate
      ? order.desiredDeliveryDate.toISOString().slice(0, 10)
      : null,
    customer_note: order.customerNote,
    total_amount: Number(order.totalAmount),
    lines: order.lines.map((line) => ({
      label: line.labelApplied,
      quantity: line.quantity.toString(),
      unit_price_applied: Number(line.unitPriceApplied),
      amount: Number(line.amount),
    })),
    customer: projectForDriver(order.customerRelationship),
  };
}

/** A driver's own delivery: the order fields plus the delivery's own milestones. */
export function projectDeliveryForDriver(delivery: DeliveryForDriver): MyDeliveryItem {
  return {
    ...projectOrderForDriver(delivery.order),
    delivery_id: delivery.id,
    departed_at: iso(delivery.departedAt),
    arrived_at: iso(delivery.arrivedAt),
    failed_at: iso(delivery.failedAt),
    failure_reason: delivery.failureReason,
  };
}

export type DeliveryView = {
  id: string;
  order_id: string;
  assigned_to_id: string;
  departed_at: string | null;
};

/** The delivery fields the manager sees after assigning, listed one by one (v5.0.0-15.3.1). */
export function projectDelivery(delivery: Delivery): DeliveryView {
  return {
    id: delivery.id,
    order_id: delivery.orderId,
    assigned_to_id: delivery.assignedToId,
    departed_at: iso(delivery.departedAt),
  };
}

export type FailedDeliveryView = DeliveryView & {
  failed_at: string | null;
  failure_reason: string | null;
};

/** The delivery fields the driver sees after reporting a failure, listed one by one (v5.0.0-15.3.1). */
export function projectFailedDelivery(delivery: Delivery): FailedDeliveryView {
  return {
    ...projectDelivery(delivery),
    failed_at: iso(delivery.failedAt),
    failure_reason: delivery.failureReason,
  };
}

export type DeliveredOrderView = {
  id: string;
  status: string;
  total_amount: number;
  delivered_at: string | null;
};

export type DeliveredEntryView = {
  id: string;
  kind: string;
  amount: number;
  mode: string | null;
  order_id: string | null;
  occurred_at: string;
};

/** The order fields the closing gesture answers with, listed one by one (v5.0.0-15.3.1). */
export function projectDeliveredOrder(order: Order): DeliveredOrderView {
  return {
    id: order.id,
    status: order.status,
    total_amount: Number(order.totalAmount),
    delivered_at: iso(order.deliveredAt),
  };
}

/** The ledger entry fields the closing gesture answers with, listed one by one (v5.0.0-15.3.1). */
export function projectDeliveredEntry(entry: LedgerEntry): DeliveredEntryView {
  return {
    id: entry.id,
    kind: entry.kind,
    amount: Number(entry.amount),
    mode: entry.mode,
    order_id: entry.orderId,
    occurred_at: entry.occurredAt.toISOString(),
  };
}
