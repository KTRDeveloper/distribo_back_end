import { Router } from 'express';
import { adminAuthMiddleware, requireAdminRole } from '../../middleware/admin-auth.js';
import {
  giftDaysBodySchema, giftDaysParamsSchema, recordPaymentBodySchema,
  refundPaymentBodySchema, refundPaymentParamsSchema,
} from './billing.schemas.js';
import { refundPayment } from './refund-payment.service.js';
import { recordPayment } from './record-payment.service.js';
import { giveDays } from './gift.service.js';

/** Administration-only billing routes; role checks precede boundary validation. */
export const billingAdminRoutes = Router({ mergeParams: true });

billingAdminRoutes.post(
  '/payments/:paymentId/refund',
  adminAuthMiddleware,
  requireAdminRole('SUPER_ADMIN'),
  async (req, res) => {
    const { organizationId, paymentId } = refundPaymentParamsSchema.parse(req.params);
    const input = refundPaymentBodySchema.parse(req.body);
    res.status(200).json(await refundPayment(req.admin!, organizationId, paymentId, input, new Date()));
  },
);

billingAdminRoutes.post(
  '/payments',
  adminAuthMiddleware,
  requireAdminRole('SUPER_ADMIN'),
  async (req, res) => {
    const { organizationId } = giftDaysParamsSchema.parse(req.params);
    const input = recordPaymentBodySchema.parse(req.body);
    res.status(201).json(await recordPayment(req.admin!, organizationId, input, new Date()));
  },
);

billingAdminRoutes.post(
  '/gift-days',
  adminAuthMiddleware,
  requireAdminRole('SUPER_ADMIN'),
  async (req, res) => {
    const { organizationId } = giftDaysParamsSchema.parse(req.params);
    const input = giftDaysBodySchema.parse(req.body);
    res.status(201).json(await giveDays(req.admin!, organizationId, input, new Date()));
  },
);
