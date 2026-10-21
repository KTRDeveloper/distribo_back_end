import type { LedgerEntry, LedgerEntryKind, Prisma } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { atLeast } from '../../shared/access/roles.js';
import { TEXT_MAX } from '../../shared/limits.js';
import type { Actor } from '../../types/express.js';
import {
  findActiveOwnerId,
  findCollaboration,
  findOrganizationStatus,
  runInTransaction,
} from '../organization/organization.repository.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  findPersonName,
  findSupplierRelationshipLocked,
  managesOrganization,
} from '../relationship/relationship.repository.js';
import type {
  CreditNoteInput,
  OpeningBalanceInput,
  PaymentInput,
  RecordExpenseInput,
  DisputeHandoverInput,
  RecordHandoverInput,
  ReturnInput,
  ReverseEntryInput,
} from './finance.schemas.js';
import {
  findMoneyExceptions,
  findTreasuryTotals,
  listExpensePage,
  listLedgerPage,
} from './finance.repository.js';
import {
  listExpensesQuerySchema,
  moneyExceptionsQuerySchema,
  resolveMoneyPeriod,
  treasuryQuerySchema,
} from './finance.schemas.js';
import type { ListExpensesQuery } from './finance.schemas.js';
import {
  cancelExpenseInTx,
  cancelHandoverInTx,
  recordExpenseInTx,
  recordHandoverInTx,
} from './held-money.js';
import { appendLedgerEntry, reverseLedgerEntry } from './ledger.service.js';

/** A ledger entry as the recorder sees it: an explicit field list, money in whole XAF. */
export type LedgerEntryView = {
  id: string;
  kind: LedgerEntryKind;
  amount: number;
  mode: 'CASH' | 'MOBILE_MONEY' | null;
  occurred_at: Date;
  balance: number;
};

/**
 * A SELLER or above records a customer's payment (FIN-004). One transaction (ASVS v5.0.0-2.3.3):
 * the organization must not be SUSPENDED (a CLOSED one may still collect), the relationship is
 * looked up and locked through the caller's own organization (another business's customer is 404,
 * v5.0.0-8.2.2), a counter is refused, and only an ACTIVE or ENDED relationship takes a payment.
 * The entry is written by `appendLedgerEntry`, which updates the balance and the recorder's held
 * money; the recorder is the caller and `occurred_at` is server time. Replays with the same `id`
 * are answered by `idempotent()`.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked the role.
 * @param relationshipId - Customer relationship from the path.
 * @param input - Validated body.
 * @returns The stored entry and the customer's balance after it.
 * @throws 404 `NOT_FOUND` (relationship outside the business); 409 `ORGANIZATION_NOT_ACTIVE`,
 * `COUNTER_ONLY_RETURNS`, `RELATIONSHIP_NOT_ACTIVE`.
 */
export function recordPayment(
  actor: Actor,
  relationshipId: string,
  input: PaymentInput
): Promise<LedgerEntryView> {
  return runInTransaction(async (tx) => {
    const status = await findOrganizationStatus(actor.organizationId, tx);
    if (status === null) throw httpError(404, 'NOT_FOUND', 'Not found');
    if (status === 'SUSPENDED') {
      throw httpError(409, 'ORGANIZATION_NOT_ACTIVE', 'Organization is not active');
    }

    const relationship = await findSupplierRelationshipLocked(
      tx,
      { personId: actor.personId, organizationId: actor.organizationId },
      relationshipId
    );
    if (!relationship) throw httpError(404, 'NOT_FOUND', 'Customer not found.');
    if (relationship.customerPersonId === null && relationship.customerOrganizationId === null) {
      throw httpError(409, 'COUNTER_ONLY_RETURNS', 'A counter only takes returns.');
    }
    if (relationship.status === 'PENDING') {
      throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'Relationship is not active');
    }

    const entry = await appendLedgerEntry(tx, {
      id: input.id,
      relationshipId: relationship.id,
      kind: 'PAYMENT',
      amount: BigInt(input.amount),
      mode: input.mode,
      transactionReference: input.transaction_reference,
      note: input.note,
      recordedById: actor.personId,
      organizationId: actor.organizationId,
      occurredAt: new Date(),
    });

    // The row is locked since the lookup, so the balance read before plus the entry's effect is exact.
    return {
      id: entry.id,
      kind: entry.kind,
      amount: Number(entry.amount),
      mode: entry.mode,
      occurred_at: entry.occurredAt,
      balance: Number(relationship.balance + entry.balanceEffect),
    };
  });
}

/**
 * Refuses a gesture on the caller's own customer record (CM-26): the customer person is the
 * caller, or, below OWNER, the customer organization is one the caller manages. Only the owner
 * may act on such a record.
 */
async function assertNotOwnRecord(
  tx: Prisma.TransactionClient,
  actor: Actor,
  relationship: { customerPersonId: string | null; customerOrganizationId: string | null },
  route: string
): Promise<void> {
  const ownPerson = relationship.customerPersonId === actor.personId;
  const managesCustomer =
    actor.role !== 'OWNER' &&
    relationship.customerOrganizationId !== null &&
    (await managesOrganization(tx, actor.personId, relationship.customerOrganizationId));
  if (ownPerson || managesCustomer) {
    logger.warn(
      { event: 'own_record_refused', personId: actor.personId, route },
      'Permission refused'
    );
    throw httpError(403, 'OWN_RECORD', 'Not allowed on your own record');
  }
}

