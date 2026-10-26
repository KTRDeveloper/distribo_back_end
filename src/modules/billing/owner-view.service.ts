import type { Actor as OrganizationActor } from '../../types/express.js';
import { httpError } from '../../lib/http-error.js';
import type { PlanCode } from '../../shared/plans.js';
import { listTeamSeats } from '../organization/organization.repository.js';
import { listProductsOnSale } from '../catalog/catalog.repository.js';
import { addDays, GRACE_DAYS } from './plan-math.js';
import { computeRights } from './rights.service.js';
import {
  findLastExpiredPeriod, listQueue, runInTransaction,
} from './subscription.repository.js';

export type AfterEnd = {
  plan: PlanCode;
  collaborators_to_pause: number;
  products_to_pause: number;
};

export type OwnerBillingView = {
  plan: PlanCode;
  plan_ends_at: Date | null;
  grace_ends_at: Date | null;
  max_collaborators: number | null;
  max_products: number | null;
  periods: { plan: PlanCode; status: 'ACTIVE' | 'SCHEDULED'; starts_at: Date; ends_at: Date }[];
  usage: { collaborators: number; products: number };
  after_end: AfterEnd | null;
};

/** Reads only contract projections; never refreshes stored rights or lifecycle statuses. */
async function readBilling(organizationId: string, now: Date): Promise<OwnerBillingView> {
  return runInTransaction(async (tx) => {
    const queue = await listQueue(tx, organizationId);
    const lastExpired = await findLastExpiredPeriod(tx, organizationId);
    const seats = await listTeamSeats(tx, organizationId);
    const products = await listProductsOnSale(tx, organizationId);
    const usage = {
      collaborators: seats.filter((seat) => seat.status === 'ACTIVE' || seat.status === 'INVITED').length,
      products: products.length,
    };
    const rights = computeRights(queue, lastExpired, now);
    let afterEnd: AfterEnd | null = null;
    if (rights.plan !== 'FREE' && rights.planEndsAt) {
      const next = computeRights(queue, lastExpired, addDays(rights.planEndsAt, GRACE_DAYS));
      afterEnd = {
        plan: next.plan,
        collaborators_to_pause: next.maxCollaborators === null
          ? 0 : Math.max(0, usage.collaborators - next.maxCollaborators),
        products_to_pause: next.maxProducts === null
          ? 0 : Math.max(0, usage.products - next.maxProducts),
      };
    }
    return {
      plan: rights.plan,
      plan_ends_at: rights.planEndsAt,
      grace_ends_at: rights.graceEndsAt,
      max_collaborators: rights.maxCollaborators,
      max_products: rights.maxProducts,
      periods: queue.map((period) => ({
        plan: period.plan, status: period.status, starts_at: period.startsAt, ends_at: period.endsAt,
      })),
      usage,
      after_end: afterEnd,
    };
  });
}

/**
 * Projects the owner's subscription screen without writing rights, periods or events.
 * The service enforces OWNER independently of HTTP authorization (ASVS 8.2.1);
 * every read uses the organization from loadActor, never a client-supplied identity.
 * @param actor Server-loaded membership, including its trusted organization scope.
 * @param now Server reference instant used for both current rights and the preview.
 * @returns Only plan fields, live periods, usage counts and the end-of-grace preview.
 * @throws FORBIDDEN when the actor is not the owner.
 */
export async function readOwnerBilling(actor: OrganizationActor, now: Date): Promise<OwnerBillingView> {
  if (actor.role !== 'OWNER') throw httpError(403, 'FORBIDDEN', 'Forbidden');
  return readBilling(actor.organizationId, now);
}

/**
 * Gives reminder jobs the same preview as the owner at the exact end-of-grace boundary.
 * @param organizationId Organization selected by trusted server code, not a public lookup.
 * @param now Reference instant used to determine the current plan and its paid end.
 * @returns Null for FREE; otherwise the next plan and excess usage, with null limits unlimited.
 */
export async function readAfterEnd(organizationId: string, now: Date): Promise<AfterEnd | null> {
  return (await readBilling(organizationId, now)).after_end;
}
