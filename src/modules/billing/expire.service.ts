import { logger } from '../../lib/logger.js';
import { listOrganizationsToRefresh } from '../organization/organization.repository.js';
import { advanceSubscription } from './advance.service.js';
import {
  ADVANCE_PAGE,
  listBusinessesToAdvance,
  runInTransaction,
} from './subscription.repository.js';

export type AdvanceReport = {
  checked: number;
  ended: number;
  started: number;
  planChanged: number;
};

async function* candidates(
  list: (now: Date, limit: number, afterId?: string) => Promise<string[]>,
  now: Date
): AsyncGenerator<string, void> {
  let afterId: string | undefined;
  while (true) {
    const page = await list(now, ADVANCE_PAGE, afterId);
    for (const id of page) yield id;
    if (page.length < ADVANCE_PAGE) return;
    afterId = page[page.length - 1];
  }
}

/**
 * Merges both sorted candidate streams with bounded memory and advances each id once.
 * Every business commits independently: failures roll back its lifecycle, rights and
 * notices, but cannot deny other tenants service (ASVS 2.3.3, 16.5.3). Only ids are
 * logged; the first failure is rethrown after all candidates, never swallowed.
 * @param now One reference instant shared by selection and all transactions.
 * @returns Counts from committed advances only; checked includes every attempted id.
 * @throws The first business failure after the loop, or a candidate read failure.
 */
export async function advanceDueBusinesses(now: Date): Promise<AdvanceReport> {
  const report: AdvanceReport = { checked: 0, ended: 0, started: 0, planChanged: 0 };
  const periods = candidates(listBusinessesToAdvance, now);
  const rights = candidates(listOrganizationsToRefresh, now);
  let period = await periods.next();
  let right = await rights.next();
  let failed = false;
  let firstError: unknown;

  while (!period.done || !right.done) {
    const id = period.done
      ? right.value!
      : right.done
        ? period.value
        : period.value < right.value
          ? period.value
          : right.value;
    report.checked++;
    try {
      const result = await runInTransaction((tx) => advanceSubscription(tx, id, now));
      report.ended += result.ended;
      report.started += result.started;
      report.planChanged += Number(result.planChanged);
    } catch (error) {
      logger.error(
        { event: 'expire_forfaits_business_failed', organizationId: id },
        'subscription advance failed'
      );
      if (!failed) firstError = error;
      failed = true;
    }
    if (!period.done && period.value === id) period = await periods.next();
    if (!right.done && right.value === id) right = await rights.next();
  }
  if (failed) throw firstError;
  return report;
}