/**
 * Shared guards of the manager gestures that favour a customer (refund FIN-005, credit note
 * FIN-006). The organization must be ACTIVE; the relationship is locked through the caller's own
 * organization (404 outside it, ASVS v5.0.0-8.2.2); a counter, the caller's own record and a
 * PENDING relationship are refused. Own-record gestures return to the owner: only a customer
 * person equal to the caller binds an owner; a manager is also bound by a customer organization
 * they manage. A returned-and-refunded gesture (FIN-008) sets `allowCounter`: a counter may be
 * refunded.
 */
async function lockCustomerForOutflow(
  tx: Prisma.TransactionClient,
  actor: Actor,
  relationshipId: string,
  route: string,
  allowCounter = false
) {
  const status = await findOrganizationStatus(actor.organizationId, tx);
  if (status === null) throw httpError(404, 'NOT_FOUND', 'Not found');
  if (status !== 'ACTIVE') {
    throw httpError(409, 'ORGANIZATION_NOT_ACTIVE', 'Organization is not active');
  }

  const relationship = await findSupplierRelationshipLocked(
    tx,
    { personId: actor.personId, organizationId: actor.organizationId },
    relationshipId
  );
  if (!relationship) throw httpError(404, 'NOT_FOUND', 'Customer not found.');
  if (
    !allowCounter &&
    relationship.customerPersonId === null &&
    relationship.customerOrganizationId === null
  ) {
    throw httpError(409, 'COUNTER_ONLY_RETURNS', 'A counter only takes returns.');
  }
  await assertNotOwnRecord(tx, actor, relationship, route);
  if (relationship.status === 'PENDING') {
    throw httpError(409, 'RELATIONSHIP_NOT_ACTIVE', 'Relationship is not active');
  }
  return relationship;
}

const INCREASED_CONTENT = {
  FR: (amount: number) => `Votre solde a augmenté de ${amount} XAF.`,
  EN: (amount: number) => `Your balance increased by ${amount} XAF.`,
};

/** Tells a registered customer person, in their language, that their balance went up (`balance.increased`). */
async function notifyBalanceIncreased(
  tx: Prisma.TransactionClient,
  actor: Actor,
  relationship: { customerPerson: { id: string; registeredAt: Date | null } | null },
  entryId: string,
  amount: number
): Promise<void> {
  if (!relationship.customerPerson?.registeredAt) return;
  const language = await recipientLanguage(relationship.customerPerson.id, tx);
  await notify(
    {
      recipientId: relationship.customerPerson.id,
      organizationId: actor.organizationId,
      sourceEvent: 'balance.increased',
      content: language === 'EN' ? INCREASED_CONTENT.EN(amount) : INCREASED_CONTENT.FR(amount),
      related: { type: 'ledger_entry', id: entryId },
    },
    tx
  );
}

/**
 * A MANAGER online or the OWNER gives money back to a customer (FIN-005). The route checked the
 * rules table (`create` LedgerEntry kind REFUND, ASVS v5.0.0-8.2.1). One transaction (v5.0.0-2.3.3):
 * the organization must be ACTIVE (a refund pays money out, so a CLOSED one is refused too), the
 * relationship is locked through the caller's own organization (404 outside it, v5.0.0-8.2.2), a
 * counter is refused (returns go through FIN-008), as is the caller's own record (the customer
 * person is the caller, or, below OWNER, the caller manages the customer organization) and a
 * PENDING relationship. `appendLedgerEntry` raises the balance and lowers the recorder's held
 * money; a registered customer person is told `balance.increased` in the same transaction.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked the role.
 * @param relationshipId - Customer relationship from the path.
 * @param input - Validated body.
 * @returns The stored entry and the customer's balance after it.
 * @throws 403 `OWN_RECORD`; 404 `NOT_FOUND`; 409 `ORGANIZATION_NOT_ACTIVE`,
 * `COUNTER_ONLY_RETURNS`, `RELATIONSHIP_NOT_ACTIVE`.
 */
export function recordRefund(
  actor: Actor,
  relationshipId: string,
  input: PaymentInput
): Promise<LedgerEntryView> {
  return runInTransaction(async (tx) => {
    const relationship = await lockCustomerForOutflow(tx, actor, relationshipId, 'record_refund');

    const entry = await appendLedgerEntry(tx, {
      id: input.id,
      relationshipId: relationship.id,
      kind: 'REFUND',
      amount: BigInt(input.amount),
      mode: input.mode,
      transactionReference: input.transaction_reference,
      note: input.note,
      recordedById: actor.personId,
      organizationId: actor.organizationId,
      occurredAt: new Date(),
    });

    await notifyBalanceIncreased(tx, actor, relationship, entry.id, input.amount);

    // The row is locked since the lookup, so the balance read before plus the entry's effect is exact.
    return {
      id: entry.id,
      kind: entry.kind,
      amount: Number(entry.amount),
      mode: entry.mode,
      occurred_at: entry.occurredAt,
      balance: Number(relationship.balance + entry.balanceEffect),
    };
  });
}

/**
 * A MANAGER online or the OWNER grants a credit note (FIN-006): the customer owes less and no
 * money moves, so no amount held changes. The route checked the rules table (`create` LedgerEntry
 * kind CREDIT_NOTE, ASVS v5.0.0-8.2.1). Same guards and one transaction as a refund (C-23: no
 * mode for this kind; the reason `note` is required).
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked the role.
 * @param relationshipId - Customer relationship from the path.
 * @param input - Validated body.
 * @returns The stored entry and the customer's balance after it.
 * @throws 403 `OWN_RECORD`; 404 `NOT_FOUND`; 409 `ORGANIZATION_NOT_ACTIVE`,
 * `COUNTER_ONLY_RETURNS`, `RELATIONSHIP_NOT_ACTIVE`.
 */
