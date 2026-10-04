import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { reconcileMismatchTotal } from '../lib/metrics.js';
import { reconcile, type Mismatch } from '../modules/finance/reconcile.service.js';

function report(event: 'balance_mismatch' | 'amount_held_mismatch', mismatches: Mismatch[]): void {
  for (const m of mismatches) {
    const difference = (BigInt(m.actual) - BigInt(m.expected)).toString();
    logger.error(
      { event, id: m.id, expected: m.expected, actual: m.actual, difference },
      'cached total differs from the sum of its entries'
    );
    reconcileMismatchTotal.inc({ event });
  }
}

/**
 * Runs the nightly check (C-37, CM-17): logs each mismatch at `error` with a fixed event name and
 * ids only (ASVS v5.0.0-16.3.3), counts it in `reconcile_mismatch_total`, and returns the exit
 * code: 1 when any mismatch exists, else 0. A failure to read propagates and ends the process
 * non-zero, so a broken check is never mistaken for a clean one.
 */
export async function runReconcileJob(): Promise<number> {
  const { balanceMismatches, heldMismatches } = await reconcile();
  report('balance_mismatch', balanceMismatches);
  report('amount_held_mismatch', heldMismatches);
  return balanceMismatches.length + heldMismatches.length > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runReconcileJob();
  } catch (error) {
    logger.error({ event: 'reconcile_failed', err: error }, 'reconcile job failed');
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then(() => process.exit());
}
