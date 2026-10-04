import type { Expense, Prisma } from '@prisma/client';
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
