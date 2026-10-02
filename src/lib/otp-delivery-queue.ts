import { createQueue } from './queue.js';
import { config } from '../config/index.js';

/**
 * Async OTP/verification-message delivery. Keeps the OTP request endpoints'
 * response time decoupled from third-party SMS/email carrier latency, and
 * gets retry-on-failure for free from the existing BullMQ setup.
 */

export type OtpDeliveryChannel = 'SMS' | 'EMAIL';

export interface OtpDeliveryJobData {
  channel: OtpDeliveryChannel;
  to: string;
  message: string;
  subject?: string;
}

export const otpDeliveryQueue = createQueue<OtpDeliveryJobData>(config.otp.deliveryQueueName);

export async function enqueueOtpDelivery(data: OtpDeliveryJobData): Promise<void> {
  await otpDeliveryQueue.add('deliver-otp', data);
}
