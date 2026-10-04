import type { Order, OrderStatus, Prisma } from '@prisma/client';

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