export function recordCreditNote(
  actor: Actor,
  relationshipId: string,
  input: CreditNoteInput
): Promise<LedgerEntryView> {
  return runInTransaction(async (tx) => {
    const relationship = await lockCustomerForOutflow(
      tx,
      actor,
      relationshipId,
      'record_credit_note'
    );

    const entry = await appendLedgerEntry(tx, {
      id: input.id,
      relationshipId: relationship.id,
      kind: 'CREDIT_NOTE',
      amount: BigInt(input.amount),
      note: input.note,
      recordedById: actor.personId,
      organizationId: actor.organizationId,
      occurredAt: new Date(),
    });

    // The row is locked since the lookup, so the balance read before plus the entry's effect is exact.
    return {
      id: entry.id,
      kind: entry.kind,
      amount: Number(entry.amount),
      mode: entry.mode,
      occurred_at: entry.occurredAt,
      balance: Number(relationship.balance + entry.balanceEffect),
    };
  });
}

/**
 * A MANAGER online or the OWNER copies a customer's debt from a paper notebook (FIN-007): the
 * balance rises and no money moves, so no amount held changes. The route checked the rules table
 * (`create` LedgerEntry kind OPENING_BALANCE, ASVS v5.0.0-8.2.1). Same guards and one transaction
 * as a refund (C-23: no mode for this kind; the `note` is required). Several may be recorded for
 * one customer; a wrong one is reversed (FIN-009). A registered customer person is told
 * `balance.increased` in the same transaction.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked the role.
 * @param relationshipId - Customer relationship from the path.
 * @param input - Validated body.
 * @returns The stored entry and the customer's balance after it.
 * @throws 403 `OWN_RECORD`; 404 `NOT_FOUND`; 409 `ORGANIZATION_NOT_ACTIVE`,
 * `COUNTER_ONLY_RETURNS`, `RELATIONSHIP_NOT_ACTIVE`.
 */
export function recordOpeningBalance(
  actor: Actor,
  relationshipId: string,
  input: OpeningBalanceInput
): Promise<LedgerEntryView> {
  return runInTransaction(async (tx) => {
    const relationship = await lockCustomerForOutflow(
      tx,
      actor,
      relationshipId,
      'record_opening_balance'
    );

    const entry = await appendLedgerEntry(tx, {
      id: input.id,
      relationshipId: relationship.id,
      kind: 'OPENING_BALANCE',
      amount: BigInt(input.amount),
      note: input.note,
      recordedById: actor.personId,
      organizationId: actor.organizationId,
      occurredAt: new Date(),
    });

    await notifyBalanceIncreased(tx, actor, relationship, entry.id, input.amount);

    // The row is locked since the lookup, so the balance read before plus the entry's effect is exact.
    return {
      id: entry.id,
      kind: entry.kind,
      amount: Number(entry.amount),
      mode: entry.mode,
      occurred_at: entry.occurredAt,
      balance: Number(relationship.balance + entry.balanceEffect),
    };
  });
}

/**
 * A MANAGER online or the OWNER records a returned and refunded article (FIN-008, CM-21): a
 * CREDIT_NOTE and a REFUND of the same amount in one transaction (ASVS v5.0.0-2.3.3), so the
 * customer's balance does not move and the recorder's held money falls by the amount. The route
 * checked the rules table for both kinds (v5.0.0-8.2.1). Same guards as a refund, except that a
 * counter is accepted, so an anonymous customer can be refunded. The credit note is written
 * first; if the refund fails, the whole transaction rolls back and neither entry exists.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked the role.
 * @param relationshipId - Customer relationship from the path.
 * @param input - Validated body: `id` is the credit note's id, `refund_entry_id` the refund's.
 * @returns Both stored entries; `balance` is the customer's balance after each.
 * @throws 403 `OWN_RECORD`; 404 `NOT_FOUND`; 409 `ORGANIZATION_NOT_ACTIVE`,
 * `RELATIONSHIP_NOT_ACTIVE`.
 */
export function recordReturn(
  actor: Actor,
  relationshipId: string,
  input: ReturnInput
): Promise<{ credit_note: LedgerEntryView; refund: LedgerEntryView }> {
  return runInTransaction(async (tx) => {
    const relationship = await lockCustomerForOutflow(
      tx,
      actor,
      relationshipId,
      'record_return',
      true
    );
    const common = {
      relationshipId: relationship.id,
      amount: BigInt(input.amount),
      note: input.note,
      recordedById: actor.personId,
      organizationId: actor.organizationId,
      occurredAt: new Date(),
    };

    const creditNote = await appendLedgerEntry(tx, {
      ...common,
      id: input.id,
      kind: 'CREDIT_NOTE',
    });
    const refund = await appendLedgerEntry(tx, {
      ...common,
      id: input.refund_entry_id,
      kind: 'REFUND',
      mode: input.mode,
    });

    // The row is locked since the lookup, so the balance read before plus the effects is exact.
    const view = (entry: typeof creditNote, balance: bigint): LedgerEntryView => ({
      id: entry.id,
      kind: entry.kind,
      amount: Number(entry.amount),
      mode: entry.mode,
      occurred_at: entry.occurredAt,
      balance: Number(balance),
    });
    return {
      credit_note: view(creditNote, relationship.balance + creditNote.balanceEffect),
      refund: view(refund, relationship.balance + creditNote.balanceEffect + refund.balanceEffect),
    };
  });
}

