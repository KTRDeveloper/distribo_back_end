import type { Delivery, Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import { resolveMergedRelation } from '../relationship/relationship.repository.js';
import { visibleRelationsWhere } from '../relationship/relationship.visibility.js';
import type { DeliveryForDriver, OrderForDriver } from './delivery.views.js';

type Viewer = { personId: string; organizationId: string };

/** Customer parties and live lines of an order, as `projectForDriver` and the driver view need. */
const orderInclude = {
  lines: { where: { deletedAt: null }, orderBy: { id: 'asc' } },
  customerRelationship: {
    include: {
      customerPerson: true,
      customerOrganization: { select: { name: true, description: true } },
    },
  },
} satisfies Prisma.OrderInclude;

/**
 * The orders whose customer relationship is visible to the viewer and has the viewer's organization
 * as supplier: the query starts from the actor's organization (v5.0.0-8.2.2).
 */
function supplierScope(viewer: Viewer): Prisma.OrderWhereInput {
  return {
    deletedAt: null,
    customerRelationship: {
      is: {
        AND: [
          visibleRelationsWhere({
            personId: viewer.personId,
            organizationIds: [viewer.organizationId],
          }),
          { supplierOrganizationId: viewer.organizationId },
        ],
      },
    },
  };
}

/**
 * Reads a page of the CONFIRMED orders of the viewer's organization that have an applied delivery
 * address, newest first. Every driver of the organization sees the same pool.
 *
 * @param viewer - Person and organization from the loaded actor, never from the client.
 * @param query - Page size and opaque cursor.
 * @returns Orders (at most limit) and the next cursor or null.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listToDeliverOrders(
  viewer: Viewer,
  query: { limit: number; cursor?: string }
): Promise<{ rows: OrderForDriver[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const and: Prisma.OrderWhereInput[] = [
    supplierScope(viewer),
    { status: 'CONFIRMED', deliveryAddressApplied: { not: null } },
  ];
  if (cursor) {
    and.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: cursor.id } },
      ],
    });
  }
  const found = await prisma.order.findMany({
    where: { AND: and },
    include: orderInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const rows = found.slice(0, query.limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

function statusWhere(status: 'in_progress' | 'done' | 'failed'): Prisma.DeliveryWhereInput {
  if (status === 'done') return { arrivedAt: { not: null } };
  if (status === 'failed') return { failedAt: { not: null } };
  return { arrivedAt: null, failedAt: null };
}

/**
 * Reads a page of the caller's own deliveries for orders of the viewer's organization. A delivery
 * has no creation time of its own: the list follows the order's creation time, newest first, then
 * the delivery id, and the cursor carries that pair.
 *
 * @param viewer - Person and organization from the loaded actor; the driver is always the caller.
 * @param query - Page size, opaque cursor and optional status.
 * @returns Deliveries with their order (at most limit) and the next cursor or null.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listOwnDeliveries(
  viewer: Viewer,
  query: { limit: number; cursor?: string; status?: 'in_progress' | 'done' | 'failed' }
): Promise<{ rows: DeliveryForDriver[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const and: Prisma.DeliveryWhereInput[] = [
    { assignedToId: viewer.personId, deletedAt: null, order: { is: supplierScope(viewer) } },
  ];
  if (query.status) and.push(statusWhere(query.status));
  if (cursor) {
    and.push({
      OR: [
        { order: { is: { createdAt: { lt: cursor.createdAt } } } },
        { order: { is: { createdAt: cursor.createdAt } }, id: { gt: cursor.id } },
      ],
    });
  }
  const found = await prisma.delivery.findMany({
    where: { AND: and },
    include: { order: { include: orderInclude } },
    orderBy: [{ order: { createdAt: 'desc' } }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const rows = found.slice(0, query.limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor:
      found.length > query.limit && last
        ? encodeCursor({ createdAt: last.order.createdAt, id: last.id })
        : null,
  };
}

/** Runs the writes of one gesture in a single transaction. */
export function runInTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(work);
}

