import { pathToFileURL } from 'node:url';
import { logger } from '../lib/logger.js';
import { cleanupOrphanImages } from '../modules/images/image-cleanup.service.js';

/**
 * Runs the nightly photo cleanup (C-50) and returns the process exit code: 0 on success, 1 on
 * any error. Each run logs how many files it scanned and deleted and how many keys it released (ASVS v5.0.0-16.3.1).
 * Scheduling is outside this job (Q-010).
 */
export async function runImageCleanupJob(now: Date = new Date()): Promise<number> {
  try {
    const { scanned, deleted, released } = await cleanupOrphanImages(now);
    logger.info({ event: 'image_cleanup_done', scanned, deleted, released }, 'image cleanup done');
    return 0;
  } catch (error) {
    logger.error({ event: 'image_cleanup_failed', err: error }, 'image cleanup failed');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runImageCleanupJob().then((code) => process.exit(code));
}
