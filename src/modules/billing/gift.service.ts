import { Prisma } from '@prisma/client';
import type { PaidPlanCode } from '../../shared/plans.js';
import { httpError } from '../../lib/http-error.js';
import { recordAdminAction } from '../admin/admin.repository.js';
import { findOrganizationSummary } from '../organization/organization.repository.js';
import { notifyOwnerOfAdjustment } from './adjustment-notice.js';
import { addGiftForfait } from './forfait.service.js';
import { enforceLimits } from './limits.service.js';
import { recomputeRights } from './rights.service.js';
import { findPeriod, lockSubscriptions, runInTransaction, type PeriodRow } from './subscription.repository.js';

export type GiftDaysInput = { id: string; plan: PaidPlanCode; days: number; reason: string };
export type GiftView = {
  id: string;
  plan: PaidPlanCode;
  days: number;
  status: 'ACTIVE' | 'SCHEDULED' | 'ENDED';
  starts_at: string;
  ends_at: string;
};

function giftView(period: PeriodRow): GiftView {
  return {
    id: period.id, plan: period.plan,
    days: (period.endsAt.getTime() - period.startsAt.getTime()) / 86_400_000,
    status: period.status, starts_at: period.startsAt.toISOString(), ends_at: period.endsAt.toISOString(),
  };
}

/**
 * Gives a paid plan's days atomically with its audit, rights, limits and owner notice.
 * The subscription lock serializes duplicate ids before any write; a replay never
 * re-enforces limits or sends notices. C-55 actor ids come only from the trusted admin.
 * @param admin Authenticated SUPER_ADMIN context, authorized by the route (ASVS 8.2.1).
 * @param organizationId Validated target business id from the path.
 * @param input Strictly validated writable gift fields (ASVS 15.3.3).
 * @param now Reference instant shared by all changes in the transaction (ASVS 2.3.3).
 * @returns The explicit gift period projection, including on an idempotent repeat.
 * @throws NOT_FOUND for an absent business or ID_USED for an incompatible existing period.
 */
export async function giveDays(
  admin: { administratorId: string },
  organizationId: string,
  input: GiftDaysInput,
  now: Date,
): Promise<GiftView> {
  return runInTransaction(async (tx) => {
    if (!await findOrganizationSummary(organizationId, tx)) {
      throw httpError(404, 'NOT_FOUND', 'Business not found');
    }
    await lockSubscriptions(tx, organizationId);
    const existing = await findPeriod(tx, input.id);
    if (existing) {
      if (
        existing.origin !== 'GIFT' || existing.organizationId !== organizationId ||
        existing.plan !== input.plan ||
        existing.endsAt.getTime() - existing.startsAt.getTime() !== input.days * 86_400_000
      ) {
        throw httpError(409, 'ID_USED', 'Gift id already used');
      }
      return giftView(existing);
    }
    const action = await recordAdminAction(tx, {
      administratorId: admin.administratorId, action: 'GIFT_DAYS',
      targetOrganizationId: organizationId, reason: input.reason,
    });
    let period: PeriodRow;
    try {
      period = await addGiftForfait(tx, {
        id: input.id, organizationId, plan: input.plan, days: input.days,
        actor: { administratorId: admin.administratorId, adminActionId: action.id }, now,
      });
    } catch (error) {
      // Different businesses hold different locks: the primary key decides an id race.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' &&
        error.meta?.modelName === 'Subscription'
      ) {
        throw httpError(409, 'ID_USED', 'Gift id already used');
      }
      throw error;
    }
    const rights = await recomputeRights(tx, organizationId, now);
    await enforceLimits(tx, organizationId, rights, now);
    await notifyOwnerOfAdjustment(tx, organizationId, { kind: 'GIFT', plan: input.plan, days: input.days });
    return giftView(period);
  });
}
