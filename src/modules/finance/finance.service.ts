import type { LedgerEntryKind, Prisma } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import type { Actor } from '../../types/express.js';
import {
  findOrganizationStatus,
  runInTransaction,
} from '../organization/organization.repository.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  findSupplierRelationshipLocked,
  managesOrganization,
} from '../relationship/relationship.repository.js';
import type { CreditNoteInput, OpeningBalanceInput, PaymentInput } from './finance.schemas.js';
import { appendLedgerEntry } from './ledger.service.js';

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
 * Shared guards of the manager gestures that favour a customer (refund FIN-005, credit note
 * FIN-006). The organization must be ACTIVE; the relationship is locked through the caller's own
 * organization (404 outside it, ASVS v5.0.0-8.2.2); a counter, the caller's own record and a
 * PENDING relationship are refused. Own-record gestures return to the owner: only a customer
 * person equal to the caller binds an owner; a manager is also bound by a customer organization
 * they manage.
 */
async function lockCustomerForOutflow(
  tx: Prisma.TransactionClient,
  actor: Actor,
  relationshipId: string,
  route: string
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
  if (relationship.customerPersonId === null && relationship.customerOrganizationId === null) {
    throw httpError(409, 'COUNTER_ONLY_RETURNS', 'A counter only takes returns.');
  }
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
