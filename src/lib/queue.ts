import { Queue, QueueOptions } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from './logger.js';

/**
 * BullMQ queue configuration
 * Provides base configuration for creating queues
 */

const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379'),
};

const defaultJobOptions = {
  attempts: config.worker.maxRetries,
  backoff: {
    type: 'exponential' as const,
    delay: 1000,
  },
  removeOnComplete: {
    age: 3600, // Keep completed jobs for 1 hour
    count: 1000, // Keep max 1000 completed jobs
  },
  removeOnFail: {
    age: 24 * 3600, // Keep failed jobs for 24 hours
  },
};

/**
 * Create a new queue
 */
export function createQueue<T = unknown>(name: string, options?: Partial<QueueOptions>): Queue<T> {
  const queue = new Queue<T>(name, {
    connection,
    defaultJobOptions,
    ...options,
  });

  queue.on('error', (error) => {
    logger.error({ error, queue: name }, 'Queue error');
  });

  return queue;
}

/**
 * Task queue for background jobs
 */
export const taskQueue = createQueue('tasks');

logger.info('Queues initialized');
