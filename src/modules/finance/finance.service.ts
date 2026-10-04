import type { LedgerEntry, LedgerEntryKind, Prisma } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';
import { logger } from '../../lib/logger.js';
import { atLeast } from '../../shared/access/roles.js';
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
import type {
  CreditNoteInput,
  OpeningBalanceInput,
  PaymentInput,
  ReturnInput,
  ReverseEntryInput,
} from './finance.schemas.js';
import { listLedgerPage } from './finance.repository.js';
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
