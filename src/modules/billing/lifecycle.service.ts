import { PLANS } from '../../shared/plans.js';
import { registerLifecycleHook } from '../organization/lifecycle-hooks.js';
import { readPlanFields, writePlanFields } from '../organization/organization.repository.js';
import { enforceLimits } from './limits.service.js';
import { recomputeRights } from './rights.service.js';
import { endPeriod, insertSystemEvent, listQueue, lockSubscriptions } from './subscription.repository.js';

let registered = false;

/**
 * Attaches billing once at startup; hooks share the organization's transaction.
 * Close ends only the trusted tenant's locked queue and clears even grace rights,
 * without pausing resources: organization closure revokes the team itself.
 * Reopen derives current paid rights before enforcing limits, including purchases
 * made while closed. Any failure propagates to abort the lifecycle change
 * (BIL-031, C-52, ASVS 2.3.3 and 8.2.2).
 * @returns Nothing; repeated registration leaves the original hook unchanged.
 */
export function registerBillingLifecycleHooks(): void {
  if (registered) return;
  registerLifecycleHook({
    onClose: async (tx, organizationId, now) => {
      await lockSubscriptions(tx, organizationId);
      const queue = await listQueue(tx, organizationId);
      const before = await readPlanFields(tx, organizationId);
      if (!before) throw new Error('Billing close requires an existing organization');

      for (const period of queue) {
        const endsAt = period.status === 'SCHEDULED'
          ? period.startsAt
          : new Date(Math.min(period.endsAt.getTime(), now.getTime()));
        await endPeriod(tx, period.id, endsAt, 'CLOSED');
        await insertSystemEvent(tx, organizationId, 'FORFAIT_ENDED', period.id, { reason: 'CLOSED' }, now);
      }
      await writePlanFields(tx, organizationId, {
        plan: 'FREE', planEndsAt: null, graceEndsAt: null,
        maxCollaborators: PLANS.FREE.maxCollaborators,
        maxProducts: PLANS.FREE.maxProducts,
      });
      if (before.plan !== 'FREE') {
        await insertSystemEvent(tx, organizationId, 'PLAN_CHANGED', null, { from: before.plan, to: 'FREE' }, now);
      }
    },
    onReopen: async (tx, organizationId, now) => {
      await lockSubscriptions(tx, organizationId);
      const rights = await recomputeRights(tx, organizationId, now);
      await enforceLimits(tx, organizationId, rights, now);
    },
  });
  registered = true;
}