/**
 * Locks one order of the supplier organization until the transaction ends, so two parallel
 * assignments of the same order wait for each other (v5.0.0-2.3.4), and returns the fields the
 * assignment checks. The order is selected through the relationship of the caller's organization,
 * never through an organization sent by the client (v5.0.0-8.2.2).
 *
 * @returns the order status and applied address, or null when the order is outside the supplier
 */
export async function lockOrderToAssign(
  tx: Prisma.TransactionClient,
  orderId: string,
  supplierOrganizationId: string
): Promise<{ status: string; deliveryAddress: string | null } | null> {
  const rows = await tx.$queryRaw<
    Array<{ status: string; delivery_address_applied: string | null }>
  >`
    SELECT o.status::text AS status, o.delivery_address_applied
    FROM orders o
    JOIN customer_relationships r ON r.id = o.customer_relationship_id
    WHERE o.id = ${orderId}::uuid
      AND r.supplier_organization_id = ${supplierOrganizationId}::uuid
      AND o.deleted_at IS NULL
    FOR UPDATE OF o
  `;
  const row = rows[0];
  return row ? { status: row.status, deliveryAddress: row.delivery_address_applied } : null;
}

/** The delivery of the order in progress (neither arrived nor failed, not deleted), if any. */
export function findDeliveryInProgress(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<Delivery | null> {
  return tx.delivery.findFirst({
    where: { orderId, arrivedAt: null, failedAt: null, deletedAt: null },
  });
}

/**
 * Tells whether the person is an ACTIVE collaborator of the organization, whatever the role, and a
 * registered person (a guest has no account to notify).
 */
export async function isActiveCollaborator(
  tx: Prisma.TransactionClient,
  personId: string,
  organizationId: string
): Promise<boolean> {
  const found = await tx.collaboration.findFirst({
    where: {
      personId,
      organizationId,
      status: 'ACTIVE',
      deletedAt: null,
      person: { is: { registeredAt: { not: null } } },
    },
    select: { id: true },
  });
  return found !== null;
}

/** Inserts a delivery for the order, not departed. */
export function insertDelivery(
  tx: Prisma.TransactionClient,
  data: { id: string; orderId: string; assignedToId: string }
): Promise<Delivery> {
  return tx.delivery.create({ data });
}

/** Gives a not-yet-departed delivery to another driver (same row). */
export function reassignDelivery(
  tx: Prisma.TransactionClient,
  id: string,
  assignedToId: string
): Promise<Delivery> {
  return tx.delivery.update({ where: { id }, data: { assignedToId } });
}

/**
 * Marks a delivery departed now and gives it to the person leaving with the order (the assigned
 * driver, or the MANAGER or OWNER who takes it over). The row is the one found under the order lock.
 */
export function markDeparted(
  tx: Prisma.TransactionClient,
  id: string,
  assignedToId: string,
  departedAt: Date
): Promise<Delivery> {
  return tx.delivery.update({ where: { id }, data: { assignedToId, departedAt } });
}

/** Inserts a delivery for the order that departs at once. */
export function insertDepartedDelivery(
  tx: Prisma.TransactionClient,
  data: { id: string; orderId: string; assignedToId: string; departedAt: Date }
): Promise<Delivery> {
  return tx.delivery.create({ data });
}

/**
 * The person to tell an order changed status: the relationship's person or, for a business
 * customer, whoever entered the order; null when that person is a guest with no account.
 */
export async function findRegisteredCustomerRecipient(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<string | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      enteredById: true,
      customerRelationship: { select: { customerPersonId: true } },
    },
  });
  if (!order) return null;
  const recipientId = order.customerRelationship.customerPersonId ?? order.enteredById;
  const person = await tx.person.findFirst({
    where: { id: recipientId, registeredAt: { not: null } },
    select: { id: true },
  });
  return person ? recipientId : null;
}

