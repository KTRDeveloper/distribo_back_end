import { logger } from '../../lib/logger.js';
import { confirmPayment } from './confirmation.service.js';
import { listStalePending } from './payment.repository.js';

export const SETTLE_BATCH = 200;
export const SETTLE_AFTER_MINUTES = 15;
export const PENDING_TOO_LONG_HOURS = 24;

export type SettleReport = {
  checked: number;
  activated: number;
  failed: number;
  expired: number;
  pending: number;
  anomalies: number;
};

function isAnomaly(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('statusCode' in error) || !('code' in error)) {
    return false;
  }
  return (error.statusCode === 404 && error.code === 'NOT_FOUND')
    || (error.statusCode === 409 && error.code === 'PAYMENT_MISMATCH');
}

/**
 * Recovers missed callbacks using only aggregator-verified outcomes (C-53).
 * Each confirmation owns its transaction; no provider failure prevents later checks.
 * Age can trigger a warning, but never expire or activate a payment by itself.
 * @param now Effective instant shared by selection, confirmations and age warnings.
 * @returns Counts for the bounded sweep; concurrently settled rows count only as checked.
 * @throws The first unexpected failure, after checking every selected payment (ASVS 16.5.3).
 */
export async function settlePendingPayments(now: Date): Promise<SettleReport> {
  const payments = await listStalePending(
    new Date(now.getTime() - SETTLE_AFTER_MINUTES * 60_000), SETTLE_BATCH,
  );
  const report: SettleReport = {
    checked: payments.length, activated: 0, failed: 0, expired: 0, pending: 0, anomalies: 0,
  };
  let firstError: unknown;
  let hasError = false;
  for (const payment of payments) {
    let anomaly = false;
    try {
      const outcome = await confirmPayment(payment.providerReference, null, now);
      switch (outcome) {
        case 'ACTIVATED': report.activated++; break;
        case 'FAILED': report.failed++; break;
        case 'EXPIRED': report.expired++; break;
        case 'STILL_PENDING':
          report.pending++;
          anomaly = now.getTime() - payment.createdAt.getTime() > PENDING_TOO_LONG_HOURS * 3_600_000;
          break;
        case 'ALREADY_DONE': break;
      }
    } catch (error) {
      if (isAnomaly(error)) {
        anomaly = true;
      } else {
        // Exceptions may contain provider secrets or payer data; log only the payment id.
        logger.error({ event: 'payment_settle_failed', paymentId: payment.id }, 'Payment settlement failed');
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    }
    if (anomaly) {
      report.anomalies++;
      logger.warn({ event: 'payment_settle_anomaly', paymentId: payment.id }, 'Payment settlement anomaly');
    }
  }
  if (hasError) throw firstError;
  return report;
}
