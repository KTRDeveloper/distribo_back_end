import { abilityFor } from '../../../shared/access/ability.js';
import { newId } from '../../../shared/ids.js';
import { findDeliveryInProgress, lockOrderToAssign } from '../../delivery/delivery.repository.js';
import { deliverOrder, type ClosingPayment } from '../../delivery/delivery.service.js';
import type { Actor } from '../../../types/express.js';
import type { LineOutcome, PushContext, Row, SyncTable, TableChange } from '../sync.types.js';
import { TAKEN_BY_PREFIX, takenBy } from './delivery.push.js';
import {
  forbidden,
  OUT_OF_SCOPE,
  outcome,
  scopeOfOrder,
  SERVER_CONTEXT,
  setIssue,
  STATUS_WORDS,
} from './order.push.js';

/** Largest amount of money a line may carry: 13 digits, as the other adapters read it. */
const MAX_AMOUNT = 9_999_999_999_999;

/** A row taken out of its table's normal path because it belongs to a closing. */
type Related = { table: SyncTable; id: string };

/**
 * Everything one batch pushes about the closing of an order (SYNC-014): the order row with status
 * DELIVERED, the delivered quantities, the order made for the rest, the payments and the sale the
 * phone wrote. They are read out of the judged tables, then applied together by `runClosings`.
 */
export type Closing = {
  orderId: string;
  /** True when the order itself is created by this batch (the orders adapter stores it first). */
  created: boolean;
  /** Id of the pushed order for the rest (`parent_order_id` = this order), when the phone made one. */
  child: string | null;
  /** Pushed `delivered_quantity` per line id. */
  delivered: Map<string, unknown>;
  payments: Row[];
  saleIds: string[];
  /** Rows taken from other tables, answered like the order. */
  related: Related[];
};

/** The closings of one batch, by order id. */
export type ClosingBook = Map<string, Closing>;

const newClosing = (orderId: string, created: boolean): Closing => ({
  orderId,
  created,
  child: null,
  delivered: new Map(),
  payments: [],
  saleIds: [],
  related: [],
});

const without = (row: Row, key: string): Row => {
  const copy = { ...row };
  delete copy[key];
  return copy;
};

const onlyKeys = (row: Row, allowed: string[]): boolean =>
  Object.keys(row).every((key) => allowed.includes(key));

/**
 * Reads the judged `orders` lines: an order pushed with status DELIVERED becomes a closing, and its
 * `status` is removed so the orders adapter does not turn it into an issue.
 *
 * @returns The lines the orders adapter still has to see.
 */
export function takeOrders(book: ClosingBook, change: TableChange): TableChange {
  const updated: Row[] = [];
  for (const row of change.updated) {
    const id = row['id'];
    if (row['status'] === 'DELIVERED' && typeof id === 'string') {
      book.set(id, newClosing(id, false));
      const rest = without(row, 'status');
      if (!onlyKeys(rest, ['id'])) updated.push(rest);
    } else {
      updated.push(row);
    }
  }
  for (const row of change.created) {
    const id = row['id'];
    if (row['status'] === 'DELIVERED' && typeof id === 'string') book.set(id, newClosing(id, true));
  }
  return { ...change, updated };
}

/**
 * The orders for the rest a batch pushes: created orders whose `parent_order_id` is an order the
 * same batch pushes DELIVERED. Maps each such order's id to its parent's. The server makes these
 * orders itself when it delivers, so they never go through the judge's right to create an order.
 */
export function findRestOrders(orders: TableChange | undefined): Map<string, string> {
  const delivered = new Set(
    [...(orders?.created ?? []), ...(orders?.updated ?? [])]
      .filter((row) => row['status'] === 'DELIVERED' && typeof row['id'] === 'string')
      .map((row) => String(row['id']))
  );
  const rest = new Map<string, string>();
  for (const row of orders?.created ?? []) {
    const parent = row['parent_order_id'];
    if (typeof row['id'] === 'string' && typeof parent === 'string' && delivered.has(parent)) {
      if (row['status'] !== 'DELIVERED') rest.set(row['id'], parent);
    }
  }
  return rest;
}

/** Splits off the rows (orders, or lines by `order_id`) that belong to an order for the rest. */
export function splitRestRows(
  change: TableChange,
  rest: Map<string, string>,
  field: 'id' | 'order_id'
): { kept: TableChange; taken: Row[] } {
  const taken: Row[] = [];
  const created = change.created.filter((row) => {
    const key = row[field];
    if (typeof key === 'string' && rest.has(key)) {
      taken.push(row);
      return false;
    }
    return true;
  });
  return { kept: { ...change, created }, taken };
}

/**
 * Attaches the rows of the orders for the rest to their closing once the closing's order passed the
 * judge. A row whose closing did not pass (its order is outside the scope or the role may not
 * deliver) is answered like a line outside the scope.
 */
