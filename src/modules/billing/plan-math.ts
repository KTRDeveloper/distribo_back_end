/**
 * Pure plan arithmetic (no database): plan rank, UTC calendar months and days, and the
 * conversion of remaining days of lower plans. Every queue, upgrade and receipt computes
 * its dates here so they all agree.
 */

import { PLANS, type PackMonths, type PaidPlanCode, type PlanCode } from '../../shared/plans.js';

/** Days of grace after a subscription ends. */
export const GRACE_DAYS = 7;

/** Remaining time on a lower plan, to be converted into days of a higher plan. */
export type ConvertPart = { plan: PaidPlanCode; remainingMs: number };

const RANKS: Readonly<Record<PlanCode, 0 | 1 | 2 | 3>> = {
  FREE: 0,
  ESSENTIAL: 1,
  PRO: 2,
  ENTERPRISE: 3,
};

const DAY_MS = 86_400_000n;

/** Rank of a plan: FREE 0, ESSENTIAL 1, PRO 2, ENTERPRISE 3. */
export function planRank(plan: PlanCode): 0 | 1 | 2 | 3 {
  return RANKS[plan];
}

/**
 * Adds calendar months in UTC, keeping the time of day. A day missing from the target
 * month becomes its last day (31 January + 1 month = 28 or 29 February).
 */
export function addMonths(from: Date, months: PackMonths): Date {
  const total = from.getUTCFullYear() * 12 + from.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(from.getUTCDate(), lastDay);
  const result = new Date(from.getTime());
  result.setUTCFullYear(year, month, day);
  return result;
}

/** Adds whole days of 24 hours in UTC. */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * Number(DAY_MS));
}

/**
 * Converts remaining time of lower plans into whole days of plan `to`:
 * the sum of `remainingMs × monthlyPrice(plan) / monthlyPrice(to)` in integer arithmetic,
 * rounded up once at the end (not per part).
 *
 * @throws RangeError when a part is not of a strictly lower plan than `to`, or when its
 * duration is negative or not a finite integer (ASVS 2.2.1: refuse instead of guessing).
 */
export function convertRemainingDays(parts: ConvertPart[], to: PaidPlanCode): number {
  const priceTo = PLANS[to].monthlyPrice;
  let weighted = 0n;
  for (const part of parts) {
    if (planRank(part.plan) >= planRank(to)) {
      throw new RangeError('A part must be of a lower plan than the target plan');
    }
    if (!Number.isSafeInteger(part.remainingMs) || part.remainingMs < 0) {
      throw new RangeError('A remaining duration must be a non-negative integer');
    }
    weighted += BigInt(part.remainingMs) * PLANS[part.plan].monthlyPrice;
  }
  const divisor = priceTo * DAY_MS;
  return Number((weighted + divisor - 1n) / divisor);
}
