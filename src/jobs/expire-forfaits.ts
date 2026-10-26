import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { advanceDueBusinesses } from '../modules/billing/expire.service.js';

/**
 * Runs the externally scheduled subscription clock without exposing tenant data.
 * @param now Reference instant; defaults to the current server time.
 * @returns Zero after all advances commit; failures propagate to the script runner.
 */
export async function runExpireForfaitsJob(now: Date = new Date()): Promise<number> {
  const report = await advanceDueBusinesses(now);
  logger.info({ event: 'expire_forfaits_completed', ...report }, 'subscription advance completed');
  return 0;
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runExpireForfaitsJob();
  } catch {
    logger.error({ event: 'expire_forfaits_failed' }, 'subscription advance job failed');
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then(() => process.exit());
}
