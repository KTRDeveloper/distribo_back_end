import { logger } from '../../lib/logger.js';
import { readPlanFields, listOrganizationsEnding, findActiveOwnerId } from '../organization/organization.repository.js';
import { notify, recipientLanguage } from '../notification/notification.service.js';
import { readAfterEnd } from './owner-view.service.js';
import { reminderNotice } from './notices.js';
import { hasReminder, insertSystemEvent, lockSubscriptions, runInTransaction } from './subscription.repository.js';

const DAY = 86_400_000;
const OFFSET = 3_600_000;

function doualaDay(date: Date): number {
  return Math.floor((date.getTime() + OFFSET) / DAY);
}

/**
 * Sends due reminders in independent, locked business transactions (ASVS 2.3.3).
 * A failed business rolls back its journal and notice; other businesses still run before
 * the first failure is rethrown so an operator cannot mistake a partial run for success.
 * @param now Reference instant; eligibility uses Douala calendar days, not elapsed hours.
 * @returns Numbers of scanned businesses and committed reminders.
 */
export async function sendDueReminders(now: Date): Promise<{ checked: number; sent: number }> {
  const today = doualaDay(now);
  const from = new Date(today * DAY - OFFSET);
  const to = new Date((today + 8) * DAY - OFFSET);
  let checked = 0;
  let sent = 0;
  let afterId: string | undefined;
  let firstFailure: { error: unknown } | undefined;
  for (;;) {
    const ids = await listOrganizationsEnding(from, to, 500, afterId);
    for (const organizationId of ids) {
      checked++;
      try {
        const delivered = await runInTransaction(async (tx) => {
          await lockSubscriptions(tx, organizationId);
          const fields = await readPlanFields(tx, organizationId);
          if (!fields || fields.plan === 'FREE' || !fields.planEndsAt) return false;
          const daysBefore = doualaDay(fields.planEndsAt) - today;
          if (daysBefore !== 7 && daysBefore !== 1 && daysBefore !== 0) return false;
          if (await hasReminder(tx, organizationId, fields.planEndsAt, daysBefore)) return false;
          const recipientId = await findActiveOwnerId(tx, organizationId);
          if (!recipientId) return false;
          const language = await recipientLanguage(recipientId, tx);
          const afterEnd = daysBefore === 7 ? await readAfterEnd(organizationId, now) : null;
          const content = reminderNotice(language, {
            daysBefore, plan: fields.plan, planEndsAt: fields.planEndsAt, afterEnd,
          });
          await insertSystemEvent(tx, organizationId, 'REMINDER', null, {
            plan_ends_at: fields.planEndsAt.toISOString(), days_before: daysBefore,
          }, now);
          await notify({ recipientId, organizationId, sourceEvent: 'subscription.reminder', content }, tx);
          return true;
        });
        if (delivered) sent++;
      } catch (error) {
        logger.error({ event: 'subscription_reminder_failed', organizationId }, 'subscription reminder failed');
        firstFailure ??= { error };
      }
    }
    if (ids.length < 500) break;
    afterId = ids[ids.length - 1];
  }
  if (firstFailure) throw firstFailure.error;
  return { checked, sent };
}