/**
 * A MANAGER online or the OWNER cancels a wrong ledger entry by adding its mirror (FIN-009,
 * C-25). The route checked the rules table (`reverse` LedgerEntry, ASVS v5.0.0-8.2.1). One
 * transaction (v5.0.0-2.3.3): the entry is looked up only through the caller's own organization
 * (another business's entry is 404, v5.0.0-8.2.2), then its relationship is locked, so two
 * reversals of one entry run one after the other and the second sees the first. Own-record
 * gestures go to the owner; a reversal of a reversal and a second reversal are 409. The mirror is
 * written by `reverseLedgerEntry`: balance first, then the held money of the person who recorded
 * the original (CM-17: the cash comes back out of the hands that took it). A registered customer
 * person is told `balance.increased` when the reversal raises the balance. The original entry is
 * never touched.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked the role.
 * @param entryId - Entry to reverse, from the path.
 * @param input - Validated body: `id` is the mirror entry's id.
 * @returns The mirror entry and the customer's balance after it.
 * @throws 403 `OWN_RECORD`; 404 `NOT_FOUND`; 409 `ALREADY_REVERSED`, `CANNOT_REVERSE_REVERSAL`.
 */
export function reverseEntry(
  actor: Actor,
  entryId: string,
  input: ReverseEntryInput
): Promise<LedgerEntryView> {
  return runInTransaction(async (tx) => {
    const scoped = await tx.ledgerEntry.findFirst({
      where: {
        id: entryId,
        customerRelationship: { supplierOrganizationId: actor.organizationId },
      },
      select: { customerRelationshipId: true },
    });
    if (!scoped) throw httpError(404, 'NOT_FOUND', 'Not found');

    const relationship = await findSupplierRelationshipLocked(
      tx,
      { personId: actor.personId, organizationId: actor.organizationId },
      scoped.customerRelationshipId
    );
    if (!relationship) throw httpError(404, 'NOT_FOUND', 'Not found');
    await assertNotOwnRecord(tx, actor, relationship, 'reverse_entry');

    // Read after the lock: a reversal committed by a concurrent request is visible here.
    const target = await tx.ledgerEntry.findUniqueOrThrow({
      where: { id: entryId },
      select: { reversesEntryId: true, recordedById: true },
    });
    if (target.reversesEntryId !== null) {
      throw httpError(409, 'CANNOT_REVERSE_REVERSAL', 'A reversal cannot be reversed');
    }
    const reversal = await tx.ledgerEntry.findFirst({
      where: { reversesEntryId: entryId },
      select: { id: true },
    });
    if (reversal) throw httpError(409, 'ALREADY_REVERSED', 'Entry already reversed');

    const entry = await reverseLedgerEntry(tx, entryId, {
      id: input.id,
      recordedById: actor.personId,
      heldById: target.recordedById,
      note: input.note,
    });

    if (entry.balanceEffect > 0n) {
      await notifyBalanceIncreased(tx, actor, relationship, entry.id, Number(entry.amount));
    }

    // The row is locked since the lookup, so the balance read before plus the entry's effect is exact.
    return {
      id: entry.id,
      kind: entry.kind,
      amount: Number(entry.amount),
      mode: entry.mode,
      occurred_at: entry.occurredAt,
      balance: Number(relationship.balance + entry.balanceEffect),
    };
  });
}

/** An expense as the recorder sees it: an explicit field list, money in whole XAF. */
export type ExpenseView = {
  id: string;
  paid_by_id: string;
  amount: number;
  category: string | null;
  description: string | null;
  recorded_by_id: string;
  occurred_at: Date;
};

/**
 * A MANAGER online or the OWNER records an expense paid by a collaborator (FIN-012, C-27, CM-17):
 * the payer's held money goes down. The route checked the rules table (`create` Expense, ASVS
 * v5.0.0-8.2.1). One transaction (v5.0.0-2.3.3): the organization must be ACTIVE (money moves, so
 * a CLOSED one is refused too); the payer defaults to the caller and must have a collaboration in
 * the caller's own organization, ACTIVE, PAUSED or revoked (FIN-021, CM-39): paused members keep
 * their held money. A person of another business, an unknown id or a mere invitee is 404
 * (v5.0.0-8.2.2). `recordExpenseInTx` inserts the row and lowers the money.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked the role.
 * @param input - Validated body.
 * @returns The stored expense.
 * @throws 404 `NOT_FOUND` (no ACTIVE, PAUSED or revoked payer in the organization);
 * 409 `ORGANIZATION_NOT_ACTIVE`.
 */