/** The fields of a delivery the failure gesture checks, read under the order lock. */
export type DeliveryToFail = {
  id: string;
  orderId: string;
  assignedToId: string;
  departedAt: Date | null;
  arrivedAt: Date | null;
  failedAt: Date | null;
};

/**
 * Locks the order of a delivery, then reads the delivery, until the transaction ends, so a parallel
 * failure, arrival or departure of the same order waits for this one (v5.0.0-2.3.4). The delivery
 * is selected through the relationship of the caller's organization, never through an organization
 * sent by the client, so a delivery of another business is simply not found (v5.0.0-8.2.2).
 *
 * @returns the delivery, or null when it is absent, deleted or outside the supplier
 */
export async function lockDeliveryToFail(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  supplierOrganizationId: string
): Promise<DeliveryToFail | null> {
  const owned = await tx.$queryRaw<Array<{ order_id: string }>>`
    SELECT o.id AS order_id
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN customer_relationships r ON r.id = o.customer_relationship_id
    WHERE d.id = ${deliveryId}::uuid
      AND r.supplier_organization_id = ${supplierOrganizationId}::uuid
      AND d.deleted_at IS NULL
      AND o.deleted_at IS NULL
    FOR UPDATE OF o
  `;
  if (!owned[0]) return null;
  return tx.delivery.findFirst({
    where: { id: deliveryId, deletedAt: null },
    select: {
      id: true,
      orderId: true,
      assignedToId: true,
      departedAt: true,
      arrivedAt: true,
      failedAt: true,
    },
  });
}

/**
 * Marks a delivery in progress as failed, conditionally on it being neither arrived nor failed
 * (v5.0.0-2.3.1).
 *
 * @returns the delivery after the update, or null when it was no longer in progress
 */
export async function markFailed(
  tx: Prisma.TransactionClient,
  id: string,
  failedAt: Date,
  failureReason: string
): Promise<Delivery | null> {
  const { count } = await tx.delivery.updateMany({
    where: { id, arrivedAt: null, failedAt: null, deletedAt: null },
    data: { failedAt, failureReason },
  });
  if (count !== 1) return null;
  return tx.delivery.findUniqueOrThrow({ where: { id } });
}

