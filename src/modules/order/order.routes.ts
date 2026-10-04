import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import {
  acceptOrderSchema,
  enterOrderSchema,
  orderIdParamSchema,
  placeOrderSchema,
  placePurchaseSchema,
  refuseOrderSchema,
} from './order.schemas.js';
import {
  acceptOrder,
  enterOrder,
  placeOrder,
  placePurchase,
  refuseOrder,
} from './order.service.js';
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

/** Supplier-side order routes, mounted at `/organizations/:organizationId`. */
export const supplierOrderRoutes = Router({ mergeParams: true });

// POST /api/v1/organizations/:organizationId/orders - a seller enters a CONFIRMED order for a
// customer; the supplier is the caller's organization, the prices are the server's
supplierOrderRoutes.post(
  '/orders',
  authMiddleware,
  loadActor,
  requireAbility('create', 'Order'),
  // Strict validation first, so an invalid body never reserves the idempotency key.
  (req, _res, next) => {
    const parsed = enterOrderSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    enterOrder(req.actor!, enterOrderSchema.parse(req.body))
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/orders/:orderId/accept - the supplier confirms a
// PENDING order, optionally lowering prices; the organization is the caller's, never a body field.
// The PENDING condition is the service's conditional update (409 when not PENDING), so the route
// only checks the role.
supplierOrderRoutes.post(
  '/orders/:orderId/accept',
  authMiddleware,
  loadActor,
  requireAbility('accept', 'Order'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = orderIdParamSchema.safeParse({ orderId: req.params.orderId });
    if (!params.success) return next(params.error);
    const parsed = acceptOrderSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    acceptOrder(
      req.actor!,
      orderIdParamSchema.parse({ orderId: req.params.orderId }).orderId,
      acceptOrderSchema.parse(req.body)
    )
      .then((view) => res.status(200).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/orders/:orderId/refuse - the supplier cancels a
// PENDING order with a reason; the organization is the caller's, never a body field. The PENDING
// condition is the service's (409 when not PENDING), so the route only checks the role.
supplierOrderRoutes.post(
  '/orders/:orderId/refuse',
  authMiddleware,
  loadActor,
  requireAbility('refuse', 'Order'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = orderIdParamSchema.safeParse({ orderId: req.params.orderId });
    if (!params.success) return next(params.error);
    const parsed = refuseOrderSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    refuseOrder(
      req.actor!,
      orderIdParamSchema.parse({ orderId: req.params.orderId }).orderId,
      refuseOrderSchema.parse(req.body)
    )
      .then((view) => res.status(200).json(view))
      .catch(next);
  }
);
