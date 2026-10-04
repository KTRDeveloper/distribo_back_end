import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import { placeOrderSchema, placePurchaseSchema } from './order.schemas.js';
import { placeOrder, placePurchase } from './order.service.js';
import './order.openapi.js';

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

/** Purchase routes of one organization, mounted at `/organizations/:organizationId`. */
export const purchaseRoutes = Router({ mergeParams: true });

// POST /api/v1/organizations/:organizationId/purchases - a manager orders for the business; the
// customer is the organization of the path (a non-member gets 404), never a body field
purchaseRoutes.post(
  '/purchases',
  authMiddleware,
  loadActor,
  requireAbility('order_from_supplier', 'CustomerRelationship'),
  // Strict validation first, so an invalid body never reserves the idempotency key.
  (req, _res, next) => {
    const parsed = placePurchaseSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    placePurchase(req.actor!, placePurchaseSchema.parse(req.body))
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);