export function recordExpense(actor: Actor, input: RecordExpenseInput): Promise<ExpenseView> {
  return runInTransaction(async (tx) => {
    const status = await findOrganizationStatus(actor.organizationId, tx);
    if (status === null) throw httpError(404, 'NOT_FOUND', 'Not found');
    if (status !== 'ACTIVE') {
      throw httpError(409, 'ORGANIZATION_NOT_ACTIVE', 'Organization is not active');
    }

    const paidById = input.paid_by_id ?? actor.personId;
    const payer = await findCollaboration(tx, paidById, actor.organizationId);
    if (
      !payer ||
      (payer.status !== 'ACTIVE' && payer.status !== 'PAUSED' && payer.status !== 'REVOKED')
    ) {
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }

    const expense = await recordExpenseInTx(tx, {
      id: input.id,
      organizationId: actor.organizationId,
      paidById,
      amount: BigInt(input.amount),
      category: input.category,
      description: input.description,
      recordedById: actor.personId,
      occurredAt: input.occurred_at ? new Date(input.occurred_at) : new Date(),
    });

    return {
      id: expense.id,
      paid_by_id: expense.paidById,
      amount: Number(expense.amount),
      category: expense.category,
      description: expense.description,
      recorded_by_id: expense.recordedById,
      occurred_at: expense.occurredAt,
    };
  });
}

/** A cancelled expense as the canceller sees it: the expense fields plus who cancelled it and when. */
export type CancelledExpenseView = ExpenseView & {
  cancelled_at: Date | null;
  cancelled_by_id: string | null;
};

/**
 * A MANAGER online or the OWNER cancels an expense entered by mistake (FIN-013, C-27, CM-17): the
 * payer's held money goes back up by the amount and the row stays, marked cancelled. The route
 * checked the rules table (`cancel` Expense, ASVS v5.0.0-8.2.1). One transaction
 * (v5.0.0-2.3.3): `cancelExpenseInTx` cancels with a conditional update and restores the money, so
 * of two parallel cancels exactly one succeeds. The expense is looked up only inside the caller's
 * organization: another business's expense is 404 like an unknown id (v5.0.0-8.2.2).
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked the role.
 * @param expenseId - Expense to cancel, from the path.
 * @returns The expense with `cancelled_at` and `cancelled_by_id` set.
 * @throws 404 `NOT_FOUND`; 409 `ALREADY_CANCELLED`.
 */
export function cancelExpense(actor: Actor, expenseId: string): Promise<CancelledExpenseView> {
  return runInTransaction(async (tx) => {
    const expense = await cancelExpenseInTx(tx, {
      expenseId,
      organizationId: actor.organizationId,
      cancelledById: actor.personId,
    });
    if (!expense) {
      const existing = await tx.expense.findFirst({
        where: { id: expenseId, organizationId: actor.organizationId, deletedAt: null },
        select: { cancelledAt: true },
      });
      if (existing?.cancelledAt) {
        throw httpError(409, 'ALREADY_CANCELLED', 'Expense already cancelled');
      }
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }

    return {
      id: expense.id,
      paid_by_id: expense.paidById,
      amount: Number(expense.amount),
      category: expense.category,
      description: expense.description,
      recorded_by_id: expense.recordedById,
      occurred_at: expense.occurredAt,
      cancelled_at: expense.cancelledAt,
      cancelled_by_id: expense.cancelledById,
    };
  });
}

/** A handover as the recorder sees it: an explicit field list, money in whole XAF. */
export type HandoverView = {
  id: string;
  from_person_id: string;
  to_person_id: string;
  amount: number;
  occurred_at: Date;
};

const HANDOVER_CONTENT = {
  FR: (receiver: string, amount: number, remaining: number) =>
    `${receiver} a noté avoir reçu ${amount} de vous. Il vous reste ${remaining} à remettre.`,
  EN: (receiver: string, amount: number, remaining: number) =>
    `${receiver} noted receiving ${amount} from you. You still have ${remaining} to hand over.`,
};

/**
 * A MANAGER online or the OWNER records money received from a collaborator (FIN-015, C-27, CM-17):
 * the remitter's held money falls and the caller's rises. The route checked the rules table
 * (`create` Handover, ASVS v5.0.0-8.2.1); the receiver is always the caller. One transaction
 * (v5.0.0-2.3.3): the organization must be ACTIVE; a remitter equal to the caller is a 400; the
 * remitter must have a collaboration in the caller's own organization, ACTIVE, PAUSED or revoked
 * (FIN-021, CM-39): paused members keep their held money. A person of another business, an unknown
 * id or a mere invitee is 404 (v5.0.0-8.2.2). `recordHandoverInTx` inserts the row and moves both
 * amounts in a fixed order. The remitter is then told, in their
 * language, the noted amount and what they still hold (`handover.recorded`), so a note lower than
 * what they handed over shows (CWE-778). An amount above what the remitter holds is accepted.
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked the role.
 * @param input - Validated body.
 * @returns The stored handover.
 * @throws 400 `VALIDATION_ERROR` (remitter is the caller); 404 `NOT_FOUND` (no ACTIVE, PAUSED or
 * revoked remitter in the organization); 409 `ORGANIZATION_NOT_ACTIVE`.
 */
