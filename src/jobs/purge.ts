import { pathToFileURL } from 'node:url';
import { logger } from '../lib/logger.js';
import { purge } from '../modules/privacy/purge.service.js';

/**
 * Runs the daily retention purge (CM-35) and returns the process exit code: 0 on success, 1 on
 * any error, including a missing `MIGRATION_DATABASE_URL`, in which case nothing is deleted.
 * Scheduling is outside this job (Q-010).
 */
export async function runPurgeJob(now: Date = new Date()): Promise<number> {
  try {
    await purge(now);
    return 0;
  } catch (error) {
    logger.error({ event: 'purge_failed', err: error }, 'purge job failed');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runPurgeJob().then((code) => process.exit(code));
}
