import type { Delivery, Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { decodeCursor, encodeCursor } from '../../shared/pagination.js';
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