export function adoptRestRows(
  book: ClosingBook,
  rest: Map<string, string>,
  table: 'orders' | 'order_lines',
  taken: Row[]
): LineOutcome[] {
  const outcomes: LineOutcome[] = [];
  for (const row of taken) {
    const id = String(row['id']);
    const orderId = String(row[table === 'orders' ? 'id' : 'order_id']);
    const closing = book.get(rest.get(orderId) ?? '');
    if (!closing) {
      outcomes.push(forbidden(table, id, 'OUT_OF_SCOPE', OUT_OF_SCOPE));
    } else if (table === 'orders') {
      closing.child = id;
    } else {
      closing.related.push({ table, id });
    }
  }
  return outcomes;
}

/**
 * Answers a closing whose created order the orders adapter did not store: the order for the rest
 * the phone pushed gets the same outcome, and the closing is dropped.
 */
export function dropClosing(book: ClosingBook, orderId: string, line: LineOutcome): LineOutcome[] {
  const closing = book.get(orderId);
  book.delete(orderId);
  if (!closing?.child) return [];
  return [asOutcome('orders', closing.child, line)];
}

const asOutcome = (
  table: SyncTable,
  id: string,
  from: { kind: LineOutcome['kind']; code?: string; message?: string }
): LineOutcome => outcome(table, id, from.kind, from.code, from.message);

async function orderIdOf(
  ctx: PushContext,
  table: 'order_lines' | 'deliveries',
  row: Row
): Promise<string | null> {
  if (typeof row['order_id'] === 'string') return row['order_id'];
  if (typeof row['id'] !== 'string') return null;
  const found =
    table === 'order_lines'
      ? await ctx.tx.orderLine.findUnique({ where: { id: row['id'] }, select: { orderId: true } })
      : await ctx.tx.delivery.findUnique({ where: { id: row['id'] }, select: { orderId: true } });
  return found?.orderId ?? null;
}

/**
 * Reads the judged `order_lines`: the `delivered_quantity` of a closing's lines is kept for the
 * closing and removed from the line (the adapter never sets it); an edit left with nothing else is
 * dropped.
 */
export async function takeLines(
  ctx: PushContext,
  book: ClosingBook,
  change: TableChange
): Promise<TableChange> {
  const split = async (rows: Row[], isUpdate: boolean): Promise<Row[]> => {
    const kept: Row[] = [];
    for (const row of rows) {
      const id = row['id'];
      const orderId = await orderIdOf(ctx, 'order_lines', row);
      const closing = orderId === null ? undefined : book.get(orderId);
      if (closing && typeof id === 'string') {
        if ('delivered_quantity' in row) closing.delivered.set(id, row['delivered_quantity']);
        const rest = without(row, 'delivered_quantity');
        if (isUpdate && onlyKeys(rest, ['id', 'order_id'])) {
          closing.related.push({ table: 'order_lines', id });
        } else {
          kept.push(rest);
        }
      } else {
        kept.push(row);
      }
    }
    return kept;
  };
  return {
    ...change,
    created: await split(change.created, false),
    updated: await split(change.updated, true),
  };
}

/**
 * Reads the judged `deliveries`: `arrived_at` of a closing's order is removed from the line, as the
 * closing sets it itself on the viewer's delivery.
 */
export async function takeDeliveries(
  ctx: PushContext,
  book: ClosingBook,
  change: TableChange
): Promise<TableChange> {
  const strip = async (rows: Row[]): Promise<Row[]> => {
    const out: Row[] = [];
    for (const row of rows) {
      if (!('arrived_at' in row)) {
        out.push(row);
        continue;
      }
      const orderId = await orderIdOf(ctx, 'deliveries', row);
      out.push(orderId !== null && book.has(orderId) ? without(row, 'arrived_at') : row);
    }
    return out;
  };
  return { ...change, created: await strip(change.created), updated: await strip(change.updated) };
}

/**
 * Reads the judged `ledger_entries`: the PAYMENT rows of a closing's order are kept for the closing
 * and its SALE rows are ignored (the sale is the server's, at the order total). Other rows go on.
 */
export function takeLedger(book: ClosingBook, change: TableChange): TableChange {
  const created = change.created.filter((row) => {
    const orderId = row['order_id'];
    const closing = typeof orderId === 'string' ? book.get(orderId) : undefined;
    if (!closing || typeof row['id'] !== 'string') return true;
    if (row['kind'] === 'SALE') {
      closing.saleIds.push(row['id']);
      closing.related.push({ table: 'ledger_entries', id: row['id'] });
      return false;
    }
    if (row['kind'] === 'PAYMENT') {
      closing.payments.push(row);
      return false;
    }
    return true;
  });
  return { ...change, created };
}

