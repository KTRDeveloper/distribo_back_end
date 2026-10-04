import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import {
  addCounterSchema,
  addCustomerSchema,
  customerParamsSchema,
  editCustomerSchema,
  listCustomersQuerySchema,
  setCreditLimitSchema,
} from './relationship.schemas.js';
import {
  addCounter,
  addCustomer,
  editCustomer,
  getCustomer,
  listCustomers,
  setCreditLimit,
} from './relationship.service.js';
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

// GET /api/v1/organizations/:organizationId/customers/:relationshipId - SELLER and above open one
// customer (supplier view); the service answers 403 for a DRIVER and 404 outside the organization
relationshipRoutes.get(
  '/customers/:relationshipId',
  authMiddleware,
  loadActor,
  (req, res, next) => {
    Promise.resolve()
      .then(() => getCustomer(req.actor!, customerParamsSchema.parse(req.params).relationshipId))
      .then((customer) => res.json(customer))
      .catch(next);
  }
);

// PATCH /api/v1/organizations/:organizationId/customers/:relationshipId - SELLER and above edit the
// label, address and notes; the service checks each field against the rules table (403) and the
// organization scope (404)
relationshipRoutes.patch(
  '/customers/:relationshipId',
  authMiddleware,
  loadActor,
  (req, res, next) => {
    Promise.resolve()
      .then(() =>
        editCustomer(
          req.actor!,
          customerParamsSchema.parse(req.params).relationshipId,
          editCustomerSchema.parse(req.body)
        )
      )
      .then((customer) => res.json(customer))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/counters - a manager adds a named counter; 201.
// The service checks the rules table with the subject `{ counter: true }` (ACC-002) and the rank.
relationshipRoutes.post(
  '/counters',
  authMiddleware,
  loadActor,
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = addCounterSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    addCounter(req.actor!, addCounterSchema.parse(req.body))
      .then((counter) => res.status(201).json(counter))
      .catch(next);
  }
);

// PUT /api/v1/organizations/:organizationId/customers/:relationshipId/credit-limit - an owner, or a
// manager online, sets the limit; the service checks the rules table (403), the organization scope
// (404) and the credit rules (409, 403 OWN_RECORD)
relationshipRoutes.put(
  '/customers/:relationshipId/credit-limit',
  authMiddleware,
  loadActor,
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = setCreditLimitSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    Promise.resolve()
      .then(() =>
        setCreditLimit(
          req.actor!,
          customerParamsSchema.parse(req.params).relationshipId,
          setCreditLimitSchema.parse(req.body)
        )
      )
      .then((customer) => res.json(customer))
      .catch(next);
  }
);
