import type { Order, OrderLine, Prisma } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { getReferencePrice } from '../catalog/catalog.repository.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { formatMoment } from './adapters/order.push.js';
import type { PushContext } from './sync.types.js';

/** What the owner is told when a batch left something to review. */
export const ANOMALIES_EVENT = 'sync.anomalies';

/** An order dated further ahead of the server than this is a phone clock error (CM-31). */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** An order older than the device's previous sync by more than this is out of order. */
const OUT_OF_ORDER_DAYS = 92;
const DAY_MS = 86_400_000;
/** Africa/Douala is UTC+1 all year: the clock of the people who read the messages. */
const DOUALA_OFFSET_MS = 3_600_000;
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `3200` as `3 200`, the way a person reads an amount in francs. */
export const francs = (amount: bigint): string =>
  amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** `lundi à 8 h` or `lundi à 8 h 05`, in Douala time. */
export function whenWords(moment: Date): string {
  const local = new Date(moment.getTime() + DOUALA_OFFSET_MS);
  const minutes = local.getUTCMinutes();
  const clock = `${local.getUTCHours()} h${minutes === 0 ? '' : ` ${String(minutes).padStart(2, '0')}`}`;
  return `${WEEKDAYS[local.getUTCDay()]} à ${clock}`;
}

/**
 * Checks the lines of an order against the prices the server holds. A phone's reference price that
 * differs from the current one is read two ways: the price changed after the order was entered
 * (PRICE_CHANGED, the line is no gap by the seller), or it did not, so the phone's claim is false
 * and the line is corrected to the server's price, which makes any discount visible again
 * (CWE-345, ASVS v5.0.0-2.3.1).
 */
async function priceControl(
  tx: Prisma.TransactionClient,
  order: Order,
  lines: OrderLine[]
): Promise<string | null> {
  const parts: string[] = [];
  const products = await tx.product.findMany({
    where: { id: { in: lines.map((line) => line.productId) } },
    select: { id: true, status: true, deletedAt: true },
  });
  const retired = new Set(
    products.filter((p) => p.status !== 'ACTIVE' || p.deletedAt !== null).map((p) => p.id)
  );
  for (const line of lines) {
    const current = await getReferencePrice(tx, order.customerRelationshipId, line.productId);
    if (line.referencePrice === current.price) continue;
    if (current.changedAt.getTime() > order.createdAt.getTime()) {
      // A withdrawn article's price will not be applied again: PRODUCT_RETIRED already says it.
      if (retired.has(line.productId)) continue;
      const said = `vendu ${francs(line.unitPriceApplied)} ; prix passé à ${francs(current.price)} ${whenWords(current.changedAt)}`;
      parts.push(lines.length > 1 ? `${line.labelApplied} : ${said}` : said);
      continue;
    }
    // The price has stood since before the order: the phone's reference never existed.
    const gap = line.unitPriceApplied !== current.price;
    await tx.orderLine.update({
      where: { id: line.id },
      data: {
        referencePrice: current.price,
        priceSetById: gap ? order.enteredById : null,
        priceSetAt: gap ? new Date() : null,
      },
    });
    logger.warn(
      { event: 'sync_reference_price_corrected', orderId: order.id, lineId: line.id },
      'pushed reference price differs from the price the server holds'
    );
  }
  return parts.length > 0 ? `PRICE_CHANGED: ${parts.join(', ')}` : null;
}

/** The device's previous `last_synced_at`, null when unknown. */
async function previousSync(ctx: PushContext): Promise<Date | null> {
  if (!UUID.test(ctx.viewer.deviceId)) return null;
  const device = await ctx.tx.device.findFirst({
    where: { id: ctx.viewer.deviceId, personId: ctx.viewer.personId },
    select: { lastSyncedAt: true },
  });
  return device?.lastSyncedAt ?? null;
}

