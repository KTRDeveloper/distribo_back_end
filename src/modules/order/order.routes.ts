import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { placeOrderSchema } from './order.schemas.js';
import { placeOrder } from './order.service.js';

/** Order routes; all require authentication. */
export const orderRoutes = Router();

orderRoutes.use(authMiddleware);

// POST /api/v1/orders - a customer places an order; the customer is always the caller
orderRoutes.post(
  '/',
  // Strict validation first, so an invalid body never reserves the idempotency key.
  (req, _res, next) => {
    const parsed = placeOrderSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    placeOrder({ personId: req.user!.id }, placeOrderSchema.parse(req.body))
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);
