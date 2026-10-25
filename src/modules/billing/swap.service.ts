import type { Prisma } from '@prisma/client';
import type { Actor as OrganizationActor } from '../../types/express.js';
import { httpError } from '../../lib/http-error.js';
import { listProductsOnSale } from '../catalog/catalog.repository.js';
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
  insertOwnerSeatEvent,
  lockSubscriptions,
  runInTransaction,
} from './subscription.repository.js';

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