async function dateControls(ctx: PushContext, order: Order): Promise<string[]> {
  const messages: string[] = [];
  if (order.createdAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    messages.push(
      `DATE_IN_FUTURE: commande datée du ${formatMoment(order.createdAt)}, après l'heure du serveur`
    );
  }
  const last = await previousSync(ctx);
  if (last && order.createdAt.getTime() < last.getTime() - OUT_OF_ORDER_DAYS * DAY_MS) {
    messages.push(
      `DATE_OUT_OF_ORDER: commande datée du ${formatMoment(order.createdAt)}, plus de ${OUT_OF_ORDER_DAYS} jours avant la dernière synchronisation (${formatMoment(last)})`
    );
  }
  return messages;
}

/**
 * The controls on arrival for one stored order: old prices, claimed reference prices, odd dates.
 * Controls never refuse (CM-28, CM-31): each problem is written to the order's `sync_issue` as
 * `CODE: message`, joined to what is there with " ; ". A code already on the order is not added
 * again, so a repeated push changes nothing. Runs on the server against current data
 * (ASVS v5.0.0-2.3.1), in the batch's transaction, after the order's lines are stored.
 *
 * @returns The messages added by this run (empty when the order is clean or already flagged).
 */
export async function runControls(
  tx: Prisma.TransactionClient,
  ctx: PushContext,
  order: Order
): Promise<string[]> {
  const lines = await tx.orderLine.findMany({
    where: { orderId: order.id, deletedAt: null },
    orderBy: { id: 'asc' },
  });
  const price = await priceControl(tx, order, lines);
  const found = [...(price ? [price] : []), ...(await dateControls(ctx, order))];
  const added = found.filter((message) => {
    const code = message.slice(0, message.indexOf(':') + 1);
    return !(order.syncIssue ?? '').includes(code);
  });
  if (added.length > 0) {
    await tx.order.update({
      where: { id: order.id },
      data: { syncIssue: [...(order.syncIssue ? [order.syncIssue] : []), ...added].join(' ; ') },
    });
  }
  return added;
}

const COUNT_WORDS = {
  FR: (n: number) => `${n} écarts à vérifier`,
  EN: (n: number) => `${n} discrepancies to review`,
};

/** One `sync.anomalies` notification per OWNER of the organization (v5.0.0-16.3.3). */
async function tellOwners(ctx: PushContext, organizationId: string, count: number) {
  const owners = await ctx.tx.collaboration.findMany({
    where: {
      organizationId,
      role: 'OWNER',
      status: 'ACTIVE',
      deletedAt: null,
      person: { registeredAt: { not: null } },
    },
    select: { personId: true },
  });
  for (const { personId } of owners) {
    const language = await recipientLanguage(personId, ctx.tx);
    await notify(
      {
        recipientId: personId,
        organizationId,
        sourceEvent: ANOMALIES_EVENT,
        content: COUNT_WORDS[language](count),
      },
      ctx.tx
    );
  }
}

/**
 * Runs the controls on the orders a batch stored, then tells each owner of the organizations
 * concerned once, with the number of issues found. Only orders the viewer entered, in an
 * organization the viewer belongs to, are controlled (ASVS v5.0.0-8.2.2): an id that names
 * someone else's order is left alone.
 *
 * @param ctx - Viewer and the batch's transaction.
 * @param orderIds - Orders the batch created, whatever happened to them since.
 */
export async function runBatchControls(ctx: PushContext, orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  const orders = await ctx.tx.order.findMany({
    where: { id: { in: orderIds }, enteredById: ctx.viewer.personId, deletedAt: null },
    include: { customerRelationship: { select: { supplierOrganizationId: true } } },
    orderBy: { id: 'asc' },
  });
  const issues = new Map<string, number>();
  for (const { customerRelationship, ...order } of orders) {
    const organizationId = customerRelationship.supplierOrganizationId;
    if (
      !organizationId ||
      !ctx.viewer.memberships.some((m) => m.organizationId === organizationId)
    ) {
      continue;
    }
    const added = await runControls(ctx.tx, ctx, order);
    if (added.length > 0)
      issues.set(organizationId, (issues.get(organizationId) ?? 0) + added.length);
  }
  for (const [organizationId, count] of issues) await tellOwners(ctx, organizationId, count);
}
