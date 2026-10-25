import type { Prisma } from '@prisma/client';
import type { Actor as OrganizationActor } from '../../types/express.js';
import { httpError } from '../../lib/http-error.js';
import { listPausedProducts, listProductsOnSale, setProductsPaused } from '../catalog/catalog.repository.js';
import { findDriversWithOpenDeliveries } from '../delivery/delivery.repository.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  findOrganizationSummary,
  listTeamSeats,
  setSeatPaused,
} from '../organization/organization.repository.js';
import { seatNotice } from './notices.js';
import {
  insertKeepChoiceEvent,
  insertOwnerProductEvent,
  insertOwnerSeatEvent,
  lockSubscriptions,
  runInTransaction,
} from './subscription.repository.js';

export type SwapProductInput = { id: string; pauseProductId: string; resumeProductId: string };
export type SwapProductView = { paused_product_id: string; resumed_product_id: string };

/**
 * Exchanges eligible tenant products atomically under the subscription lock (ASVS 8.2.1, 2.3.3).
 * Pause first to preserve C-46's on-sale count; conditional updates, owner events and the
 * current keep choice all roll back if any step fails.
 * @param actor Server-loaded membership; only the owner may swap.
 * @param input Validated gesture and distinct product ids, with route replay protection.
 * @param now Effective transition time for products and their immutable journal.
 * @returns Only the two product ids, never database rows.
 * @throws FORBIDDEN, NOT_FOUND or PRODUCT_STATE without partial writes.
 */
export async function swapProduct(
  actor: OrganizationActor,
  input: SwapProductInput,
  now: Date,
): Promise<SwapProductView> {
  if (actor.role !== 'OWNER') throw httpError(403, 'FORBIDDEN', 'Forbidden');
  return runInTransaction(async (tx) => {
    await lockSubscriptions(tx, actor.organizationId);
    const onSale = await listProductsOnSale(tx, actor.organizationId);
    const paused = await listPausedProducts(tx, actor.organizationId);
    const pauseId = input.pauseProductId.toLowerCase();
    const resumeId = input.resumeProductId.toLowerCase();
    const eligible = new Set([...onSale, ...paused].map((product) => product.productId));
    if (!eligible.has(pauseId) || !eligible.has(resumeId)) {
      throw httpError(404, 'NOT_FOUND', 'Not found');
    }
    const stateError = () => httpError(409, 'PRODUCT_STATE', 'Products cannot be swapped in their current state');
    if (!onSale.some((product) => product.productId === pauseId) ||
        !paused.some((product) => product.productId === resumeId)) throw stateError();
    if ((await setProductsPaused(tx, actor.organizationId, [pauseId], true, now)).length !== 1) {
      throw stateError();
    }
    if ((await setProductsPaused(tx, actor.organizationId, [resumeId], false, now)).length !== 1) {
      throw stateError();
    }
    await insertOwnerProductEvent(tx, actor.organizationId, actor.personId, pauseId, 'PAUSED', now);
    await insertOwnerProductEvent(tx, actor.organizationId, actor.personId, resumeId, 'RESUMED', now);
    await writeCurrentKeepChoice(tx, actor.organizationId, actor.personId);
    return { paused_product_id: pauseId, resumed_product_id: resumeId };
  });
}

export type SwapSeatInput = { id: string; pauseCollaborationId: string; resumeCollaborationId: string };
export type SwapSeatView = { paused_collaboration_id: string; resumed_collaboration_id: string };

/**
 * Snapshots current eligible seats and products so later enforcement preserves an owner swap.
 * @param tx Caller-owned transaction holding the organization's subscription lock.
 * @param organizationId Tenant from the loaded owner membership.
 * @param personId Authenticated owner, never a request-body identity (C-55).
 * @returns Resolves after the immutable KEEP_CHOICE append.
 */
export async function writeCurrentKeepChoice(
  tx: Prisma.TransactionClient,
  organizationId: string,
  personId: string,
): Promise<void> {
  const seats = await listTeamSeats(tx, organizationId);
  const products = await listProductsOnSale(tx, organizationId);
  await insertKeepChoiceEvent(tx, organizationId, personId, {
    collaboration_ids: seats.filter((seat) => seat.status !== 'PAUSED').map((seat) => seat.id),
    product_ids: products.map((product) => product.productId),
  });
}

/**
 * Exchanges two tenant-scoped non-owner seats under the billing lock (ASVS 8.2.1, 2.3.3).
 * Pausing first preserves the occupied seat count (C-42). Conditional-update failures abort
 * both transitions; journal, scope invalidation, notices and keep choice commit together.
 * @param actor Server-loaded organization membership; only the owner may swap.
 * @param input Validated gesture and distinct seat ids; the route provides replay protection.
 * @param now Effective time for the owner transition journal.
 * @returns Only the paused and resumed collaboration ids.
 * @throws FORBIDDEN, NOT_FOUND, SEAT_STATE or DRIVER_ON_DELIVERY without partial writes.
 */
export async function swapSeat(
  actor: OrganizationActor,
  input: SwapSeatInput,
  now: Date,
): Promise<SwapSeatView> {
  if (actor.role !== 'OWNER') throw httpError(403, 'FORBIDDEN', 'Forbidden');
  return runInTransaction(async (tx) => {
    await lockSubscriptions(tx, actor.organizationId);
    const seats = await listTeamSeats(tx, actor.organizationId);
    const pause = seats.find((seat) => seat.id === input.pauseCollaborationId.toLowerCase());
    const resume = seats.find((seat) => seat.id === input.resumeCollaborationId.toLowerCase());
    if (!pause || !resume) throw httpError(404, 'NOT_FOUND', 'Not found');
    const stateError = () => httpError(409, 'SEAT_STATE', 'Seats cannot be swapped in their current state');
    if (pause.status === 'PAUSED' || resume.status !== 'PAUSED') throw stateError();
    if (pause.role === 'DRIVER') {
      const onRoad = await findDriversWithOpenDeliveries(tx, actor.organizationId, [pause.personId]);
      if (onRoad.has(pause.personId)) {
        throw httpError(409, 'DRIVER_ON_DELIVERY', 'Driver has an open delivery');
      }
    }
    const business = await findOrganizationSummary(actor.organizationId, tx);
    if (!business) throw httpError(404, 'NOT_FOUND', 'Not found');
    if (!(await setSeatPaused(tx, pause.id, true))) throw stateError();
    if (!(await setSeatPaused(tx, resume.id, false))) throw stateError();
    for (const [seat, kind] of [[pause, 'PAUSED'], [resume, 'RESUMED']] as const) {
      await insertOwnerSeatEvent(tx, actor.organizationId, actor.personId, seat.id, kind, now);
      const language = await recipientLanguage(seat.personId, tx);
      await notify({
        recipientId: seat.personId,
        organizationId: actor.organizationId,
        sourceEvent: kind === 'PAUSED' ? 'subscription.paused' : 'subscription.resumed',
        content: seatNotice(kind, language, business.name),
      }, tx);
    }
    await writeCurrentKeepChoice(tx, actor.organizationId, actor.personId);
    return { paused_collaboration_id: pause.id, resumed_collaboration_id: resume.id };
  });
}
