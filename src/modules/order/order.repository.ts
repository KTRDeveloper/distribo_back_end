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