export function recordHandover(actor: Actor, input: RecordHandoverInput): Promise<HandoverView> {
  return runInTransaction(async (tx) => {
    const status = await findOrganizationStatus(actor.organizationId, tx);
    if (status === null) throw httpError(404, 'NOT_FOUND', 'Not found');
    if (status !== 'ACTIVE') {
      throw httpError(409, 'ORGANIZATION_NOT_ACTIVE', 'Organization is not active');
    }
    if (input.from_person_id === actor.personId) {
      throw httpError(400, 'VALIDATION_ERROR', 'A handover cannot be from yourself');
    }

    const remitter = await findCollaboration(tx, input.from_person_id, actor.organizationId);
    if (
      !remitter ||
      (remitter.status !== 'ACTIVE' && remitter.status !== 'PAUSED' && remitter.status !== 'REVOKED')
    ) {
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }

    const handover = await recordHandoverInTx(tx, {
      id: input.id,
      organizationId: actor.organizationId,
      fromPersonId: input.from_person_id,
      toPersonId: actor.personId,
      amount: BigInt(input.amount),
      occurredAt: input.occurred_at ? new Date(input.occurred_at) : new Date(),
    });

    const after = await findCollaboration(tx, input.from_person_id, actor.organizationId);
    const receiverName = (await findPersonName(tx, actor.personId)) ?? '';
    const language = await recipientLanguage(input.from_person_id, tx);
    const content = HANDOVER_CONTENT[language](
      receiverName,
      input.amount,
      Number(after?.amountHeld ?? 0n)
    );
    await notify(
      {
        recipientId: input.from_person_id,
        organizationId: actor.organizationId,
        sourceEvent: 'handover.recorded',
        content,
        related: { type: 'handover', id: handover.id },
      },
      tx
    );

    return {
      id: handover.id,
      from_person_id: handover.fromPersonId,
      to_person_id: handover.toPersonId,
      amount: Number(handover.amount),
      occurred_at: handover.occurredAt,
    };
  });
}

/**
 * A MANAGER online or the OWNER cancels a handover noted by mistake (FIN-016, C-27, CM-17): the
 * remitter's held money rises and the receiver's falls by the amount, the row stays, marked
 * cancelled. The route checked the rules table (`cancel` Handover, ASVS v5.0.0-8.2.1). One
 * transaction (v5.0.0-2.3.3): `cancelHandoverInTx` cancels with a conditional update and restores
 * both caches, so of two parallel cancels exactly one succeeds. The handover is looked up only
 * inside the caller's organization: another business's handover is 404 like an unknown id
 * (v5.0.0-8.2.2).
 *
 * @param actor - Person, organization and role from `loadActor`; the route checked the role.
 * @param handoverId - Handover to cancel, from the path.
 * @returns The cancelled handover.
 * @throws 404 `NOT_FOUND`; 409 `ALREADY_CANCELLED`.
 */
export function cancelHandover(actor: Actor, handoverId: string): Promise<HandoverView> {
  return runInTransaction(async (tx) => {
    const handover = await cancelHandoverInTx(tx, {
      handoverId,
      organizationId: actor.organizationId,
      cancelledById: actor.personId,
    });
    if (!handover) {
      const existing = await tx.handover.findFirst({
        where: { id: handoverId, organizationId: actor.organizationId, deletedAt: null },
        select: { cancelledAt: true },
      });
      if (existing?.cancelledAt) {
        throw httpError(409, 'ALREADY_CANCELLED', 'Handover already cancelled');
      }
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }

    return {
      id: handover.id,
      from_person_id: handover.fromPersonId,
      to_person_id: handover.toPersonId,
      amount: Number(handover.amount),
      occurred_at: handover.occurredAt,
    };
  });
}

const HANDOVER_DISPUTED_CONTENT = {
  FR: (remitter: string, amount: number) =>
    `${remitter} conteste le montant de ${amount} noté pour sa remise d'argent.`,
  EN: (remitter: string, amount: number) =>
    `${remitter} disputes the amount of ${amount} noted for their handover.`,
};

/**
 * The remitter says the noted amount is wrong (FIN-016): the organization's ACTIVE OWNER gets a
 * `handover.disputed` notification naming the handover, the amount and the remitter, in the
 * owner's language; no amount or row changes, resolving it is a phone call. Only the remitter
 * (`from_person_id`) of a handover of the caller's own organization may dispute: anyone else, a
 * foreign handover or an unknown id is the same 404, so an ID is never confirmed (ASVS
 * v5.0.0-8.2.2). The route's `idempotent()` makes a repeated gesture id notify once. The dispute
 * is logged at `warn` with ids only (v5.0.0-16.3.1, CWE-778). The comment, when given, is appended
 * to the notification, cut to fit the notification limit; it is never logged.
 *
 * @param actor - Person and organization from `loadActor`; any ACTIVE collaborator may reach here.
 * @param handoverId - Handover from the path.
 * @param input - Validated body.
 * @throws 404 `NOT_FOUND` (not the remitter, other business, unknown id or no active owner).
 */
export function disputeHandover(
  actor: Actor,
  handoverId: string,
  input: DisputeHandoverInput
): Promise<void> {
  return runInTransaction(async (tx) => {
    const handover = await tx.handover.findFirst({
      where: {
        id: handoverId,
        organizationId: actor.organizationId,
        fromPersonId: actor.personId,
        deletedAt: null,
      },
    });
    if (!handover) throw httpError(404, 'NOT_FOUND', 'Not found');

    const ownerId = await findActiveOwnerId(tx, actor.organizationId);
    if (!ownerId) throw httpError(404, 'NOT_FOUND', 'Not found');

    const remitterName = (await findPersonName(tx, actor.personId)) ?? '';
    const language = await recipientLanguage(ownerId, tx);
    const base = HANDOVER_DISPUTED_CONTENT[language](remitterName, Number(handover.amount));
    const content = input.comment ? `${base} ${input.comment}`.slice(0, TEXT_MAX) : base;
    await notify(
      {
        recipientId: ownerId,
        organizationId: actor.organizationId,
        sourceEvent: 'handover.disputed',
        content,
        related: { type: 'handover', id: handover.id },
      },
      tx
    );

    logger.warn(
      {
        event: 'handover_disputed',
        personId: actor.personId,
        organizationId: actor.organizationId,
        handoverId: handover.id,
      },
      'Handover disputed'
    );
  });
}

