import type { CollaborationRole, OrderStatus, Prisma } from '@prisma/client';
import { logger } from '../../../lib/logger.js';
import { abilityFor } from '../../../shared/access/ability.js';
import { TEXT_MAX } from '../../../shared/limits.js';
import { parseQuantity } from '../../../shared/money.js';
import { resolveVariantForLine } from '../../catalog/catalog.sync-writers.js';
import { lineAmountOf, orderTotal } from '../../order/order.calculations.js';
import { transitionOrder } from '../../order/order.state.js';
import { resolveMergedRelation } from '../../relationship/relationship.repository.js';
import type { LineOutcome, PushContext, Row, SyncTable, TableChange } from '../sync.types.js';
import { refuseEveryLine } from './identity.adapter.js';

/** The note the owner reads when a line names a variant withdrawn since the entry (SYNC-029 AC-3). */
export const PRODUCT_RETIRED_NOTE = 'Produit retiré de la vente depuis la saisie';

/** Largest amount (XAF) a pushed price, delivery cost or line may reach: sums stay in `bigint`. */
const MAX_AMOUNT = 1_000_000_000_000n;
/** Largest quantity `numeric(12,3)` holds, in thousandths. */
const MAX_QUANTITY_MILLI = 999_999_999_999n;

/** A phone clock further ahead than this is an anomaly to report, not drift (CM-31). */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const INVALID = Symbol('invalid');
export type Invalid = typeof INVALID;

export const outcome = (
  table: SyncTable,
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

export const forbidden = (
  table: SyncTable,
  id: string,
  code: string,
  message: string
): LineOutcome => {
  logger.warn({ event: 'sync_line_forbidden', table, recordId: id, code }, 'line refused');
  return outcome(table, id, 'forbidden', code, message);
};

export const OUT_OF_SCOPE = 'This line is outside your scope';

/** A text the phone sent: `null` when absent or empty, `INVALID` when unusable. */
export function readText(row: Row, key: string): string | null | Invalid {
  const value = row[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > TEXT_MAX) return INVALID;
  return value === '' ? null : value;
}

/** A whole amount in francs (number or digit string), within `MAX_AMOUNT`; `INVALID` otherwise. */
function readAmount(row: Row, key: string, fallback?: bigint): bigint | Invalid {
  const value = row[key];
  if (value === undefined || value === null) return fallback ?? INVALID;
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{1,13}$/.test(text)) return INVALID;
  const amount = BigInt(text);
  return amount > MAX_AMOUNT ? INVALID : amount;
}

/** A calendar day `YYYY-MM-DD` (or null); `INVALID` when it is not a real date. */
function readDay(row: Row, key: string): Date | null | Invalid {
  const value = row[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DAY.test(value)) return INVALID;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? INVALID : date;
}

/**
 * The moment the phone says the order was entered (epoch milliseconds or ISO text). A moment a few
 * seconds after the server's now is clock drift: the order is dated now. A moment beyond the
 * tolerance is kept as sent, so the controls on arrival can report it (DATE_IN_FUTURE, CM-31).
 */
function readEnteredAt(row: Row, now: Date): Date | Invalid {
  const value = row['created_at'];
  if (value === undefined || value === null) return now;
  const parsed =
    typeof value === 'number'
      ? new Date(value)
      : typeof value === 'string'
        ? new Date(value)
        : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return INVALID;
  const ahead = parsed.getTime() - now.getTime();
  return ahead > 0 && ahead <= FUTURE_TOLERANCE_MS ? now : parsed;
}

/** A quantity in thousandths, above zero; the phone may send a number or a decimal text. */
function readQuantity(row: Row): bigint | Invalid {
  const value = row['quantity'];
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string') return INVALID;
  try {
    const milli = parseQuantity(text);
    return milli > 0n && milli <= MAX_QUANTITY_MILLI ? milli : INVALID;
  } catch {
    return INVALID;
  }
}

/** `42000` thousandths as the text `42.000` that `numeric(12,3)` takes. */
const milliToText = (milli: bigint): string =>
  `${milli / 1000n}.${String(milli % 1000n).padStart(3, '0')}`;

const invalidOrder = (id: string) =>
  outcome('orders', id, 'aside', 'INVALID_FIELD', 'A field of this order cannot be stored');
const invalidLine = (id: string) =>
  outcome(
    'order_lines',
    id,
    'aside',
    'INVALID_FIELD',
    'A field of this order line cannot be stored'
  );

