import { Router } from 'express';
import { adminAuthMiddleware, requireAdminRole } from '../../middleware/admin-auth.js';
import { giftDaysBodySchema, giftDaysParamsSchema } from './billing.schemas.js';
import { giveDays } from './gift.service.js';

/** Administration-only billing routes; role checks precede boundary validation. */
export const billingAdminRoutes = Router({ mergeParams: true });

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
