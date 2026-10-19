import type { Prisma, SubscriptionPayment } from '@prisma/client';
import { prisma } from '../../lib/db.js';

export type PaymentRow = SubscriptionPayment;

export type NewPayment = {
  id: string;
  organizationId: string;
  plan: 'ESSENTIAL' | 'PRO' | 'ENTERPRISE';
  months: number;
  amount: bigint;
  operator: 'MTN_MOMO' | 'ORANGE_MONEY';
  payerPhoneNumber: string;
  providerReference: string;
  termsVersion: string;
  customerTaxId: string | null;
};

/** Runs `work` in one transaction (writes that belong together commit or roll back together). */
export function inPaymentTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(work);
}

/**
 * Takes a transaction-scoped lock on a payment id, so two requests with one id run one after the
 * other: the second then finds the row the first inserted. Released when the transaction ends.
 */
export async function lockPaymentId(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'subscription_payment:' + id}, 0))`;
}

/** Reads one payment by id, in the caller's transaction. */
export function findPaymentById(tx: Prisma.TransactionClient, id: string): Promise<PaymentRow | null> {
  return tx.subscriptionPayment.findUnique({ where: { id } });
}

/** Inserts a PENDING payment. Status and dates are left to the database defaults. */
export function insertPendingPayment(tx: Prisma.TransactionClient, data: NewPayment): Promise<PaymentRow> {
  return tx.subscriptionPayment.create({
    data: {
      id: data.id,
      organizationId: data.organizationId,
      plan: data.plan,
      months: data.months,
      amount: data.amount,
      operator: data.operator,
      payerPhoneNumber: data.payerPhoneNumber,
      providerReference: data.providerReference,
      status: 'PENDING',
      termsVersion: data.termsVersion,
      customerTaxId: data.customerTaxId,
    },
  });
}