/**
 * One order entered offline. The judge has already checked scope, the right to create and set the
 * author. The order is stored empty at its delivery cost; its lines follow in `order_lines`, which
 * set the total (the database checks the two agree when the batch commits). Never throws for a
 * business reason, so one order cannot block the phone's batch (C-36).
 */
async function createOrder(ctx: PushContext, row: Row): Promise<LineOutcome> {
  const { tx, viewer } = ctx;
  const id = String(row['id']);
  if (await tx.order.findUnique({ where: { id }, select: { id: true } })) {
    return outcome('orders', id, 'accepted');
  }

  const rawRelationship = row['customer_relationship_id'];
  const deliveryCost = readAmount(row, 'delivery_cost', 0n);
  const address = readText(row, 'delivery_address_applied');
  const note = readText(row, 'customer_note');
  const desired = readDay(row, 'desired_delivery_date');
  const now = new Date();
  const enteredAt = readEnteredAt(row, now);
  if (
    typeof rawRelationship !== 'string' ||
    !UUID.test(rawRelationship) ||
    deliveryCost === INVALID ||
    address === INVALID ||
    note === INVALID ||
    desired === INVALID ||
    enteredAt === INVALID
  ) {
    return invalidOrder(id);
  }

  const relationshipId = await resolveMergedRelation(rawRelationship, tx);
  const relationship = await tx.customerRelationship.findUnique({
    where: { id: relationshipId },
    select: {
      status: true,
      deletedAt: true,
      supplierOrganizationId: true,
      customerPersonId: true,
      customerOrganizationId: true,
      supplierOrganization: { select: { status: true } },
    },
  });
  // The judge has already scoped the line; this only guards the adapter used on its own.
  if (!relationship) return forbidden('orders', id, 'OUT_OF_SCOPE', OUT_OF_SCOPE);
  if (relationship.customerPersonId === null && relationship.customerOrganizationId === null) {
    return outcome('orders', id, 'issue', 'USE_COUNTER_SALE', 'Use a counter sale for a counter');
  }
  if (
    relationship.status !== 'ACTIVE' ||
    relationship.deletedAt !== null ||
    relationship.supplierOrganization?.status !== 'ACTIVE'
  ) {
    return outcome('orders', id, 'issue', 'RELATIONSHIP_NOT_ACTIVE', 'Relationship is not active');
  }
  const supplier = relationship.supplierOrganizationId;
  if (!viewer.memberships.some((m) => m.organizationId === supplier)) {
    return forbidden('orders', id, 'OUT_OF_SCOPE', OUT_OF_SCOPE);
  }

  // A concurrent twin with the same id is a repeat, not an error that would abort the batch.
  await tx.order.createMany({
    data: [
      {
        id,
        customerRelationshipId: relationshipId,
        placedByParty: 'SUPPLIER',
        enteredById: viewer.personId,
        status: 'CONFIRMED',
        deliveryAddressApplied: address,
        deliveryCost,
        totalAmount: orderTotal([], deliveryCost),
        desiredDeliveryDate: desired,
        customerNote: note,
        createdAt: enteredAt,
      },
    ],
    skipDuplicates: true,
  });
  return outcome('orders', id, 'accepted');
}

