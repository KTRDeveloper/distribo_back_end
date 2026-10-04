import type { Expense, Handover, Prisma } from '@prisma/client';
import { addAmountHeld } from '../organization/organization.repository.js';

export type ExpenseInput = {
  id: string;
  organizationId: string;
  paidById: string;
  amount: bigint;
  category?: string;
  description?: string;
  recordedById: string;
  occurredAt: Date;
};

/**
 * Stores an expense and lowers the payer's held money by its amount (CM-17, C-27), inside the
 * caller's transaction so the two commit or fail together (ASVS v5.0.0-2.3.3). The caller checks
 * the role, the organization state and that the payer is a collaborator; if the payer's
 * collaboration cannot take the update, `addAmountHeld` throws 404 and the insert rolls back.
 *
 * @param tx - The gesture's transaction.
 * @param input - Expense fields; `recordedById` is the caller, never a body field.
 * @returns The stored expense.
 * @throws 404 `NOT_FOUND` when the payer's held money cannot be lowered.
 */
export async function recordExpenseInTx(
  tx: Prisma.TransactionClient,
  input: ExpenseInput
): Promise<Expense> {
  const expense = await tx.expense.create({
    data: {
      id: input.id,
      organizationId: input.organizationId,
      paidById: input.paidById,
      amount: input.amount,
      category: input.category ?? null,
      description: input.description ?? null,
      recordedById: input.recordedById,
      occurredAt: input.occurredAt,
    },
  });
  await addAmountHeld(tx, input.paidById, input.organizationId, -input.amount);
  return expense;
}

/**
 * Cancels an expense once and gives its amount back to the payer's held money (CM-17, C-27), inside
 * the caller's transaction (ASVS v5.0.0-2.3.3). The cancellation is one conditional update: it
 * matches only a live expense of the organization that is not cancelled yet, so two parallel
 * cancels cannot both succeed and the money is restored once (CWE-362). If the payer's
 * collaboration cannot take the update, `addAmountHeld` throws 404 and the cancellation rolls back.
 *
 * @param tx - The gesture's transaction.
 * @param input - Expense and organization from the path and the session, canceller from the session.
 * @returns The cancelled expense, or null when no live, uncancelled expense of the organization matches.
 * @throws 404 `NOT_FOUND` when the payer's held money cannot be restored.
 */
export async function cancelExpenseInTx(
  tx: Prisma.TransactionClient,
  input: { expenseId: string; organizationId: string; cancelledById: string }
): Promise<Expense | null> {
  const { count } = await tx.expense.updateMany({
    where: {
      id: input.expenseId,
      organizationId: input.organizationId,
      cancelledAt: null,
      deletedAt: null,
    },
    data: { cancelledAt: new Date(), cancelledById: input.cancelledById },
  });
  if (count === 0) return null;
  const expense = await tx.expense.findUniqueOrThrow({ where: { id: input.expenseId } });
  await addAmountHeld(tx, expense.paidById, input.organizationId, expense.amount);
  return expense;
}

export type HandoverInput = {
  id: string;
  organizationId: string;
  fromPersonId: string;
  toPersonId: string;
  amount: bigint;
  occurredAt: Date;
};

/**
 * Stores a handover and moves its amount from the remitter's held money to the receiver's (CM-17,
 * C-27), inside the caller's transaction so the row and both caches commit or fail together (ASVS
 * v5.0.0-2.3.3). The two updates run in a fixed order, by person id, so two opposite handovers in
 * parallel lock the rows in the same order and cannot deadlock. When remitter and receiver are the
 * same person (the former owner's automatic handover) the amount only falls. The caller checks the
 * role, the organization state and that the remitter is a collaborator; a collaboration that
 * cannot take its update makes `addAmountHeld` throw 404 and the insert rolls back.
 *
 * @param tx - The gesture's transaction.
 * @param input - Handover fields; `toPersonId` is the caller, never a body field.
 * @returns The stored handover.
 * @throws 404 `NOT_FOUND` when either held-money update finds no live collaboration.
 */
export async function recordHandoverInTx(
  tx: Prisma.TransactionClient,
  input: HandoverInput
): Promise<Handover> {
  const handover = await tx.handover.create({
    data: {
      id: input.id,
      organizationId: input.organizationId,
      fromPersonId: input.fromPersonId,
      toPersonId: input.toPersonId,
      amount: input.amount,
      occurredAt: input.occurredAt,
    },
  });
  const moves: [string, bigint][] = [[input.fromPersonId, -input.amount]];
  if (input.toPersonId !== input.fromPersonId) moves.push([input.toPersonId, input.amount]);
  moves.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [personId, delta] of moves) {
    await addAmountHeld(tx, personId, input.organizationId, delta);
  }
  return handover;
}
