import type { Prisma, SubscriptionPayment } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { prisma } from '../../lib/db.js';

export type PaymentRow = SubscriptionPayment;

/** Reads reconciliation fields only, excluding payer data and provider payloads. */
export function findPaymentsByReferences(references: string[]) {
  return prisma.subscriptionPayment.findMany({
    where: { providerReference: { in: references } },
    select: { id: true, status: true, amount: true, providerReference: true },
  });
}

/** Lists successful payments by confirmation time in the half-open UTC day, not creation time. */
export function listConfirmedOn(day: string) {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86_400_000);
  return prisma.subscriptionPayment.findMany({
    where: { status: 'SUCCEEDED', confirmedAt: { gte: start, lt: end } },
    select: { id: true, status: true, amount: true, providerReference: true },
  });
}

/**
 * Selects a bounded, oldest-first batch without loading payer data or provider payloads.
 * @param before Inclusive creation cutoff; only still-PENDING payments are eligible.
 * @param limit Maximum number of payments to check in this sweep.
 * @returns Payment ids, unique provider references and creation instants.
 */
export function listStalePending(before: Date, limit: number) {
  return prisma.subscriptionPayment.findMany({
    where: { status: 'PENDING', createdAt: { lte: before } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, providerReference: true, createdAt: true },
  });
}

/**
 * Reads only public status fields and the original RECEIPT, never a refund credit note.
 * A repeatable snapshot prevents a concurrent confirmation from mixing PENDING with its receipt.
 * @param id The payment id held by the payer; no organization id is accepted from the caller.
 * @returns The payment and its purchased period, or null when absent.
 */
export function findPaymentView(id: string) {
  return prisma.$transaction((tx) => tx.subscriptionPayment.findUnique({
    where: { id },
    select: {
      id: true, status: true, plan: true, months: true, amount: true, operator: true,
      organization: { select: { name: true } },
      subscription: { select: { startsAt: true, endsAt: true } },
      receipts: {
        where: { kind: 'RECEIPT' },
        take: 1,
        select: {
          number: true, label: true, customerName: true, customerTaxId: true,
          amountExclTax: true, vatRateBp: true, vatAmount: true, amount: true, issuedAt: true,
        },
      },
    },
  }), { isolationLevel: 'RepeatableRead' });
}

/** Looks up the unique provider reference before any external status check. */
export function findPaymentByReference(providerReference: string): Promise<PaymentRow | null> {
  return prisma.subscriptionPayment.findUnique({ where: { providerReference } });
}

/**
 * Locks the payment until commit; callers must recheck PENDING after acquiring it.
 * This serializes both activation and late failure callbacks (ASVS 2.3.3).
 * @param tx Transaction owning all confirmation writes.
 * @param id Payment id loaded by the server from its provider reference.
 * @returns The locked payment, or null if absent.
 */
export async function lockPayment(tx: Prisma.TransactionClient, id: string): Promise<PaymentRow | null> {
  await tx.$queryRaw`SELECT id FROM subscription_payments WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.subscriptionPayment.findUnique({ where: { id } });
}

/**
 * Records a terminal outcome only after the caller locks and rechecks the payment.
 * The confirmation timestamp is set only for success, as required by C-53.
 * @param tx Transaction shared with periods, receipts, rights and limits.
 * @param id Locked payment id.
 * @param outcome Server-checked terminal status and JSON-safe provider evidence.
 */
export async function setPaymentOutcome(
  tx: Prisma.TransactionClient,
  id: string,
  outcome: { status: 'SUCCEEDED' | 'FAILED' | 'EXPIRED'; now: Date; payload: Prisma.InputJsonObject },
): Promise<void> {
  await tx.subscriptionPayment.update({ where: { id }, data: {
    status: outcome.status,
    confirmedAt: outcome.status === 'SUCCEEDED' ? outcome.now : null,
    providerPayload: outcome.payload,
  } });
}

/** Appends the PAYER payment event atomically with its purchased period and receipt. */
export async function insertPaymentEvent(
  tx: Prisma.TransactionClient,
  payment: PaymentRow,
  subscriptionId: string,
  now: Date,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO subscription_events
      (id, organization_id, kind, actor, payment_id, subscription_id, occurred_at)
    VALUES (${uuidv7()}::uuid, ${payment.organizationId}::uuid, 'PAYMENT', 'PAYER',
            ${payment.id}::uuid, ${subscriptionId}::uuid, ${now})
  `;
}

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
