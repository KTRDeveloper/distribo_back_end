import { Worker, Job } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { smsSender } from '../lib/sms.js';
import { emailSender } from '../lib/email.js';
import { queueJobsTotal } from '../lib/metrics.js';
import type { OtpDeliveryJobData } from '../lib/otp-delivery-queue.js';

/**
 * BullMQ worker process for OTP/verification-message delivery.
 * Never logs the message body (it carries the plaintext OTP code).
 */

const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379'),
};

async function processDelivery(job: Job<OtpDeliveryJobData>) {
  const { channel, to, message, subject } = job.data;

  logger.info({ jobId: job.id, channel }, 'Delivering OTP message');

  if (channel === 'SMS') {
    await smsSender.send(to, message);
  } else {
    await emailSender.send(to, subject ?? 'Your verification code', message);
  }
}

const worker = new Worker<OtpDeliveryJobData>(config.otp.deliveryQueueName, processDelivery, {
  connection,
  concurrency: config.worker.concurrency,
  autorun: true,
});

worker.on('active', () => {
  queueJobsTotal.inc({ queue: config.otp.deliveryQueueName, status: 'active' });
});

worker.on('completed', (job) => {
  queueJobsTotal.inc({ queue: config.otp.deliveryQueueName, status: 'completed' });
  logger.info({ jobId: job.id }, 'OTP delivery job completed');
});

worker.on('failed', (job, error) => {
  queueJobsTotal.inc({ queue: config.otp.deliveryQueueName, status: 'failed' });
  logger.error({ jobId: job?.id, error }, 'OTP delivery job failed');
});

worker.on('error', (error) => {
  logger.error({ error }, 'OTP delivery worker error');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down OTP delivery worker');
  await worker.close();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

logger.info({ concurrency: config.worker.concurrency }, 'OTP delivery worker started');
