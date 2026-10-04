import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import { addCustomerSchema, listCustomersQuerySchema } from './relationship.schemas.js';
import { addCustomer, listCustomers } from './relationship.service.js';
import './relationship.openapi.js';

/** Relationship routes of one organization, mounted at `/organizations/:organizationId`. */
export const relationshipRoutes = Router({ mergeParams: true });

// POST /api/v1/organizations/:organizationId/customers - a seller adds a customer by number;
// 201 when created, 200 when a live relationship already existed
relationshipRoutes.post(
  '/customers',
  authMiddleware,
  loadActor,
  requireAbility('create', 'CustomerRelationship'),
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = addCustomerSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    addCustomer(req.actor!, addCustomerSchema.parse(req.body))
      .then(({ created, relationship }) => res.status(created ? 201 : 200).json(relationship))
      .catch(next);
  }
);

// GET /api/v1/organizations/:organizationId/customers - SELLER and above list the customers and
// counters of the organization; the service answers 403 for a DRIVER
relationshipRoutes.get('/customers', authMiddleware, loadActor, (req, res, next) => {
  Promise.resolve()
    .then(() => listCustomers(req.actor!, listCustomersQuerySchema.parse(req.query)))
    .then((page) => res.json(page))
    .catch(next);
});
