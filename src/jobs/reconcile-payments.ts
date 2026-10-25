import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { reconcilePayments } from '../modules/billing/reconcile.service.js';

/**
 * Reports every discrepancy with ids only (ASVS 16.3.3), without changing payments.
 * @param day UTC day to check; defaults to yesterday UTC.
 * @param now Job clock, injectable for deterministic day selection.
 * @returns 1 when any mismatch exists, otherwise 0.
 * @throws Any read failure; the CLI maps it to non-zero rather than a clean report.
 */
export async function runReconcilePaymentsJob(day?: string, now = new Date()): Promise<number> {
  const selectedDay = day ?? new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const mismatches = await reconcilePayments(selectedDay, now);
  for (const mismatch of mismatches) {
    logger.error({ event: mismatch.event, id: mismatch.id }, 'payment reconciliation mismatch');
  }
  return mismatches.length > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runReconcilePaymentsJob(process.argv[2]);
  } catch {
    // Provider errors can contain payment data: report a fixed event, never their payload.
    logger.error({ event: 'payment_reconcile_failed' }, 'payment reconciliation failed');
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then(() => process.exit());
}
