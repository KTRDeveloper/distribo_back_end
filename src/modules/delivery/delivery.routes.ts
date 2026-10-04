import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { loadActor } from '../../middleware/load-actor.js';
import { mineQuerySchema, toDeliverQuerySchema } from './delivery.schemas.js';
import { listMyDeliveries, listToDeliver } from './delivery.service.js';
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
