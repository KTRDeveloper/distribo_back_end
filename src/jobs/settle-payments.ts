import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { settlePendingPayments } from '../modules/billing/settle.service.js';

/**
 * Logs a completed sweep without payment details; failures propagate rather than appear clean.
 * @param now Effective instant for the sweep.
 * @returns Exit code 1 when anomalies require attention, otherwise 0.
 */
export async function runSettlePaymentsJob(now: Date): Promise<number> {
  const report = await settlePendingPayments(now);
  logger.info({ event: 'payment_settle_report', ...report }, 'Payment settlement completed');
  return report.anomalies > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runSettlePaymentsJob(new Date());
  } catch {
    logger.error({ event: 'payment_settle_job_failed' }, 'Payment settlement job failed');
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then(() => process.exit());
}