type Refusal = { kind: LineOutcome['kind']; code?: string; message?: string };

/** The payments the closing records, and the outcome of each payment row it does not record. */
async function readPayments(
  ctx: PushContext,
  closing: Closing
): Promise<{ payments: ClosingPayment[]; answers: LineOutcome[] }> {
  const ids = closing.payments.map((row) => row['id']).filter((id) => typeof id === 'string');
  const existing = await ctx.tx.ledgerEntry.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderId: true, recordedById: true },
  });
  const payments: ClosingPayment[] = [];
  const answers: LineOutcome[] = [];
  const seen = new Set<string>();
  for (const row of closing.payments) {
    const id = String(row['id']);
    const amount = row['amount'];
    const mode = row['mode'];
    const stored = existing.find((entry) => entry.id === id);
    if (seen.has(id)) continue;
    seen.add(id);
    if (stored) {
      // Only the viewer's own entry of this order is a repeat; any other id is not theirs (8.2.1).
      answers.push(
        stored.orderId === closing.orderId && stored.recordedById === ctx.viewer.personId
          ? outcome('ledger_entries', id, 'accepted')
          : forbidden('ledger_entries', id, 'OUT_OF_SCOPE', OUT_OF_SCOPE)
      );
    } else if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > MAX_AMOUNT ||
      (mode !== 'CASH' && mode !== 'MOBILE_MONEY')
    ) {
      answers.push(
        outcome(
          'ledger_entries',
          id,
          'aside',
          'INVALID_FIELD',
          'A field of this payment cannot be stored'
        )
      );
    } else {
      payments.push({ id, amount: BigInt(amount), mode });
    }
  }
  return { payments, answers };
}

/** The delivered quantities as the deliver gesture reads them; null when one is not a number. */
function readLines(
  closing: Closing
): Array<{ line_id: string; delivered_quantity: number }> | null {
  const lines: Array<{ line_id: string; delivered_quantity: number }> = [];
  for (const [lineId, pushed] of closing.delivered) {
    const quantity = typeof pushed === 'string' && pushed.trim() !== '' ? Number(pushed) : pushed;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return null;
    lines.push({ line_id: lineId, delivered_quantity: quantity });
  }
  return lines;
}

/**
 * Delivery wins over a crossed departure (CM-23): when the viewer's own delivery of the order was
 * stored closed because another driver left first, and the viewer is the one who delivered, the
 * other delivery is closed instead and the viewer's goes back in progress, ready to be marked
 * arrived by the closing.
 */
async function takeOverCrossedDelivery(ctx: PushContext, orderId: string): Promise<void> {
  const { tx, viewer } = ctx;
  const own = await tx.delivery.findFirst({
    where: {
      orderId,
      assignedToId: viewer.personId,
      deletedAt: null,
      arrivedAt: null,
      failedAt: { not: null },
      syncIssue: { startsWith: TAKEN_BY_PREFIX },
    },
  });
  const other = await findDeliveryInProgress(tx, orderId);
  if (!own || !other || other.id === own.id) return;
  const person = await tx.person.findUnique({
    where: { id: viewer.personId },
    select: { fullName: true },
  });
  const text = takenBy(person?.fullName ?? 'un autre livreur');
  await tx.delivery.update({
    where: { id: other.id },
    data: { failedAt: new Date(), failureReason: text, syncIssue: text },
  });
  await tx.delivery.update({
    where: { id: own.id },
    data: { failedAt: null, failureReason: null, syncIssue: null },
  });
}

const isHttpError = (error: unknown): error is Error & { statusCode: number; code: string } =>
  error instanceof Error && typeof (error as { statusCode?: unknown }).statusCode === 'number';