/** Lists the registered people holding an ACTIVE OWNER or MANAGER role in the business. */
export async function listOwnerAndManagerIds(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<string[]> {
  const found = await tx.collaboration.findMany({
    where: {
      organizationId,
      role: { in: ['OWNER', 'MANAGER'] },
      status: 'ACTIVE',
      deletedAt: null,
      person: { registeredAt: { not: null } },
    },
    select: { personId: true },
    orderBy: { personId: 'asc' },
  });
  return found.map((collaboration) => collaboration.personId);
}

/** The fields of an order the deliver gesture checks, read under the order lock. */
export type OrderToDeliver = {
  status: string;
  customerRelationshipId: string;
  deliveryCost: bigint;
  deliveryAddress: string | null;
};

/**
 * Locks one order of the supplier organization until the transaction ends, so two parallel
 * closings, departures or failures of the order wait for each other (v5.0.0-2.3.4). The order is
 * selected through the relationship of the caller's organization, never through an organization
 * sent by the client (v5.0.0-8.2.2).
 *
 * @returns the order fields, or null when the order is outside the supplier
 */
export async function lockOrderToDeliver(
  tx: Prisma.TransactionClient,
  orderId: string,
  supplierOrganizationId: string
): Promise<OrderToDeliver | null> {
  const rows = await tx.$queryRaw<
    Array<{
      status: string;
      customer_relationship_id: string;
      delivery_cost: bigint;
      delivery_address_applied: string | null;
    }>
  >`
    SELECT o.status::text AS status, o.customer_relationship_id, o.delivery_cost,
      o.delivery_address_applied
    FROM orders o
    JOIN customer_relationships r ON r.id = o.customer_relationship_id
    WHERE o.id = ${orderId}::uuid
      AND r.supplier_organization_id = ${supplierOrganizationId}::uuid
      AND o.deleted_at IS NULL
    FOR UPDATE OF o
  `;
  const row = rows[0];
  return row
    ? {
        status: row.status,
        customerRelationshipId: row.customer_relationship_id,
        deliveryCost: row.delivery_cost,
        deliveryAddress: row.delivery_address_applied,
      }
    : null;
}

/**
 * Locks the live relationship an order belongs to (following a merge to the surviving row) until
 * the transaction ends, then reads its balance and credit limit. Two deliveries of one customer
 * wait for each other here, so the second sees the first's balance (v5.0.0-2.3.4, CWE-362).
 *
 * @returns the relationship id the ledger writes on, its balance and its limit (null: no limit),
 * or null when the relationship is deleted
 */
export async function lockRelationshipForCredit(
  tx: Prisma.TransactionClient,
  relationshipId: string
): Promise<{ id: string; balance: bigint; creditLimit: bigint | null } | null> {
  const id = await resolveMergedRelation(relationshipId, tx);
  const rows = await tx.$queryRaw<Array<{ balance: bigint; credit_limit: bigint | null }>>`
    SELECT balance, credit_limit
    FROM customer_relationships
    WHERE id = ${id}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `;
  const row = rows[0];
  return row ? { id, balance: row.balance, creditLimit: row.credit_limit } : null;
}

/** The live lines of an order, in a stable order. */
export function listLiveLines(tx: Prisma.TransactionClient, orderId: string) {
  return tx.orderLine.findMany({
    where: { orderId, deletedAt: null },
    orderBy: { id: 'asc' },
  });
}

/** Sets a line's delivered quantity and its amount, computed by the caller (CM-14). */
export async function setLineDelivered(
  tx: Prisma.TransactionClient,
  id: string,
  deliveredQuantity: string,
  amount: bigint
): Promise<void> {
  await tx.orderLine.update({ where: { id }, data: { deliveredQuantity, amount } });
}

/** A line of the order made for the undelivered rest, its amount computed by the caller. */
export type RestLine = {
  productId: string;
  labelApplied: string;
  quantity: string;
  referencePrice: bigint;
  unitPriceApplied: bigint;
  amount: bigint;
  priceSetById: string | null;
  priceSetAt: Date | null;
};

/**
 * Inserts the CONFIRMED order for the undelivered rest of a partially delivered order, with its
 * lines (CM-22). Placed by the SUPPLIER party, linked to its parent, with no delivery cost; the
 * caller computes every amount and the database checks the total at commit (ORD-006).
 */
export async function insertRestOrder(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    parentOrderId: string;
    customerRelationshipId: string;
    enteredById: string;
    deliveryAddressApplied: string | null;
    totalAmount: bigint;
    lines: Array<RestLine & { id: string }>;
  }
): Promise<void> {
  const { lines, ...order } = data;
  await tx.order.create({
    data: {
      ...order,
      placedByParty: 'SUPPLIER',
      status: 'CONFIRMED',
      deliveryCost: 0n,
      lines: { create: lines },
    },
  });
}

/** Sets the order total, computed by the server from the line amounts (C-19). */
export async function setOrderTotal(
  tx: Prisma.TransactionClient,
  orderId: string,
  totalAmount: bigint
): Promise<void> {
  await tx.order.update({ where: { id: orderId }, data: { totalAmount } });
}

/**
 * Marks a delivery in progress as arrived, conditionally on it being neither arrived nor failed
 * (v5.0.0-2.3.1).
 *
 * @returns true when the delivery was updated
 */
export async function markArrived(
  tx: Prisma.TransactionClient,
  id: string,
  arrivedAt: Date
): Promise<boolean> {
  const { count } = await tx.delivery.updateMany({
    where: { id, arrivedAt: null, failedAt: null, deletedAt: null },
    data: { arrivedAt },
  });
  return count === 1;
}