/** The five statuses, as a phone may name them. */
const ORDER_STATUSES: readonly string[] = [
  'PENDING',
  'CONFIRMED',
  'IN_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] satisfies OrderStatus[];

/** An order status in the words of the message a person reads in `sync_issue`. */
export const STATUS_WORDS: Record<OrderStatus, string> = {
  PENDING: 'en attente',
  CONFIRMED: 'confirmée',
  IN_DELIVERY: 'en cours de livraison',
  DELIVERED: 'livrée',
  CANCELLED: 'annulée',
};

/** Abilities as the server judges them: never online, never past the 3-day window (ACC). */
export const SERVER_CONTEXT = { onServer: true, online: false, daysSinceSync: 0 } as const;

/** What the viewer is to an order: the supplier organization and the role they hold in it. */
export type OrderScope = { organizationId: string; role: CollaborationRole };

/**
 * The viewer's role for an order, from their ACTIVE memberships in its supplier organization; null
 * when the order does not exist, when the viewer is its customer (a customer has no write right
 * here) or when they hold no role in the supplier (ASVS v5.0.0-8.2.2). The caller answers null
 * like an order outside the scope.
 */
export async function scopeOfOrder(ctx: PushContext, orderId: string): Promise<OrderScope | null> {
  const found = await ctx.tx.order.findUnique({
    where: { id: orderId },
    select: {
      customerRelationship: { select: { supplierOrganizationId: true, customerPersonId: true } },
    },
  });
  if (!found) return null;
  const { supplierOrganizationId, customerPersonId } = found.customerRelationship;
  if (customerPersonId === ctx.viewer.personId || supplierOrganizationId === null) return null;
  const membership = ctx.viewer.memberships.find(
    (m) => m.organizationId === supplierOrganizationId
  );
  return membership ? { organizationId: supplierOrganizationId, role: membership.role } : null;
}

/** True when the HTTP error raised by the state machine is a step it does not permit. */
export const isRefusedStep = (error: unknown): boolean =>
  error instanceof Error && (error as { code?: unknown }).code === 'INVALID_TRANSITION';

/** `2026-09-30 10:30 UTC`: the time a person reads in a `sync_issue` message. */
export function formatMoment(moment: Date): string {
  return `${moment.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export const setIssue = (ctx: PushContext, id: string, message: string) =>
  ctx.tx.order.update({ where: { id }, data: { syncIssue: message } });

/** The business problem of a status step: the order keeps its status and carries the message. */
async function orderIssue(
  ctx: PushContext,
  id: string,
  code: string,
  message: string
): Promise<LineOutcome> {
  await setIssue(ctx, id, message);
  return outcome('orders', id, 'issue', code, message);
}

/**
 * A SELLER's (or above) cancellation, through the state machine with `viaSync` (CM-12). An order
 * delivered meanwhile stays delivered and its `sync_issue` names who delivered and when; any other
 * step the machine refuses leaves the status and says why.
 */
async function cancelOrder(ctx: PushContext, id: string, reason: string): Promise<LineOutcome> {
  const { tx, viewer } = ctx;
  try {
    const after = await transitionOrder(
      tx,
      id,
      'CANCELLED',
      { personId: viewer.personId, party: 'SUPPLIER' },
      { cancellationReason: reason },
      { viaSync: true }
    );
    if (after.status === 'CANCELLED') return outcome('orders', id, 'accepted');
    const deliverer = after.deliveredById
      ? await tx.person.findUnique({
          where: { id: after.deliveredById },
          select: { fullName: true },
        })
      : null;
    const when = after.deliveredAt ? ` à ${formatMoment(after.deliveredAt)}` : '';
    const who = deliverer ? ` par ${deliverer.fullName}` : '';
    return orderIssue(
      ctx,
      id,
      'ORDER_ALREADY_DELIVERED',
      `Annulation impossible : commande livrée${who}${when}`
    );
  } catch (error) {
    if (!isRefusedStep(error)) throw error;
    const current = await tx.order.findUniqueOrThrow({ where: { id }, select: { status: true } });
    return orderIssue(
      ctx,
      id,
      'INVALID_TRANSITION',
      `Annulation impossible : commande ${STATUS_WORDS[current.status]}`
    );
  }
}

/**
 * One order edited offline (SYNC-013). The judge has already checked scope and the fields the role
 * may write. Only `supplier_note` (any status) and a status change to CANCELLED are applied here;
 * every other status is reached through deliveries or the closing of an order, so a phone that
 * pushes one directly gets a business problem and the order keeps its status (ASVS v5.0.0-2.3.1).
 * A DRIVER holds departure rights, not cancellation: the judge lets the status field through for
 * them, so the cancellation right is checked again here.
 */
async function updateOrder(ctx: PushContext, row: Row): Promise<LineOutcome> {
  const { tx } = ctx;
  const id = String(row['id']);
  const scope = await scopeOfOrder(ctx, id);
  if (!scope) return forbidden('orders', id, 'OUT_OF_SCOPE', OUT_OF_SCOPE);
  const stored = await tx.order.findUniqueOrThrow({
    where: { id },
    select: { status: true, supplierNote: true },
  });
  const ability = abilityFor(scope.role, SERVER_CONTEXT);

  const note = 'supplier_note' in row ? readText(row, 'supplier_note') : undefined;
  const reason = readText(row, 'cancellation_reason');
  const pushedStatus = row['status'];
  if (
    note === INVALID ||
    reason === INVALID ||
    (pushedStatus !== undefined &&
      (typeof pushedStatus !== 'string' || !ORDER_STATUSES.includes(pushedStatus)))
  ) {
    return invalidOrder(id);
  }
  const noteChanged = note !== undefined && note !== (stored.supplierNote ?? null);
  const statusChanged = pushedStatus !== undefined && pushedStatus !== stored.status;

  if (noteChanged && !ability.can('update', 'Order', 'supplier_note')) {
    return forbidden('orders', id, 'FIELD_NOT_ALLOWED', 'Your role may not make this change');
  }
  if (statusChanged && pushedStatus === 'CANCELLED') {
    if (!ability.can('cancel', 'Order')) {
      return forbidden('orders', id, 'FIELD_NOT_ALLOWED', 'Your role may not make this change');
    }
    if (reason === null) {
      return outcome(
        'orders',
        id,
        'aside',
        'INVALID_FIELD',
        'A cancellation by the supplier needs a reason'
      );
    }
  }

  if (noteChanged) {
    await tx.order.update({ where: { id }, data: { supplierNote: note } });
  }
  if (!statusChanged) return outcome('orders', id, 'accepted');
  if (pushedStatus === 'CANCELLED') return cancelOrder(ctx, id, reason ?? '');
  return orderIssue(
    ctx,
    id,
    'INVALID_TRANSITION',
    'Changement de statut impossible depuis le téléphone : la commande suit ses livraisons'
  );
}

/**
 * Push side of `orders` (SYNC-012, SYNC-013): orders entered offline are created CONFIRMED,
 * placed by the SUPPLIER and entered by the viewer. The totals are the server's (CM-27, CWE-345); a
 * customer that is a counter or whose relationship is not ACTIVE makes the order an issue that is
 * not stored. Edits are the supplier note and the cancellation (see `updateOrder`); a step the
 * state machine does not allow is a business problem, never a refusal of the batch (C-36).
 * Deletions stay refused.
 *
 * @param ctx - Viewer and the batch's transaction; lines arrive already judged.
 * @param change - Judged lines of the table.
 */
export async function pushOrders(ctx: PushContext, change: TableChange): Promise<LineOutcome[]> {
  const outcomes: LineOutcome[] = [];
  for (const row of change.created) outcomes.push(await createOrder(ctx, row));
  for (const row of change.updated) outcomes.push(await updateOrder(ctx, row));
  outcomes.push(...refuseEveryLine({ ...change, created: [], updated: [] }));
  return outcomes;
}

type Touched = { retired: boolean };

/** Recomputes an order's total from its stored lines and delivery cost, and flags retired products. */
async function settleOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  touched: Touched
): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { deliveryCost: true, lines: { where: { deletedAt: null }, select: { amount: true } } },
  });
  await tx.order.update({
    where: { id: orderId },
    data: {
      totalAmount: orderTotal(
        order.lines.map((line) => line.amount),
        order.deliveryCost
      ),
      ...(touched.retired ? { syncIssue: PRODUCT_RETIRED_NOTE } : {}),
    },
  });
}

/**
 * Inserts a line. For a product withdrawn since the entry, the database's ACTIVE-product rule is
 * switched off for this one insert, with a setting that lives only in the transaction and is
 * switched back right after (migration 20261004340000_sync_012_retired_product_lines).
 */
async function insertLine(
  tx: Prisma.TransactionClient,
  data: Prisma.OrderLineCreateManyInput,
  retired: boolean
): Promise<void> {
  if (retired)
    await tx.$executeRaw`SELECT set_config('distribo.allow_retired_product', 'on', true)`;
  try {
    await tx.orderLine.createMany({ data: [data], skipDuplicates: true });
  } finally {
    if (retired) {
      await tx.$executeRaw`SELECT set_config('distribo.allow_retired_product', 'off', true)`;
    }
  }
}

/**
 * One line entered offline, priced from what the phone sent: quantity and prices are kept, the
 * variant is resolved for the order's supplier (a merge is followed, a deleted variant comes back
 * off sale, a foreign one is refused as OUT_OF_SCOPE), and the label and the amount are the
 * server's (CM-27). The line is retired when the variant is no longer on sale. Returns the outcome
 * and whether the line was stored, so the caller can settle its order's total.
 */
async function createLine(
  ctx: PushContext,
  row: Row
): Promise<{ line: LineOutcome; orderId?: string; retired?: boolean }> {
  const { tx, viewer } = ctx;
  const id = String(row['id']);
  if (await tx.orderLine.findUnique({ where: { id }, select: { id: true } })) {
    return { line: outcome('order_lines', id, 'accepted') };
  }

  const orderId = row['order_id'];
  const variantId = row['product_variant_id'];
  const quantityMilli = readQuantity(row);
  const referencePrice = readAmount(row, 'reference_price');
  const unitPriceApplied = readAmount(row, 'unit_price_applied');
  if (
    typeof orderId !== 'string' ||
    typeof variantId !== 'string' ||
    !UUID.test(variantId) ||
    quantityMilli === INVALID ||
    referencePrice === INVALID ||
    unitPriceApplied === INVALID
  ) {
    return { line: invalidLine(id) };
  }
  const amount = lineAmountOf({ quantityMilli, unitPriceApplied });
  if (amount > MAX_AMOUNT) return { line: invalidLine(id) };

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      placedByParty: true,
      enteredById: true,
      deletedAt: true,
      customerRelationship: { select: { supplierOrganizationId: true } },
    },
  });
  const supplier = order?.customerRelationship.supplierOrganizationId ?? null;
  if (!order || !viewer.memberships.some((m) => m.organizationId === supplier)) {
    return { line: forbidden('order_lines', id, 'OUT_OF_SCOPE', OUT_OF_SCOPE) };
  }
  // Only the order the viewer entered, still open, takes a new line: its total must stay editable.
  if (
    order.status !== 'CONFIRMED' ||
    order.placedByParty !== 'SUPPLIER' ||
    order.deletedAt !== null ||
    order.enteredById !== viewer.personId
  ) {
    return {
      line: outcome(
        'order_lines',
        id,
        'aside',
        'ORDER_NOT_EDITABLE',
        'This order takes no new line'
      ),
    };
  }

  // The resolver reads through the supplier of the order, so a variant of another organization is
  // never read, restored or written, whatever the phone says (ASVS 8.2.1). It follows a merge and
  // brings a deleted variant back off sale (C-48).
  const resolved = supplier
    ? await resolveVariantForLine(tx, supplier, variantId, new Date())
    : null;
  if (!resolved) return { line: forbidden('order_lines', id, 'OUT_OF_SCOPE', OUT_OF_SCOPE) };
  // The state after the resolution decides whether the sale outlived its article (design 9.2).
  const variant = await tx.productVariant.findUniqueOrThrow({
    where: { id: resolved.variantId },
    select: {
      status: true,
      deletedAt: true,
      product: { select: { pausedAt: true, deletedAt: true } },
    },
  });
  const retired =
    variant.status !== 'ACTIVE' ||
    variant.deletedAt !== null ||
    variant.product.pausedAt !== null ||
    variant.product.deletedAt !== null;

  const priceChanged = unitPriceApplied !== referencePrice;
  await insertLine(
    tx,
    {
      id,
      orderId,
      productVariantId: resolved.variantId,
      labelApplied: resolved.label,
      quantity: milliToText(quantityMilli),
      referencePrice,
      unitPriceApplied,
      amount,
      ...(priceChanged ? { priceSetById: viewer.personId, priceSetAt: new Date() } : {}),
    },
    retired
  );
  return {
    line: retired
      ? outcome('order_lines', id, 'issue', 'PRODUCT_RETIRED', PRODUCT_RETIRED_NOTE)
      : outcome('order_lines', id, 'accepted'),
    orderId,
    retired,
  };
}

/**
 * Push side of `order_lines` (SYNC-012): the lines of orders entered offline, in the same
 * transaction as their order (ASVS v5.0.0-2.3.3). Quantities go through `parseQuantity` and
 * amounts and totals are recomputed (v5.0.0-2.2.1, CM-27). A line whose unit price differs from
 * the reference price the phone saw is authored by the viewer, dated by the server (CM-16). A
 * product withdrawn since the entry does not refuse the line: the order carries a `sync_issue`.
 * A line names a variant in `product_variant_id`; the old `product_id` key is no longer read, so a
 * line without the new key is set aside as malformed (SYNC-029). Edits and deletions stay refused
 * (SYNC-013).
 *
 * @param ctx - Viewer and the batch's transaction; lines arrive already judged.
 * @param change - Judged lines of the table.
 */
export async function pushOrderLines(
  ctx: PushContext,
  change: TableChange
): Promise<LineOutcome[]> {
  const outcomes: LineOutcome[] = [];
  const touched = new Map<string, Touched>();
  for (const row of change.created) {
    const { line, orderId, retired } = await createLine(ctx, row);
    outcomes.push(line);
    if (orderId !== undefined) {
      touched.set(orderId, { retired: (touched.get(orderId)?.retired ?? false) || !!retired });
    }
  }
  for (const [orderId, flags] of touched) await settleOrder(ctx.tx, orderId, flags);
  outcomes.push(...refuseEveryLine({ ...change, created: [] }));
  return outcomes;
}
