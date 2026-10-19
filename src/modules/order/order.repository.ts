import { Prisma, type Order, type OrderStatus } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
import { visibleRelationsWhere } from '../relationship/relationship.visibility.js';
import type { OrderWithLines } from './order.views.js';

/** Columns a status step may write; everything else on an order is left alone. */
export type StatusStepData = Prisma.OrderUncheckedUpdateManyInput;

/**
 * Applies a status step only if the order is still in one of `fromStatuses`.
 *
 * One conditional UPDATE decides the step, never a read followed by a write, so two
 * parallel steps cannot both succeed (v5.0.0-2.3.1, v5.0.0-2.3.4). The second one waits for
 * the row lock, re-reads the new status and updates nothing.
 *
 * @returns the number of rows updated: 1 when the step was applied, 0 otherwise.
 */
export async function updateStatusIfIn(
  tx: Prisma.TransactionClient,
  orderId: string,
  fromStatuses: readonly OrderStatus[],
  data: StatusStepData
): Promise<number> {
  const result = await tx.order.updateMany({
    where: { id: orderId, status: { in: [...fromStatuses] } },
    data,
  });
  return result.count;
}

/** Reads an order inside the caller's transaction (sees its own updates). */
export function findOrderById(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<Order | null> {
  return tx.order.findUnique({ where: { id: orderId } });
}

/** The reason stored on every order refused because its business closed (CM-10). */
export const BUSINESS_CLOSED_REASON = 'Commerce fermé';

export type PendingOrderCustomer = {
  orderId: string;
  customerPersonId: string;
  customerRegistered: boolean;
};

/**
 * Locks the PENDING orders of a supplier organization until the transaction ends and returns who
 * to tell, so a parallel confirmation or cancellation waits and the later refusal matches exactly
 * these rows (v5.0.0-2.3.4).
 *
 * @param organizationId the supplier organization, from the loaded actor
 */
export async function lockPendingOrders(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<PendingOrderCustomer[]> {
  const rows = await tx.$queryRaw<
    Array<{ order_id: string; customer_person_id: string; registered: boolean }>
  >`
    SELECT o.id AS order_id, r.customer_person_id, (p.registered_at IS NOT NULL) AS registered
    FROM orders o
    JOIN customer_relationships r ON r.id = o.customer_relationship_id
    JOIN people p ON p.id = r.customer_person_id
    WHERE r.supplier_organization_id = ${organizationId}::uuid
      AND o.status = 'PENDING'::public."OrderStatus"
      AND o.deleted_at IS NULL
    ORDER BY o.id
    FOR UPDATE OF o
  `;
  return rows.map((row) => ({
    orderId: row.order_id,
    customerPersonId: row.customer_person_id,
    customerRegistered: row.registered,
  }));
}

/**
 * Refuses every PENDING order of a supplier organization: CANCELLED by the SUPPLIER party, the
 * given person and the reason "Commerce fermé" (CM-10). The same step as `transitionOrder`
 * PENDING to CANCELLED, applied in one conditional UPDATE for the whole business.
 *
 * @param byPersonId the owner who closes the business, from the loaded actor
 * @returns the number of orders refused
 */
export async function refusePendingOrders(
  tx: Prisma.TransactionClient,
  organizationId: string,
  byPersonId: string
): Promise<number> {
  const result = await tx.order.updateMany({
    where: {
      status: 'PENDING',
      deletedAt: null,
      customerRelationship: { supplierOrganizationId: organizationId },
    },
    data: {
      status: 'CANCELLED',
      cancelledByParty: 'SUPPLIER',
      cancelledById: byPersonId,
      cancelledAt: new Date(),
      cancellationReason: BUSINESS_CLOSED_REASON,
    },
  });
  return result.count;
}

/**
 * Runs `work` in one database transaction, so the relationship, the order, its lines and the
 * notifications of one gesture commit or fail together (v5.0.0-2.3.3).
 */
export function runInTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(work);
}

export type NewOrderLine = {
  id: string;
  productId: string;
  productVariantId: string;
  labelApplied: string;
  quantity: string;
  referencePrice: bigint;
  unitPriceApplied: bigint;
  amount: bigint;
  priceSetById?: string;
  priceSetAt?: Date;
};

/**
 * Inserts a PENDING order placed by the customer, with its lines, and returns it with the lines.
 * The caller computes every amount; the total is checked by the database at commit (ORD-006).
 */
export function insertPendingOrder(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    customerRelationshipId: string;
    enteredById: string;
    deliveryAddressApplied: string | null;
    desiredDeliveryDate: Date | null;
    customerNote: string | null;
    totalAmount: bigint;
    lines: NewOrderLine[];
  }
): Promise<OrderWithLines> {
  const { lines, ...order } = data;
  return tx.order.create({
    data: {
      ...order,
      placedByParty: 'CUSTOMER',
      status: 'PENDING',
      deliveryCost: 0n,
      lines: { create: lines },
    },
    include: { lines: true },
  });
}

