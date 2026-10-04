import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import {
  assignDeliverySchema,
  assignParamSchema,
  deliveryParamSchema,
  departSchema,
  failDeliverySchema,
  mineQuerySchema,
  toDeliverQuerySchema,
} from './delivery.schemas.js';
import {
  assignDelivery,
  departWithOrder,
  failDelivery,
  listMyDeliveries,
  listToDeliver,
} from './delivery.service.js';
import './delivery.openapi.js';

/** Delivery routes of one organization, mounted at `/organizations/:organizationId`. */
export const deliveryRoutes = Router({ mergeParams: true });

// GET /api/v1/organizations/:organizationId/deliveries/to-deliver - every member (DRIVER and above)
// reads the pool of CONFIRMED orders with an address; a non-member gets 404 from loadActor
deliveryRoutes.get('/deliveries/to-deliver', authMiddleware, loadActor, (req, res, next) => {
  Promise.resolve()
    .then(() => listToDeliver(req.actor!, toDeliverQuerySchema.parse(req.query)))
    .then((page) => res.json(page))
    .catch(next);
});

// GET /api/v1/organizations/:organizationId/deliveries/mine - the caller's own deliveries; the
// driver is the caller, never a query field
deliveryRoutes.get('/deliveries/mine', authMiddleware, loadActor, (req, res, next) => {
  Promise.resolve()
    .then(() => listMyDeliveries(req.actor!, mineQuerySchema.parse(req.query)))
    .then((page) => res.json(page))
    .catch(next);
});

// POST /api/v1/organizations/:organizationId/orders/:orderId/assign - a MANAGER (or OWNER) gives a
// CONFIRMED order with an address to a driver; the organization is the caller's, never a body
// field. Order status, address, driver and departure checks are the service's.
deliveryRoutes.post(
  '/orders/:orderId/assign',
  authMiddleware,
  loadActor,
  requireAbility('assign', 'Delivery'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = assignParamSchema.safeParse({ orderId: req.params.orderId });
    if (!params.success) return next(params.error);
    const parsed = assignDeliverySchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    assignDelivery(
      req.actor!,
      assignParamSchema.parse({ orderId: req.params.orderId }).orderId,
      assignDeliverySchema.parse(req.body)
    )
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/orders/:orderId/depart - a DRIVER (or above) leaves
// with a CONFIRMED order; the caller is the driver, never a body field. Order status, address,
// assignment and race checks are the service's.
deliveryRoutes.post(
  '/orders/:orderId/depart',
  authMiddleware,
  loadActor,
  requireAbility('depart', 'Order'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = assignParamSchema.safeParse({ orderId: req.params.orderId });
    if (!params.success) return next(params.error);
    const parsed = departSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    departWithOrder(
      req.actor!,
      assignParamSchema.parse({ orderId: req.params.orderId }).orderId,
      departSchema.parse(req.body)
    )
      .then((result) => res.status(200).json(result))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/deliveries/:deliveryId/fail - the assigned DRIVER (or a
// MANAGER or OWNER) reports a delivery in progress as failed with a reason; the order returns to
// CONFIRMED. The delivery is selected through the caller's organization, and by assignee for a
// DRIVER: another's is 404. Delivery state and order checks are the service's.
deliveryRoutes.post(
  '/deliveries/:deliveryId/fail',
  authMiddleware,
  loadActor,
  requireAbility('fail_delivery', 'Order'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = deliveryParamSchema.safeParse({ deliveryId: req.params.deliveryId });
    if (!params.success) return next(params.error);
    const parsed = failDeliverySchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    failDelivery(
      req.actor!,
      deliveryParamSchema.parse({ deliveryId: req.params.deliveryId }).deliveryId,
      failDeliverySchema.parse(req.body)
    )
      .then((result) => res.status(200).json(result))
      .catch(next);
  }
);