/** Closes one order: the outcome of its row and of every row that came with it. */
async function closeOrder(ctx: PushContext, closing: Closing): Promise<LineOutcome[]> {
  const { tx, viewer } = ctx;
  const { orderId } = closing;
  const everyRow: Related[] = [
    ...(closing.child ? [{ table: 'orders' as const, id: closing.child }] : []),
    ...closing.related,
  ];
  const answer = (refusal: Refusal, withPayments: ClosingPayment[], extra: LineOutcome[]) => [
    asOutcome('orders', orderId, refusal),
    ...everyRow.map((row) => asOutcome(row.table, row.id, refusal)),
    ...withPayments.map((payment) => asOutcome('ledger_entries', payment.id, refusal)),
    ...extra,
  ];

  const scope = await scopeOfOrder(ctx, orderId);
  if (!scope) {
    const answers = answer(
      { kind: 'forbidden', code: 'OUT_OF_SCOPE', message: OUT_OF_SCOPE },
      [],
      closing.payments.map((row) =>
        outcome('ledger_entries', String(row['id']), 'forbidden', 'OUT_OF_SCOPE', OUT_OF_SCOPE)
      )
    );
    return answers;
  }
  if (!abilityFor(scope.role, SERVER_CONTEXT).can('deliver', 'Order')) {
    return answer(
      {
        kind: 'forbidden',
        code: 'FIELD_NOT_ALLOWED',
        message: 'Your role may not make this change',
      },
      [],
      closing.payments.map((row) =>
        outcome(
          'ledger_entries',
          String(row['id']),
          'forbidden',
          'FIELD_NOT_ALLOWED',
          'Your role may not make this change'
        )
      )
    );
  }

  const { payments, answers: paymentAnswers } = await readPayments(ctx, closing);
  const lines = readLines(closing);
  const takenSaleIds = await tx.ledgerEntry.findMany({
    where: { id: { in: closing.saleIds } },
    select: { id: true },
  });
  const saleId = closing.saleIds.find((id) => !takenSaleIds.some((entry) => entry.id === id));
  const restTaken =
    closing.child !== null &&
    (await tx.order.findUnique({ where: { id: closing.child }, select: { id: true } })) !== null;

  const locked = await lockOrderToAssign(tx, orderId, scope.organizationId);
  if (!locked) {
    return answer(
      { kind: 'forbidden', code: 'OUT_OF_SCOPE', message: OUT_OF_SCOPE },
      payments,
      paymentAnswers
    );
  }

  const actor: Actor = {
    personId: viewer.personId,
    organizationId: scope.organizationId,
    role: scope.role as Actor['role'],
  };
  const refuse = async (code: string, message: string): Promise<LineOutcome[]> => {
    const current = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    // A delivered order keeps its own story: only an order still open carries the problem.
    if (current.status !== 'DELIVERED') await setIssue(ctx, orderId, message);
    return answer({ kind: 'issue', code, message }, payments, paymentAnswers);
  };

  if (lines === null) {
    return refuse('VALIDATION_ERROR', 'Livraison impossible : quantités livrées invalides');
  }

  await tx.$executeRaw`SAVEPOINT closing_order`;
  try {
    await takeOverCrossedDelivery(ctx, orderId);
    await deliverOrder(
      actor,
      orderId,
      {
        id: newId(),
        collected_amount: 0,
        sale_entry_id: saleId ?? newId(),
        ...(lines.length > 0 ? { lines } : {}),
        rest: closing.child !== null ? 'LATER' : 'ABANDON',
      },
      {
        viaSync: true,
        payments,
        tx,
        ...(closing.child !== null && !restTaken ? { restOrderId: closing.child } : {}),
      }
    );
    await tx.$executeRaw`RELEASE SAVEPOINT closing_order`;
  } catch (error) {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT closing_order`;
    if (!isHttpError(error)) throw error;
    if (error.statusCode === 404) {
      return answer(
        { kind: 'forbidden', code: 'OUT_OF_SCOPE', message: OUT_OF_SCOPE },
        payments,
        paymentAnswers
      );
    }
    if (error.statusCode === 409 && error.code === 'INVALID_TRANSITION') {
      const current = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { status: true },
      });
      return refuse(
        'INVALID_TRANSITION',
        `Livraison impossible : commande ${STATUS_WORDS[current.status]}`
      );
    }
    if (error.statusCode === 400 || error.statusCode === 409) {
      return refuse('VALIDATION_ERROR', 'Livraison impossible : quantités livrées invalides');
    }
    throw error;
  }
  return answer({ kind: 'accepted' }, payments, paymentAnswers);
}

/**
 * Push side of the closing of an order (SYNC-014). For each order pushed DELIVERED the server calls
 * `deliverOrder` with `viaSync`: the viewer's pushed payments (ids and modes kept), the delivered
 * quantities as partial lines, `rest` LATER when the phone pushed an order for the rest (its id is
 * used) else ABANDON. The sale is the server's, at the order total: a pushed SALE amount is never
 * used (v5.0.0-2.2.1). Each closing runs in a savepoint of the batch's transaction, so it is
 * written whole or not at all (v5.0.0-2.3.3); a business refusal becomes an `issue` on the order,
 * never a refusal of the batch (C-36). Only the viewer's own payments count (v5.0.0-8.2.1).
 *
 * @param ctx - Viewer and the batch's transaction.
 * @param book - Closings read out of the judged tables.
 * @returns One outcome for the order and for each row that came with it.
 */
export async function runClosings(ctx: PushContext, book: ClosingBook): Promise<LineOutcome[]> {
  const outcomes: LineOutcome[] = [];
  for (const closing of book.values()) outcomes.push(...(await closeOrder(ctx, closing)));
  return outcomes;
}
