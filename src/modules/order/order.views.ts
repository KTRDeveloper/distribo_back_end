import type { Order, OrderLine } from '@prisma/client';
import type { Role } from '../../shared/access/roles.js';

export type OrderWithLines = Order & { lines: OrderLine[] };

type PartyView = {
  id: string;
  customer_relationship_id: string;
  placed_by_party: string;
  delivery_address_applied: string | null;
  total_amount: number;
  delivery_cost: number;
  status: string;
  delivered_at: string | null;
  created_at: string;
  desired_delivery_date: string | null;
  cancelled_by_party: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  parent_order_id: string | null;
  customer_note: string | null;
  supplier_note: string | null;
};

export type OrderLineView = {
  id: string;
  product_variant_id: string;
  label_applied: string;
  quantity: string;
  delivered_quantity: string | null;
  reference_price: number;
  unit_price_applied: number;
  amount: number;
  price_set_by_id?: string | null;
  price_set_at?: string | null;
};

export type SupplierOrderView = PartyView & {
  entered_by_id: string;
  delivered_by_id: string | null;
  cancelled_by_id: string | null;
  sync_issue: string | null;
  lines: OrderLineView[];
};

export type CustomerOrderView = PartyView & { lines: OrderLineView[] };

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

/** Fields both parties see, listed one by one (v5.0.0-15.3.1: never a whole row). */
function commonFields(order: Order): PartyView {
  return {
    id: order.id,
    customer_relationship_id: order.customerRelationshipId,
    placed_by_party: order.placedByParty,
    delivery_address_applied: order.deliveryAddressApplied,
    total_amount: Number(order.totalAmount),
    delivery_cost: Number(order.deliveryCost),
    status: order.status,
    delivered_at: iso(order.deliveredAt),
    created_at: order.createdAt.toISOString(),
    desired_delivery_date: order.desiredDeliveryDate
      ? order.desiredDeliveryDate.toISOString().slice(0, 10)
      : null,
    cancelled_by_party: order.cancelledByParty,
    cancelled_at: iso(order.cancelledAt),
    cancellation_reason: order.cancellationReason,
    parent_order_id: order.parentOrderId,
    customer_note: order.customerNote,
    supplier_note: order.supplierNote,
  };
}

/** Line fields both parties see; both prices stay visible so a gap shows. */
function commonLine(line: OrderLine): OrderLineView {
  return {
    id: line.id,
    product_variant_id: line.productVariantId,
    label_applied: line.labelApplied,
    quantity: line.quantity.toString(),
    delivered_quantity: line.deliveredQuantity === null ? null : line.deliveredQuantity.toString(),
    reference_price: Number(line.referencePrice),
    unit_price_applied: Number(line.unitPriceApplied),
    amount: Number(line.amount),
  };
}

/**
 * Supplier-side view: all order fields plus `sync_issue`. The price author and time on
 * each line go only to OWNER and MANAGER; any other or unknown role gets neither
 * (v5.0.0-8.2.3, fail closed).
 *
 * @param order - the order with its lines
 * @param role - the caller's role in the supplier organization, from the session
 */
export function projectOrderForSupplier(order: OrderWithLines, role: Role): SupplierOrderView {
  const seesPriceAuthor = role === 'OWNER' || role === 'MANAGER';
  return {
    ...commonFields(order),
    entered_by_id: order.enteredById,
    delivered_by_id: order.deliveredById,
    cancelled_by_id: order.cancelledById,
    sync_issue: order.syncIssue,
    lines: order.lines.map((line) => ({
      ...commonLine(line),
      ...(seesPriceAuthor
        ? { price_set_by_id: line.priceSetById, price_set_at: iso(line.priceSetAt) }
        : {}),
    })),
  };
}

/**
 * Customer-side view: no supplier-team person id (entered, delivered, cancelled, price
 * author), no sync issue. `placed_by_party` and `cancelled_by_party` stay.
 */
export function projectOrderForCustomer(order: OrderWithLines): CustomerOrderView {
  return { ...commonFields(order), lines: order.lines.map(commonLine) };
}
