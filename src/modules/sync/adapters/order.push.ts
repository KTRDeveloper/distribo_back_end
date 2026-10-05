import type { Prisma } from '@prisma/client';
import { logger } from '../../../lib/logger.js';
import { TEXT_MAX } from '../../../shared/limits.js';
import { parseQuantity } from '../../../shared/money.js';
import { lineAmountOf, orderTotal } from '../../order/order.calculations.js';
import { resolveMergedRelation } from '../../relationship/relationship.repository.js';
import type { LineOutcome, PushContext, Row, TableChange } from '../sync.types.js';
import { refuseEveryLine } from './identity.adapter.js';

/** The note the owner reads when a line names a product withdrawn since the entry (SYNC-012 AC-3). */
export const PRODUCT_RETIRED_NOTE = 'Article retiré de la vente depuis la saisie';

/** Largest amount (XAF) a pushed price, delivery cost or line may reach: sums stay in `bigint`. */
const MAX_AMOUNT = 1_000_000_000_000n;
/** Largest quantity `numeric(12,3)` holds, in thousandths. */
const MAX_QUANTITY_MILLI = 999_999_999_999n;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const INVALID = Symbol('invalid');
type Invalid = typeof INVALID;

const outcome = (
  table: 'orders' | 'order_lines',
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

const forbidden = (
  table: 'orders' | 'order_lines',
  id: string,
  code: string,
  message: string
): LineOutcome => {
  logger.warn({ event: 'sync_line_forbidden', table, recordId: id, code }, 'line refused');
  return outcome(table, id, 'forbidden', code, message);
};

const OUT_OF_SCOPE = 'This line is outside your scope';

/** A text the phone sent: `null` when absent or empty, `INVALID` when unusable. */
function readText(row: Row, key: string): string | null | Invalid {
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
 * The moment the phone says the order was entered (epoch milliseconds or ISO text). A moment after
 * the server's now is a phone clock error: the order is dated now (CM-31).
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
  return parsed.getTime() > now.getTime() ? now : parsed;
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

/**
 * Push side of `orders` (SYNC-012): orders entered offline are created CONFIRMED, placed by the
 * SUPPLIER and entered by the viewer. The totals are the server's (CM-27, CWE-345); a customer
 * that is a counter or whose relationship is not ACTIVE makes the order an issue that is not
 * stored. Status changes and edits are not handled yet and stay refused (SYNC-013).
 *
 * @param ctx - Viewer and the batch's transaction; lines arrive already judged.
 * @param change - Judged lines of the table.
 */
export async function pushOrders(ctx: PushContext, change: TableChange): Promise<LineOutcome[]> {
  const outcomes: LineOutcome[] = [];
  for (const row of change.created) outcomes.push(await createOrder(ctx, row));
  outcomes.push(...refuseEveryLine({ ...change, created: [] }));
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
 * label comes from the product and the amount is computed here (CM-27). Returns the outcome and
 * whether the line was stored, so the caller can settle its order's total.
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
  const productId = row['product_id'];
  const quantityMilli = readQuantity(row);
  const referencePrice = readAmount(row, 'reference_price');
  const unitPriceApplied = readAmount(row, 'unit_price_applied');
  if (
    typeof orderId !== 'string' ||
    typeof productId !== 'string' ||
    !UUID.test(productId) ||
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

  // A product of another organization is never written, whatever the phone says (ASVS 8.2.1).
  const product = await tx.product.findFirst({
    where: { id: productId, organizationId: supplier ?? undefined },
  });
  if (!product) return { line: forbidden('order_lines', id, 'OUT_OF_SCOPE', OUT_OF_SCOPE) };
  const retired = product.status !== 'ACTIVE' || product.deletedAt !== null;

  const priceChanged = unitPriceApplied !== referencePrice;
  await insertLine(
    tx,
    {
      id,
      orderId,
      productId,
      labelApplied: `${product.name} (${product.unit})`,
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
 * Edits and deletions stay refused (SYNC-013).
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
