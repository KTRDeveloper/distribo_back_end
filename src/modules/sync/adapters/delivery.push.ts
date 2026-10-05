import type { Delivery, OrderStatus } from '@prisma/client';
import { abilityFor } from '../../../shared/access/ability.js';
import {
  deleteUnstartedDeliveries,
  findDeliveryInProgress,
  insertDepartedDelivery,
  lockDeliveryToFail,
  lockOrderToAssign,
  markDeparted,
  markFailed,
} from '../../delivery/delivery.repository.js';
import { transitionOrder } from '../../order/order.state.js';
import type { LineOutcome, PushContext, Row, TableChange } from '../sync.types.js';
import { refuseEveryLine } from './identity.adapter.js';
import {
  forbidden,
  INVALID,
  isRefusedStep,
  outcome,
  OUT_OF_SCOPE,
  readText,
  scopeOfOrder,
  SERVER_CONTEXT,
  setIssue,
  STATUS_WORDS,
  type Invalid,
  type OrderScope,
} from './order.push.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NOT_ALLOWED = 'Your role may not make this change';

/** The text a second departure carries when another driver already left with the order (CM-23). */
const takenBy = (name: string): string => `Livraison déjà prise par ${name}`;

const wordsOf = (status: string): string => STATUS_WORDS[status as OrderStatus] ?? status;

const asideInvalid = (id: string): LineOutcome =>
  outcome('deliveries', id, 'aside', 'INVALID_FIELD', 'A field of this delivery cannot be stored');

/**
 * A moment the phone sends (epoch milliseconds or ISO text); a moment after the server's now is a
 * phone clock error and is dated now (CM-31). `null` when absent, `INVALID` when unusable.
 */
function readMoment(row: Row, key: string, now: Date): Date | null | Invalid {
  const value = row[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return INVALID;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return INVALID;
  return parsed.getTime() > now.getTime() ? now : parsed;
}

/** What the phone says about the delivery's closing, beyond the departure. */
type Failure = { at: Date; reason: string };

/** Why a delivery cannot be stored as sent: the delivery keeps its state and says so (C-36). */
async function deliveryIssue(
  ctx: PushContext,
  id: string,
  code: string,
  message: string
): Promise<LineOutcome> {
  await ctx.tx.delivery.update({ where: { id }, data: { syncIssue: message } });
  return outcome('deliveries', id, 'issue', code, message);
}

async function nameOf(ctx: PushContext, personId: string | null): Promise<string> {
  if (personId === null) return 'un autre livreur';
  const person = await ctx.tx.person.findUnique({
    where: { id: personId },
    select: { fullName: true },
  });
  return person?.fullName ?? 'un autre livreur';
}

/**
 * Ends a delivery in progress as failed and puts the order back to CONFIRMED (DLV-006, CM-12). The
 * caller holds the order lock and has checked the delivery is departed and not closed.
 */
async function applyFailure(
  ctx: PushContext,
  delivery: { id: string; orderId: string },
  failure: Failure
): Promise<LineOutcome> {
  const { tx, viewer } = ctx;
  try {
    await transitionOrder(tx, delivery.orderId, 'CONFIRMED', {
      personId: viewer.personId,
      party: 'SUPPLIER',
    });
  } catch (error) {
    if (!isRefusedStep(error)) throw error;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: delivery.orderId },
      select: { status: true },
    });
    return deliveryIssue(
      ctx,
      delivery.id,
      'INVALID_TRANSITION',
      `Échec impossible : commande ${wordsOf(order.status)}`
    );
  }
  // Under the order lock the delivery is still in progress; anything else is an unexpected state.
  if (!(await markFailed(tx, delivery.id, failure.at, failure.reason))) {
    throw new Error('A delivery in progress could not be marked failed');
  }
  return outcome('deliveries', delivery.id, 'accepted');
}

type Departure = {
  id: string;
  orderId: string;
  scope: OrderScope;
  departedAt: Date;
  failure: Failure | null;
  /** The stored delivery that has not left yet, when the departure arrives as an update. */
  stored: Delivery | null;
};

/** Stores a delivery closed because another driver already has the order (CM-23, C-36). */
async function storeCrossed(
  ctx: PushContext,
  departure: Departure,
  firstDriverId: string | null
): Promise<LineOutcome> {
  const text = takenBy(await nameOf(ctx, firstDriverId));
  const closed = {
    departedAt: departure.departedAt,
    failedAt: new Date(),
    failureReason: text,
    syncIssue: text,
  };
  if (departure.stored) {
    await ctx.tx.delivery.update({ where: { id: departure.id }, data: closed });
  } else {
    await ctx.tx.delivery.create({
      data: {
        id: departure.id,
        orderId: departure.orderId,
        assignedToId: ctx.viewer.personId,
        ...closed,
      },
    });
  }
  return outcome('deliveries', departure.id, 'issue', 'DELIVERY_TAKEN', text);
}