/**
 * Inserts a CONFIRMED order entered by the supplier's team (ORD-013), with its lines, and returns
 * it with the lines. Placed by the SUPPLIER party (C-17); the caller computes every amount and the
 * total is checked by the database at commit (ORD-006).
 */
export function insertConfirmedOrder(
  tx: Prisma.TransactionClient,
  data: {
    id: string;
    customerRelationshipId: string;
    enteredById: string;
    deliveryAddressApplied: string | null;
    deliveryCost: bigint;
    desiredDeliveryDate: Date | null;
    customerNote: string | null;
    totalAmount: bigint;
    lines: NewOrderLine[];
  }
): Promise<OrderWithLines> {
  const { lines, ...order } = data;
  return tx.order.create({
    data: { ...order, placedByParty: 'SUPPLIER', status: 'CONFIRMED', lines: { create: lines } },
    include: { lines: true },
  });
}

/** Lists the registered people holding an ACTIVE OWNER, MANAGER or SELLER role in the business. */
export async function listOrderTeamIds(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<string[]> {
  const found = await tx.collaboration.findMany({
    where: {
      organizationId,
      role: { in: ['OWNER', 'MANAGER', 'SELLER'] },
      status: 'ACTIVE',
      deletedAt: null,
      person: { registeredAt: { not: null } },
    },
    select: { personId: true },
    orderBy: { personId: 'asc' },
  });
  return found.map((collaboration) => collaboration.personId);
}

/**
 * Locks one order of a supplier organization until the transaction ends, so a parallel accept,
 * refusal or cancellation waits for this one (v5.0.0-2.3.4). The supplier is read from the order's
 * relationship, never from the request, so an order of another business is simply not found
 * (v5.0.0-8.2.2).
 *
 * @param supplierOrganizationId the caller's organization, from the loaded actor
 * @returns true when the undeleted order exists and belongs to that supplier
 */
export async function lockSupplierOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  supplierOrganizationId: string
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT o.id
    FROM orders o
    JOIN customer_relationships r ON r.id = o.customer_relationship_id
    WHERE o.id = ${orderId}::uuid
      AND r.supplier_organization_id = ${supplierOrganizationId}::uuid
      AND o.deleted_at IS NULL
    FOR UPDATE OF o
  `;
  return rows.length === 1;
}

/**
 * Locks one order of the caller's own customer relationship until the transaction ends, so a
 * parallel cancellation waits for this one (v5.0.0-2.3.4). The order is selected through the
 * relationship whose customer is the caller's person, or the caller's organization when
 * `organizationId` is given, never through an id from the request (v5.0.0-8.2.2).
 *
 * @param customer the caller, from the session; `organizationId` set means a business purchase
 * @returns the supplier organization of the order, or null when the order is not the caller's
 */
export async function lockCustomerOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  customer: { personId: string; organizationId?: string }
): Promise<{ supplierOrganizationId: string } | null> {
  const rows = await tx.$queryRaw<Array<{ supplier_organization_id: string }>>`
    SELECT r.supplier_organization_id
    FROM orders o
    JOIN customer_relationships r ON r.id = o.customer_relationship_id
    WHERE o.id = ${orderId}::uuid
      AND o.deleted_at IS NULL
      AND ${
        customer.organizationId === undefined
          ? Prisma.sql`r.customer_person_id = ${customer.personId}::uuid`
          : Prisma.sql`r.customer_organization_id = ${customer.organizationId}::uuid`
      }
    FOR UPDATE OF o
  `;
  const row = rows[0];
  return row ? { supplierOrganizationId: row.supplier_organization_id } : null;
}

/** An order with its undeleted lines (by id) and the customer person of its relationship. */
export type OrderToAccept = OrderWithLines & { customerPersonId: string | null };

/** Reads an order with its undeleted lines inside the caller's transaction. */
export async function findOrderToAccept(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<OrderToAccept | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      lines: { where: { deletedAt: null }, orderBy: { id: 'asc' } },
      customerRelationship: { select: { customerPersonId: true } },
    },
  });
  if (!order) return null;
  const { customerRelationship, ...rest } = order;
  return { ...rest, customerPersonId: customerRelationship.customerPersonId };
}

/**
 * Lowers one line's price: the new price, the matching amount and the author and time of the change
 * (C-20: both are set exactly when the applied price differs from the reference price).
 */
export async function setLinePrice(
  tx: Prisma.TransactionClient,
  lineId: string,
  data: { unitPriceApplied: bigint; amount: bigint; priceSetById: string; priceSetAt: Date }
): Promise<void> {
  await tx.orderLine.update({ where: { id: lineId }, data });
}

/** Writes the recomputed total; it must agree with the line amounts at commit (ORD-006). */
export async function setOrderTotal(
  tx: Prisma.TransactionClient,
  orderId: string,
  totalAmount: bigint
): Promise<void> {
  await tx.order.update({ where: { id: orderId }, data: { totalAmount } });
}

/** Tells whether the person is registered (a guest has no account to notify). */
export async function isRegisteredPerson(
  tx: Prisma.TransactionClient,
  personId: string
): Promise<boolean> {
  const person = await tx.person.findFirst({
    where: { id: personId, registeredAt: { not: null } },
    select: { id: true },
  });
  return person !== null;
}

/**
 * Writes the edited columns of an order and its recomputed total in one update (ORD-014). Only the
 * listed keys are written; a key left out keeps its value. The caller has already checked that the
 * order is CONFIRMED and placed by the supplier, under the row lock.
 */
export async function updateEditableOrderFields(
  tx: Prisma.TransactionClient,
  orderId: string,
  data: {
    deliveryAddressApplied?: string | null;
    deliveryCost?: bigint;
    desiredDeliveryDate?: Date | null;
    customerNote?: string | null;
    totalAmount: bigint;
  }
): Promise<void> {
  await tx.order.update({ where: { id: orderId }, data });
}

/**
 * Tells which of the given line ids already belong to the order, deleted or not, because a line id
 * is a primary key and cannot be reused (ORD-014).
 */
export async function findExistingLineIds(
  tx: Prisma.TransactionClient,
  orderId: string,
  lineIds: string[]
): Promise<string[]> {
  const found = await tx.orderLine.findMany({
    where: { orderId, id: { in: lineIds } },
    select: { id: true },
  });
  return found.map((line) => line.id);
}

/**
 * Replaces the lines of an order: the undeleted ones get `deleted_at` and the new ones are inserted
 * (ORD-014). The caller writes the matching total in the same transaction, which the database
 * checks at commit (ORD-006).
 */
export async function replaceOrderLines(
  tx: Prisma.TransactionClient,
  orderId: string,
  lines: NewOrderLine[],
  now: Date
): Promise<void> {
  await tx.orderLine.updateMany({
    where: { orderId, deletedAt: null },
    data: { deletedAt: now },
  });
  await tx.orderLine.createMany({ data: lines.map((line) => ({ ...line, orderId })) });
}

/**
 * Writes the supplier's note alone, whatever the order status: it is the one field a DELIVERED or
 * CANCELLED order still accepts (ORD-002). The caller holds the row lock.
 */
export async function updateSupplierNote(
  tx: Prisma.TransactionClient,
  orderId: string,
  supplierNote: string | null
): Promise<void> {
  await tx.order.update({ where: { id: orderId }, data: { supplierNote } });
}

/**
 * Lists the orders of the organization's customers, newest first (created_at descending then id),
 * keyset-paged, each with its undeleted lines. The query starts from the visibility predicate for
 * the organization and narrows it to the relationships where the organization is the supplier, so
 * a `customer_relationship_id` of another business matches nothing (v5.0.0-8.2.2, v5.0.0-8.4.1).
 *
 * @param viewer - Person and organization from the loaded actor, never from the client.
 * @param query - Page size, opaque cursor and optional status and customer relationship filters.
 * @returns Orders with lines (at most limit) and the next cursor or null.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listSupplierOrders(
  viewer: { personId: string; organizationId: string },
  query: {
    limit: number;
    cursor?: string;
    status?: OrderStatus;
    customer_relationship_id?: string;
  }
): Promise<{ rows: OrderWithLines[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const and: Prisma.OrderWhereInput[] = [
    { deletedAt: null },
    {
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
    },
  ];
  if (query.status) and.push({ status: query.status });
  if (query.customer_relationship_id) {
    and.push({ customerRelationshipId: query.customer_relationship_id });
  }
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
    include: { lines: { where: { deletedAt: null }, orderBy: { id: 'asc' } } },
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

/**
 * Reads one undeleted order of the organization's customers with its undeleted lines. The query
 * starts from the visibility predicate for the organization and narrows it to the relationships
 * where the organization is the supplier, so an order of another business is simply absent
 * (v5.0.0-8.2.2).
 *
 * @param viewer - Person and organization from the loaded actor, never from the client.
 * @param orderId - Order id from the path.
 * @returns The order with lines, or null when it is not visible to the organization.
 */
export function findSupplierOrder(
  viewer: { personId: string; organizationId: string },
  orderId: string
): Promise<OrderWithLines | null> {
  return prisma.order.findFirst({
    where: {
      id: orderId,
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
    },
    include: { lines: { where: { deletedAt: null }, orderBy: { id: 'asc' } } },
  });
}

/** Where clause of the orders the customer may see: the visibility predicate, narrowed to them as customer. */
function customerOrdersWhere(customer: {
  personId: string;
  organizationId?: string;
}): Prisma.CustomerRelationshipWhereInput {
  return {
    AND: [
      visibleRelationsWhere({
        personId: customer.personId,
        organizationIds: customer.organizationId === undefined ? [] : [customer.organizationId],
      }),
      customer.organizationId === undefined
        ? { customerPersonId: customer.personId }
        : { customerOrganizationId: customer.organizationId },
    ],
  };
}

/**
 * Lists the orders of the caller as customer, newest first (created_at descending then id),
 * keyset-paged, each with its undeleted lines. The query starts from the visibility predicate and
 * narrows it to the relationships where the caller (the person, or the organization of a purchase)
 * is the customer, so a `supplier_relationship_id` of someone else matches nothing
 * (v5.0.0-8.2.2, v5.0.0-8.4.1).
 *
 * @param customer - Person, and organization for a purchase, from the session; never the client.
 * @param query - Page size, opaque cursor and optional status and relationship filters.
 * @returns Orders with lines (at most limit) and the next cursor or null.
 * @throws 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listCustomerOrders(
  customer: { personId: string; organizationId?: string },
  query: {
    limit: number;
    cursor?: string;
    status?: OrderStatus;
    supplier_relationship_id?: string;
  }
): Promise<{ rows: OrderWithLines[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const and: Prisma.OrderWhereInput[] = [
    { deletedAt: null },
    { customerRelationship: { is: customerOrdersWhere(customer) } },
  ];
  if (query.status) and.push({ status: query.status });
  if (query.supplier_relationship_id) {
    and.push({ customerRelationshipId: query.supplier_relationship_id });
  }
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
    include: { lines: { where: { deletedAt: null }, orderBy: { id: 'asc' } } },
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

/**
 * Reads one undeleted order of the caller as customer with its undeleted lines. The query starts
 * from the visibility predicate narrowed to the caller as customer, so another customer's order is
 * simply absent (v5.0.0-8.2.2).
 *
 * @param customer - Person, and organization for a purchase, from the session; never the client.
 * @param orderId - Order id from the path.
 * @returns The order with lines, or null when it is not the caller's.
 */
export function findCustomerOrder(
  customer: { personId: string; organizationId?: string },
  orderId: string
): Promise<OrderWithLines | null> {
  return prisma.order.findFirst({
    where: {
      id: orderId,
      deletedAt: null,
      customerRelationship: { is: customerOrdersWhere(customer) },
    },
    include: { lines: { where: { deletedAt: null }, orderBy: { id: 'asc' } } },
  });
}

/**
 * Counts, per variant, the lines ordered from a supplier since a date, so billing can keep the
 * most ordered products when a plan runs out. Only undeleted lines of undeleted, non-CANCELLED
 * orders created at or after `since` count. The supplier is reached through the order's
 * relationship, and its id comes from server code, never from the client (v5.0.0-8.2.2).
 *
 * @param tx - Transaction client.
 * @param supplierOrganizationId - The supplier whose orders are counted.
 * @param since - Inclusive lower bound on the order's creation date.
 * @returns Variant id to line count; a variant with no line is absent.
 */
export async function countOrderedLinesByVariant(
  tx: Prisma.TransactionClient,
  supplierOrganizationId: string,
  since: Date
): Promise<Map<string, number>> {
  const rows = await tx.$queryRaw<Array<{ product_variant_id: string; line_count: number }>>`
    SELECT ol.product_variant_id::text AS product_variant_id, count(*)::int AS line_count
    FROM order_lines ol
    JOIN orders o ON o.id = ol.order_id
    JOIN customer_relationships cr ON cr.id = o.customer_relationship_id
    WHERE cr.supplier_organization_id = ${supplierOrganizationId}::uuid
      AND o.created_at >= ${since}
      AND o.deleted_at IS NULL
      AND o.status <> 'CANCELLED'::public."OrderStatus"
      AND ol.deleted_at IS NULL
    GROUP BY ol.product_variant_id
  `;
  return new Map(rows.map((row) => [row.product_variant_id, row.line_count]));
}

/**
 * Tells which of the given variants at least one order line cites, so the catalog never deletes a
 * variant the sales history needs (C-48). The state of the line or of its order does not matter: a
 * deleted line, a CANCELLED order or a deleted order still counts. The ids come from server code
 * that has already checked the organization (v5.0.0-8.2.2); only the variant column is read.
 *
 * @param tx - Transaction client.
 * @param variantIds - Variant ids to check; an empty list answers an empty set without a query.
 * @returns The subset of `variantIds` cited by at least one line.
 */
export async function listOrderedVariantIds(
  tx: Prisma.TransactionClient,
  variantIds: string[]
): Promise<Set<string>> {
  if (variantIds.length === 0) return new Set();
  const rows = await tx.$queryRaw<Array<{ product_variant_id: string }>>`
    SELECT DISTINCT ol.product_variant_id::text AS product_variant_id
    FROM order_lines ol
    WHERE ol.product_variant_id = ANY(${variantIds}::uuid[])
  `;
  return new Set(rows.map((row) => row.product_variant_id));
}
