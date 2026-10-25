import type { Prisma } from '@prisma/client';
import { httpError } from '../../lib/http-error.js';
import { findDriversWithOpenDeliveries } from '../delivery/delivery.repository.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import {
  findOrganizationSummary,
  listTeamSeats,
  setSeatPaused,
} from '../organization/organization.repository.js';
import { seatNotice } from './notices.js';
import {
  findLatestKeepChoice,
  insertSeatEvent,
  lockSubscriptions,
} from './subscription.repository.js';

export type SeatEnforcement = { paused: string[]; resumed: string[]; deferred: string[] };

/**
 * Fits non-owner seats to the plan, honoring the latest owner choice before seat age.
 * Every id comes from the tenant-scoped team list, never directly from choice details
 * (ASVS 8.2.2). Status, scope invalidation, SYSTEM journal and localized notice all
 * use the caller's transaction; any failure must abort that transaction (ASVS 2.3.3).
 * Subscription locking serializes repeated enforcement with other billing changes.
 * @param tx Caller-owned transaction, which must not swallow enforcement failures.
 * @param organizationId Organization chosen by trusted server code.
 * @param maxCollaborators Nonnegative seat limit; null restores every eligible seat.
 * @param now Effective time for the immutable journal.
 * @returns Changed collaboration ids and on-road drivers deferred until a later run.
 * @throws NOT_FOUND when the business is missing or deleted.
 */
export async function enforceSeatLimit(
  tx: Prisma.TransactionClient,
  organizationId: string,
  maxCollaborators: number | null,
  now: Date
): Promise<SeatEnforcement> {
  if (
    maxCollaborators !== null &&
    (!Number.isSafeInteger(maxCollaborators) || maxCollaborators < 0)
  ) {
    throw new RangeError('Seat limit must be a nonnegative integer or null');
  }
  await lockSubscriptions(tx, organizationId);
  const business = await findOrganizationSummary(organizationId, tx);
  if (!business) throw httpError(404, 'NOT_FOUND', 'Business not found');

  const seats = await listTeamSeats(tx, organizationId);
  const choice = await findLatestKeepChoice(tx, organizationId);
  const priorities = new Map<string, number>();
  for (const id of choice?.collaborationIds ?? []) {
    if (!priorities.has(id)) priorities.set(id, priorities.size);
  }
  seats.sort((a, b) => {
    const aPriority = priorities.get(a.id) ?? Infinity;
    const bPriority = priorities.get(b.id) ?? Infinity;
    if (aPriority !== bPriority) return aPriority < bPriority ? -1 : 1;
    if ((a.acceptedAt !== null) !== (b.acceptedAt !== null)) return a.acceptedAt ? -1 : 1;
    const age = (a.acceptedAt ?? a.invitedAt).getTime() - (b.acceptedAt ?? b.invitedAt).getTime();
    return age || a.id.localeCompare(b.id);
  });

  const limit = maxCollaborators ?? seats.length;
  const drivers = seats
    .slice(limit)
    .filter((seat) => seat.role === 'DRIVER' && seat.status !== 'PAUSED')
    .map((seat) => seat.personId);
  const onRoad = await findDriversWithOpenDeliveries(tx, organizationId, drivers);
  const result: SeatEnforcement = { paused: [], resumed: [], deferred: [] };

  for (const [index, seat] of seats.entries()) {
    const pause = index >= limit;
    if (pause === (seat.status === 'PAUSED')) continue;
    if (pause && seat.role === 'DRIVER' && onRoad.has(seat.personId)) {
      result.deferred.push(seat.id);
      continue;
    }
    if (!(await setSeatPaused(tx, seat.id, pause))) continue;
    const kind = pause ? 'PAUSED' : 'RESUMED';
    await insertSeatEvent(tx, organizationId, seat.id, kind, now);
    const language = await recipientLanguage(seat.personId, tx);
    await notify(
      {
        recipientId: seat.personId,
        organizationId,
        sourceEvent: pause ? 'subscription.paused' : 'subscription.resumed',
        content: seatNotice(kind, language, business.name),
      },
      tx
    );
    (pause ? result.paused : result.resumed).push(seat.id);
  }
  return result;
}