/**
 * A departure: the order is locked, so two phones that left with it settle one after the other
 * (ASVS v5.0.0-2.3.4, backed by the unique in-progress index). The first delivery in progress
 * keeps the order; the other is stored closed. A delivery assigned but not yet left is replaced
 * by the one of the driver it was assigned to, or of a MANAGER or OWNER (as DLV-005); a DRIVER or
 * SELLER taking an order assigned to someone else is a crossed departure.
 */
async function depart(ctx: PushContext, departure: Departure): Promise<LineOutcome> {
  const { tx, viewer } = ctx;
  const order = await lockOrderToAssign(tx, departure.orderId, departure.scope.organizationId);
  if (!order) return forbidden('deliveries', departure.id, 'OUT_OF_SCOPE', OUT_OF_SCOPE);

  const inProgress = await findDeliveryInProgress(tx, departure.orderId);
  const other = inProgress && inProgress.id !== departure.id ? inProgress : null;
  const mayTakeOver = departure.scope.role === 'MANAGER' || departure.scope.role === 'OWNER';
  const taken =
    order.status === 'IN_DELIVERY' ||
    (other !== null &&
      (other.departedAt !== null || (other.assignedToId !== viewer.personId && !mayTakeOver)));
  if (taken) return storeCrossed(ctx, departure, other?.assignedToId ?? null);

  const refuse = async (code: string, message: string): Promise<LineOutcome> => {
    await setIssue(ctx, departure.orderId, message);
    return outcome('deliveries', departure.id, 'issue', code, message);
  };
  if (order.status !== 'CONFIRMED') {
    return refuse('INVALID_TRANSITION', `Départ impossible : commande ${wordsOf(order.status)}`);
  }
  if (order.deliveryAddress === null || order.deliveryAddress.trim() === '') {
    return refuse('NO_DELIVERY_ADDRESS', 'Départ impossible : adresse de livraison manquante');
  }

  if (other) await deleteUnstartedDeliveries(tx, departure.orderId);
  try {
    await transitionOrder(tx, departure.orderId, 'IN_DELIVERY', {
      personId: viewer.personId,
      party: 'SUPPLIER',
    });
  } catch (error) {
    if (!isRefusedStep(error)) throw error;
    return refuse('INVALID_TRANSITION', 'Départ impossible : la commande a changé de statut');
  }

  if (departure.stored) {
    await markDeparted(tx, departure.id, viewer.personId, departure.departedAt);
  } else {
    await insertDepartedDelivery(tx, {
      id: departure.id,
      orderId: departure.orderId,
      assignedToId: viewer.personId,
      departedAt: departure.departedAt,
    });
  }
  if (departure.failure) return applyFailure(ctx, departure, departure.failure);
  return outcome('deliveries', departure.id, 'accepted');
}

/**
 * The failure or closing side a phone may send with a delivery. `arrived_at` belongs to the
 * closing of the order (SYNC-015) and is set aside here. A failure needs its reason.
 */
function readFailure(row: Row, now: Date): Failure | null | Invalid {
  const at = readMoment(row, 'failed_at', now);
  const reason = readText(row, 'failure_reason');
  if (at === INVALID || reason === INVALID) return INVALID;
  if (at === null) return null;
  return reason === null ? INVALID : { at, reason };
}

const closingNotApplied = (id: string): LineOutcome =>
  outcome(
    'deliveries',
    id,
    'aside',
    'DELIVERY_CLOSING_NOT_APPLIED',
    'The arrival of a delivery is not applied from this line'
  );

/**
 * One delivery created offline: the departure of the viewer. The server makes the viewer the
 * driver whatever `assigned_to_id` says and moves the order to IN_DELIVERY. A repeat of the same
 * delivery changes nothing (C-36). A delivery of the viewer that is already stored is the same
 * line again; one that belongs to someone else is answered like a line outside the scope.
 */
