import type { Prisma } from '@prisma/client';
import { logger } from '../../../lib/logger.js';
import { LABEL_MAX, TEXT_MAX } from '../../../shared/limits.js';
import { appendLedgerEntry } from '../../finance/ledger.service.js';
import { resolveMergedRelation } from '../../relationship/relationship.repository.js';
import type { LineOutcome, PushContext, Row, TableChange } from '../sync.types.js';
import { refuseEveryLine } from './identity.adapter.js';

/** Largest amount a single payment may carry (the same bound as a closing's payments). */
const MAX_AMOUNT = 9_999_999_999_999;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const outcome = (
  table: 'ledger_entries' | 'notifications',
  id: string,
  kind: LineOutcome['kind'],
  code?: string,
  message?: string
): LineOutcome => ({
  table,
  id,
  kind,
  ...(code ? { code } : {}),
  ...(message ? { message } : {}),
});

const forbidden = (id: string, code: string, message: string): LineOutcome => {
  logger.warn(
    { event: 'sync_line_forbidden', table: 'ledger_entries', recordId: id, code },
    'line refused'
  );
  return outcome('ledger_entries', id, 'forbidden', code, message);
};

const invalidPayment = (id: string): LineOutcome =>
  outcome(
    'ledger_entries',
    id,
    'aside',
    'INVALID_FIELD',
    'A field of this payment cannot be stored'
  );

const INVALID = Symbol('invalid');

/** An optional text: `undefined` when absent or null, `INVALID` when not a string within `max`. */
function readText(row: Row, key: string, max: number): string | undefined | typeof INVALID {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && value.length <= max ? value : INVALID;
}

/** The time a phone sends (epoch milliseconds or ISO text); null when unusable. */
function readTime(value: unknown): Date | null {
  const date =
    typeof value === 'number' || typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Serializes concurrent pushes of the same payment id for the length of the transaction, so the
 * second one finds the first one's entry and answers a repeat instead of failing on the key
 * (C-36). The lock is released at commit or rollback.
 */
async function lockPaymentId(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
}

/** One created payment. Never throws for a business reason: a bad line is refused or set aside. */
async function createPayment(ctx: PushContext, row: Row): Promise<LineOutcome> {
  const { tx, viewer } = ctx;
  const id = String(row['id']);
  await lockPaymentId(tx, id);

  const stored = await tx.ledgerEntry.findUnique({
    where: { id },
    select: { kind: true, recordedById: true },
  });
  if (stored) {
    // Only the viewer's own payment is a repeat; any other id is not theirs (ASVS v5.0.0-8.2.1).
    return stored.kind === 'PAYMENT' && stored.recordedById === viewer.personId
      ? outcome('ledger_entries', id, 'accepted')
      : forbidden(id, 'OUT_OF_SCOPE', 'This line is outside your scope');
  }
  // Only the closing of a delivery (SYNC-014) writes a payment tied to an order.
  if (row['kind'] !== 'PAYMENT') {
    return forbidden(id, 'ONLINE_ONLY', 'This gesture can only be made online');
  }
  if (row['order_id'] !== undefined && row['order_id'] !== null) return invalidPayment(id);

  const amount = row['amount'];
  const mode = row['mode'];
  const occurredAt = readTime(row['occurred_at']);
  const reference = readText(row, 'transaction_reference', LABEL_MAX);
  const note = readText(row, 'note', TEXT_MAX);
  if (
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > MAX_AMOUNT ||
    (mode !== 'CASH' && mode !== 'MOBILE_MONEY') ||
    occurredAt === null ||
    reference === INVALID ||
    note === INVALID
  ) {
    return invalidPayment(id);
  }

  const named = row['customer_relationship_id'];
  const relationship =
    typeof named === 'string' && UUID.test(named)
      ? await tx.customerRelationship.findUnique({
          where: { id: await resolveMergedRelation(named, tx) },
          select: { id: true, status: true, supplierOrganizationId: true, deletedAt: true },
        })
      : null;
  // A pending invitation, a missing customer or one of a counter-less supplier cannot be credited.
  if (
    !relationship ||
    relationship.deletedAt !== null ||
    relationship.status === 'PENDING' ||
    relationship.supplierOrganizationId === null
  ) {
    return outcome(
      'ledger_entries',
      id,
      'issue',
      'RELATIONSHIP_UNAVAILABLE',
      'This customer cannot receive a payment'
    );
  }

  await appendLedgerEntry(tx, {
    id,
    relationshipId: relationship.id,
    kind: 'PAYMENT',
    amount: BigInt(amount),
    mode,
    transactionReference: reference,
    note,
    recordedById: viewer.personId,
    organizationId: relationship.supplierOrganizationId,
    occurredAt,
  });
  logger.info(
    { event: 'sync_payment_recorded', personId: viewer.personId, entryId: id },
    'payment pushed by phone'
  );
  return outcome('ledger_entries', id, 'accepted');
}

/**
 * Push side of `ledger_entries` (SYNC-015): a PAYMENT collected offline reaches the customer's
 * account through `appendLedgerEntry`, which changes the balance and the recorder's held money by
 * addition in the batch's transaction (ASVS v5.0.0-2.3.3, v5.0.0-2.3.4). The recorder is always
 * the viewer, the amount is what the phone collected and `balance_effect` is the database's
 * (CM-27). Any other kind, an update and a delete are `ONLINE_ONLY` (ASVS v5.0.0-8.2.1); the judge
 * answers them first, this adapter refuses them again so no path can write them. A payment id
 * already stored changes nothing (C-36).
 *
 * @param ctx - Viewer and the batch's transaction; lines arrive already judged.
 * @param change - Judged lines of the table.
 */
export async function pushLedger(ctx: PushContext, change: TableChange): Promise<LineOutcome[]> {
  const outcomes: LineOutcome[] = [];
  for (const row of change.created) outcomes.push(await createPayment(ctx, row));
  const rest = [...change.updated.map((row) => String(row['id'])), ...change.deleted];
  for (const id of rest) {
    outcomes.push(forbidden(id, 'ONLINE_ONLY', 'This gesture can only be made online'));
  }
  return outcomes;
}

/**
 * Push side of `notifications` (SYNC-015): the only change a phone makes is `read_status` on the
 * viewer's own notification. The recipient comes from the session, never from the line.
 *
 * @param ctx - Viewer and the batch's transaction; lines arrive already judged.
 * @param change - Judged lines of the table.
 */
export async function pushNotifications(
  ctx: PushContext,
  change: TableChange
): Promise<LineOutcome[]> {
  const outcomes: LineOutcome[] = [];
  for (const row of change.updated) {
    const id = String(row['id']);
    const status = row['read_status'];
    if (status !== undefined && status !== 'READ' && status !== 'UNREAD') {
      outcomes.push(
        outcome('notifications', id, 'aside', 'INVALID_FIELD', 'This status cannot be stored')
      );
      continue;
    }
    if (status === undefined) {
      outcomes.push(outcome('notifications', id, 'accepted'));
      continue;
    }
    const { count } = await ctx.tx.notification.updateMany({
      where: { id, recipientId: ctx.viewer.personId, deletedAt: null },
      data: { readStatus: status },
    });
    outcomes.push(
      count === 1
        ? outcome('notifications', id, 'accepted')
        : outcome('notifications', id, 'aside', 'ROW_DELETED', 'This notification was deleted')
    );
  }
  outcomes.push(...refuseEveryLine({ ...change, updated: [] }));
  return outcomes;
}