/** The party reading a ledger: the route fixes the side, the identity comes from the session. */
export type LedgerViewer =
  | { side: 'SUPPLIER'; actor: Actor }
  | { side: 'CUSTOMER_ORGANIZATION'; actor: Actor }
  | { side: 'CUSTOMER_PERSON'; personId: string };

/** A ledger entry as a party reads it: an explicit field list; never `transaction_reference`. */
export type LedgerItemView = {
  id: string;
  kind: LedgerEntryKind;
  amount: number;
  balance_effect: number;
  mode: 'CASH' | 'MOBILE_MONEY' | null;
  order_id: string | null;
  reverses_entry_id: string | null;
  note: string | null;
  occurred_at: Date;
  /** Only the supplier's OWNER and MANAGER see who recorded an entry (v5.0.0-8.2.3). */
  recorded_by_id?: string;
};

/**
 * Builds an item from an explicit field list (v5.0.0-8.2.3, CWE-200): `transaction_reference` is
 * never copied, and the recorder is added for the supplier's OWNER and MANAGER only.
 */
function toLedgerItem(row: LedgerEntry, withRecorder: boolean): LedgerItemView {
  const item: LedgerItemView = {
    id: row.id,
    kind: row.kind,
    amount: Number(row.amount),
    balance_effect: Number(row.balanceEffect),
    mode: row.mode,
    order_id: row.orderId,
    reverses_entry_id: row.reversesEntryId,
    note: row.note,
    occurred_at: row.occurredAt,
  };
  if (withRecorder) item.recorded_by_id = row.recordedById;
  return item;
}

/** Refuses a role below the floor with a logged 403 (deny by default, v5.0.0-8.2.1). */
function assertRoleAtLeast(actor: Actor, floor: 'SELLER' | 'MANAGER'): void {
  if (atLeast(actor.role, floor)) return;
  logger.warn(
    {
      event: 'permission_refused',
      personId: actor.personId,
      action: 'read',
      subjectType: 'LedgerEntry',
    },
    'Permission refused'
  );
  throw httpError(403, 'FORBIDDEN', 'Permission denied');
}

/**
 * A party reads the ledger of a relationship (FIN-010): the current balance and one page of
 * entries, newest `occurred_at` first. The supplier side needs SELLER or above, a customer
 * organization needs MANAGER or above (403, checked before any lookup); a customer person needs no
 * role. The relationship is loaded through the visibility predicate for the viewer's own party, so
 * anyone who is not a party gets the same 404 as an absent id (v5.0.0-8.2.2). Items use per-party
 * field lists (v5.0.0-8.2.3): `recorded_by_id` only for the supplier's OWNER and MANAGER, and
 * `transaction_reference` for nobody.
 *
 * @param viewer - Side and identity, set by the route from the session.
 * @param relationshipId - Validated relationship id from the path.
 * @param query - Page size and opaque cursor.
 * @returns The balance, the items and the next cursor or null on the last page.
 * @throws 403 `FORBIDDEN`; 404 `NOT_FOUND`; 400 `VALIDATION_ERROR` for a malformed cursor.
 */
export async function listLedger(
  viewer: LedgerViewer,
  relationshipId: string,
  query: { limit: number; cursor?: string }
): Promise<{ balance: number; items: LedgerItemView[]; next_cursor: string | null }> {
  let identity: { personId: string; organizationId?: string };
  let withRecorder = false;
  if (viewer.side === 'SUPPLIER') {
    assertRoleAtLeast(viewer.actor, 'SELLER');
    identity = viewer.actor;
    withRecorder = atLeast(viewer.actor.role, 'MANAGER');
  } else if (viewer.side === 'CUSTOMER_ORGANIZATION') {
    assertRoleAtLeast(viewer.actor, 'MANAGER');
    identity = viewer.actor;
  } else {
    identity = { personId: viewer.personId };
  }

  const page = await listLedgerPage(viewer.side, identity, relationshipId, query);
  if (!page) throw httpError(404, 'NOT_FOUND', 'Not found');
  return {
    balance: Number(page.balance),
    items: page.rows.map((row) => toLedgerItem(row, withRecorder)),
    next_cursor: page.nextCursor,
  };
}

/** Count and total (whole XAF) of one kind of gesture. */
export type MoneyExceptionBucket = { count: number; amount: number };

/** One collaborator's money exceptions: person id and totals only (ASVS v5.0.0-8.2.3). */
export type MoneyExceptionItem = {
  person_id: string;
  refunds: MoneyExceptionBucket;
  credit_notes: MoneyExceptionBucket;
  reversals: MoneyExceptionBucket;
  expenses: MoneyExceptionBucket;
  price_gaps: MoneyExceptionBucket;
  abandoned_rests: MoneyExceptionBucket;
};

/**
 * The owner reads the money gestures other people made, grouped by person (FIN-019). OWNER only:
 * any other role is refused with a logged 403 before the query is even read (deny by default,
 * ASVS v5.0.0-8.2.1); the organization is the actor's, never a client value, and the owner's own
 * gestures are left out. Goods a non-owner deliverer abandoned in partial deliveries count too
 * (`abandoned_rests`, DLV-012). Nothing is hidden: a refund and its later reversal both show under the
 * person who recorded them (CWE-778). Items are sorted by total amount, largest first, then by
 * person id so the order is stable.
 *
 * @param actor - Person, organization and role from `loadActor`.
 * @param query - Raw `from` and `to` (`YYYY-MM-DD`); default the last 7 days, at most 92 days apart.
 * @returns One item per collaborator who made at least one gesture in the period.
 * @throws 403 `FORBIDDEN` below OWNER; 400 `VALIDATION_ERROR` for a bad or too long period.
 */