async function createDelivery(ctx: PushContext, row: Row): Promise<LineOutcome> {
  const { tx, viewer } = ctx;
  const id = String(row['id']);
  const orderId = row['order_id'];

  const existing = await tx.delivery.findUnique({ where: { id } });
  if (existing) {
    return existing.assignedToId === viewer.personId && existing.orderId === orderId
      ? outcome('deliveries', id, 'accepted')
      : forbidden('deliveries', id, 'OUT_OF_SCOPE', OUT_OF_SCOPE);
  }
  if (typeof orderId !== 'string' || !UUID.test(orderId)) return asideInvalid(id);

  const now = new Date();
  const departedAt = readMoment(row, 'departed_at', now);
  const failure = readFailure(row, now);
  if (departedAt === null || departedAt === INVALID || failure === INVALID) return asideInvalid(id);
  if (row['arrived_at'] !== undefined && row['arrived_at'] !== null) return closingNotApplied(id);

  const scope = await scopeOfOrder(ctx, orderId);
  if (!scope) return forbidden('deliveries', id, 'OUT_OF_SCOPE', OUT_OF_SCOPE);
  const ability = abilityFor(scope.role, SERVER_CONTEXT);
  if (!ability.can('depart', 'Order') || (failure && !ability.can('fail_delivery', 'Order'))) {
    return forbidden('deliveries', id, 'FIELD_NOT_ALLOWED', NOT_ALLOWED);
  }
  return depart(ctx, { id, orderId, scope, departedAt, failure, stored: null });
}

/**
 * One delivery changed offline: its failure (the order goes back to CONFIRMED) or the departure
 * of a delivery that was assigned to the viewer. Only the assigned driver, a MANAGER or an OWNER
 * may act on it; for anyone else it does not exist (ASVS v5.0.0-8.2.1). A failure that does not
 * fit the delivery or the order's status leaves both and says why in the delivery's `sync_issue`.
 */
async function updateDelivery(ctx: PushContext, row: Row): Promise<LineOutcome> {
  const { tx, viewer } = ctx;
  const id = String(row['id']);
  const stored = await tx.delivery.findUnique({ where: { id } });
  const scope = stored && !stored.deletedAt ? await scopeOfOrder(ctx, stored.orderId) : null;
  const mayAct =
    scope !== null &&
    stored !== null &&
    (scope.role === 'MANAGER' || scope.role === 'OWNER' || stored.assignedToId === viewer.personId);
  if (!stored || !scope || !mayAct)
    return forbidden('deliveries', id, 'OUT_OF_SCOPE', OUT_OF_SCOPE);

  const now = new Date();
  const departedAt = readMoment(row, 'departed_at', now);
  const failure = readFailure(row, now);
  if (departedAt === INVALID || failure === INVALID) return asideInvalid(id);
  if (row['arrived_at'] && stored.arrivedAt === null) return closingNotApplied(id);

  const wantsDeparture = departedAt !== null && stored.departedAt === null;
  const wantsFailure = failure !== null && stored.failedAt === null;
  if (!wantsDeparture && !wantsFailure) return outcome('deliveries', id, 'accepted');

  const ability = abilityFor(scope.role, SERVER_CONTEXT);
  if (
    (wantsDeparture && !ability.can('depart', 'Order')) ||
    (wantsFailure && !ability.can('fail_delivery', 'Order'))
  ) {
    return forbidden('deliveries', id, 'FIELD_NOT_ALLOWED', NOT_ALLOWED);
  }
  const closing = wantsFailure ? failure : null;
  if (wantsDeparture) {
    return depart(ctx, {
      id,
      orderId: stored.orderId,
      scope,
      departedAt,
      failure: closing,
      stored,
    });
  }

  const locked = await lockDeliveryToFail(tx, id, scope.organizationId);
  if (!locked) return forbidden('deliveries', id, 'OUT_OF_SCOPE', OUT_OF_SCOPE);
  if (locked.failedAt !== null) return outcome('deliveries', id, 'accepted');
  if (locked.arrivedAt !== null) {
    return deliveryIssue(
      ctx,
      id,
      'INVALID_TRANSITION',
      'Échec impossible : livraison déjà arrivée'
    );
  }
  if (locked.departedAt === null) {
    return deliveryIssue(ctx, id, 'INVALID_TRANSITION', 'Échec impossible : livraison non partie');
  }
  return applyFailure(ctx, locked, failure as Failure);
}

/**
 * Push side of `deliveries` (SYNC-013): departures and failures made offline. Each is applied only
 * when the order's state machine allows it (CM-12, ASVS v5.0.0-2.3.1); crossed departures keep the
 * first delivery and store the other closed (CM-23); a step not allowed is a business problem on
 * the line, never a refusal of the batch (C-36). The driver, the order's organization and the
 * role come from the session and the stored order, never from the line (ASVS v5.0.0-8.2.1).
 * Deletions stay refused.
 *
 * @param ctx - Viewer and the batch's transaction; lines arrive already judged.
 * @param change - Judged lines of the table.
 */
export async function pushDeliveries(
  ctx: PushContext,
  change: TableChange
): Promise<LineOutcome[]> {
  const outcomes: LineOutcome[] = [];
  for (const row of change.created) outcomes.push(await createDelivery(ctx, row));
  for (const row of change.updated) outcomes.push(await updateDelivery(ctx, row));
  outcomes.push(...refuseEveryLine({ ...change, created: [], updated: [] }));
  return outcomes;
}
