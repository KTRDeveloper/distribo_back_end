import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import {
  assignDeliverySchema,
  assignParamSchema,
  counterParamSchema,
  counterSaleSchema,
  deliverSchema,
  deliveryParamSchema,
  departSchema,
  failDeliverySchema,
  mineQuerySchema,
  toDeliverQuerySchema,
} from './delivery.schemas.js';
import {
  assignDelivery,
  deliverOrder,
  departWithOrder,
  failDelivery,
  listMyDeliveries,
  listToDeliver,
  sellAtCounter,
  unsettledDeliveries,
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

// POST /api/v1/organizations/:organizationId/orders/:orderId/deliver - "Commande livrée": a DRIVER
// (or above) closes an order, recording the sale and the payment collected. The caller is the
// recorder and the sale amount is the order total computed by the server, never body fields.
// Order status, ownership of the delivery, credit and race checks are the service's.
deliveryRoutes.post(
  '/orders/:orderId/deliver',
  authMiddleware,
  loadActor,
  requireAbility('deliver', 'Order'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = assignParamSchema.safeParse({ orderId: req.params.orderId });
    if (!params.success) return next(params.error);
    const parsed = deliverSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    deliverOrder(
      req.actor!,
      assignParamSchema.parse({ orderId: req.params.orderId }).orderId,
      deliverSchema.parse(req.body)
    )
      .then(({ order, sale, payment }) => res.status(200).json({ order, sale, payment }))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/counters/:relationshipId/sales - a SELLER (or above)
// sells at a counter: the order is created, delivered and paid at once. The caller is the seller,
// the price and the sale amount are computed by the server, and the collected amount must equal
// the total, never body-defined amounts. Counter scope, payment and atomicity are the service's.
deliveryRoutes.post(
  '/counters/:relationshipId/sales',
  authMiddleware,
  loadActor,
  requireAbility('create', 'Order'),
  requireAbility('deliver', 'Order'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = counterParamSchema.safeParse({ relationshipId: req.params.relationshipId });
    if (!params.success) return next(params.error);
    const parsed = counterSaleSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    sellAtCounter(
      req.actor!,
      counterParamSchema.parse({ relationshipId: req.params.relationshipId }).relationshipId,
      counterSaleSchema.parse(req.body)
    )
      .then((result) => res.status(201).json(result))
      .catch(next);
  }
);

// GET /api/v1/organizations/:organizationId/exceptions/unsettled-deliveries - the OWNER reads the
// deliveries of one day (Africa/Douala) not fully paid, grouped by deliverer. The service answers
// 403 below OWNER before the query is read; the organization is the actor's, from the path
// through `loadActor`.
deliveryRoutes.get(
  '/exceptions/unsettled-deliveries',
  authMiddleware,
  loadActor,
  (req, res, next) => {
    // The raw query goes to the service, which refuses a non-owner first and then validates it strictly.
    unsettledDeliveries(req.actor!, req.query as { date?: string })
      .then((view) => res.json(view))
      .catch(next);
  }
);