export async function moneyExceptions(
  actor: Actor,
  query: { from?: string; to?: string }
): Promise<{ items: MoneyExceptionItem[] }> {
  if (actor.role !== 'OWNER') {
    logger.warn(
      {
        event: 'permission_refused',
        personId: actor.personId,
        action: 'read',
        subjectType: 'MoneyExceptions',
      },
      'Permission refused'
    );
    throw httpError(403, 'FORBIDDEN', 'Permission denied');
  }
  const period = resolveMoneyPeriod(moneyExceptionsQuerySchema.parse(query));
  const people = await findMoneyExceptions(actor.organizationId, period, actor.personId);

  const ranked = [...people.entries()].map(([personId, tally]) => {
    const total =
      tally.refunds.amount +
      tally.creditNotes.amount +
      tally.reversals.amount +
      tally.expenses.amount +
      tally.priceGaps.amount +
      tally.abandonedRests.amount;
    const bucket = (value: { count: number; amount: bigint }): MoneyExceptionBucket => ({
      count: value.count,
      amount: Number(value.amount),
    });
    const item: MoneyExceptionItem = {
      person_id: personId,
      refunds: bucket(tally.refunds),
      credit_notes: bucket(tally.creditNotes),
      reversals: bucket(tally.reversals),
      expenses: bucket(tally.expenses),
      price_gaps: bucket(tally.priceGaps),
      abandoned_rests: bucket(tally.abandonedRests),
    };
    return { item, total };
  });
  ranked.sort((a, b) =>
    a.total === b.total
      ? a.item.person_id.localeCompare(b.item.person_id)
      : a.total > b.total
        ? -1
        : 1
  );
  return { items: ranked.map((entry) => entry.item) };
}

/** Refuses a caller below MANAGER with a logged 403 (deny by default, ASVS v5.0.0-8.2.1). */
function requireManagerOrOwner(actor: Actor, subjectType: string): void {
  if (atLeast(actor.role, 'MANAGER')) return;
  logger.warn(
    { event: 'permission_refused', personId: actor.personId, action: 'read', subjectType },
    'Permission refused'
  );
  throw httpError(403, 'FORBIDDEN', 'Permission denied');
}

/**
 * The owner or a manager reads the money that came in and went out over a period (FIN-020).
 * Totals only (ASVS v5.0.0-15.3.1), in whole XAF; the organization is the actor's, never a client
 * value. The role is checked before the query is read. `net` is `inflows - outflows` and may be
 * negative.
 *
 * @param actor - Person, organization and role from `loadActor`.
 * @param query - Raw `from` and `to` (`YYYY-MM-DD`); default the last 7 days, at most 92 days apart.
 * @throws 403 `FORBIDDEN` below MANAGER; 400 `VALIDATION_ERROR` for a bad or too long period.
 */
export async function treasury(
  actor: Actor,
  query: { from?: string; to?: string }
): Promise<{ inflows: number; outflows: number; net: number }> {
  requireManagerOrOwner(actor, 'Treasury');
  const period = resolveMoneyPeriod(treasuryQuerySchema.parse(query));
  const totals = await findTreasuryTotals(actor.organizationId, period);
  return {
    inflows: Number(totals.inflows),
    outflows: Number(totals.outflows),
    net: Number(totals.inflows - totals.outflows),
  };
}

/** An expense in the list: the recorded fields plus its cancellation flag. */
export type ListedExpenseView = CancelledExpenseView & { cancelled: boolean };

/**
 * The owner or a manager lists the organization's expenses, newest first, cancelled ones included
 * and flagged (FIN-020). The organization is the actor's; the role is checked before the query is
 * read.
 *
 * @param actor - Person, organization and role from `loadActor`.
 * @param query - Raw `limit`, `cursor`, `from`, `to` (`YYYY-MM-DD`, `to` inclusive).
 * @throws 403 `FORBIDDEN` below MANAGER; 400 `VALIDATION_ERROR` for a bad query or cursor.
 */
export async function listExpenses(
  actor: Actor,
  query: ListExpensesQuery
): Promise<{ items: ListedExpenseView[]; next_cursor: string | null }> {
  requireManagerOrOwner(actor, 'Expense');
  const parsed = listExpensesQuerySchema.parse(query);
  const page = await listExpensePage(actor.organizationId, {
    limit: parsed.limit,
    cursor: parsed.cursor,
    from: parsed.from ? resolveMoneyPeriod({ from: parsed.from, to: parsed.from }).from : undefined,
    toExclusive: parsed.to ? resolveMoneyPeriod({ to: parsed.to }).toExclusive : undefined,
  });
  return {
    items: page.rows.map((expense) => ({
      id: expense.id,
      paid_by_id: expense.paidById,
      amount: Number(expense.amount),
      category: expense.category,
      description: expense.description,
      recorded_by_id: expense.recordedById,
      occurred_at: expense.occurredAt,
      cancelled: expense.cancelledAt !== null,
      cancelled_at: expense.cancelledAt,
      cancelled_by_id: expense.cancelledById,
    })),
    next_cursor: page.nextCursor,
  };
}
