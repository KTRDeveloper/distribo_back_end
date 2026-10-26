import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { sendDueReminders } from '../modules/billing/reminder.service.js';

/**
 * Runs the daily subscription reminder scan; partial failures propagate (ASVS 16.5.3).
 * @param now Reference instant for Douala calendar-day eligibility.
 * @returns Zero after a fully successful scan, including an empty scan.
 */
export async function runSendRemindersJob(now: Date): Promise<number> {
  const counts = await sendDueReminders(now);
  logger.info({ event: 'subscription_reminders_sent', ...counts }, 'subscription reminder scan completed');
  return 0;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runSendRemindersJob(new Date());
  } catch (error) {
    logger.error({ event: 'subscription_reminders_job_failed', err: error }, 'subscription reminder job failed');
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then(() => process.exit());
}
