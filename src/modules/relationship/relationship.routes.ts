import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import {
  addCounterSchema,
  addCustomerSchema,
  creditLimitChangesQuerySchema,
  customerParamsSchema,
  editCustomerSchema,
  editSupplierSchema,
  endReopenSchema,
  listCustomersQuerySchema,
  listSuppliersQuerySchema,
  setCreditLimitSchema,
} from './relationship.schemas.js';
import {
  addCounter,
  addCustomer,
  customerEditSupplier,
  customerEndRelationship,
  customerReopenRelationship,
  editCustomer,
  endRelationship,
  getCustomer,
  listCreditLimitChanges,
  listCustomers,
  listSuppliersOfOrganization,
  listSuppliersOfPerson,
  orgEditSupplier,
  reopenRelationship,
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

// GET /api/v1/organizations/:organizationId/customers/:relationshipId/credit-limit-changes - an
// owner or a manager reads the credit limit history; the service answers 403 below MANAGER and 404
// outside the organization
relationshipRoutes.get(
  '/customers/:relationshipId/credit-limit-changes',
  authMiddleware,
  loadActor,
  (req, res, next) => {
    Promise.resolve()
      .then(() =>
        listCreditLimitChanges(
          req.actor!,
          customerParamsSchema.parse(req.params).relationshipId,
          creditLimitChangesQuerySchema.parse(req.query)
        )
      )
      .then((page) => res.json(page))
      .catch(next);
  }
);

// GET /api/v1/organizations/:organizationId/suppliers - an owner or a manager lists the suppliers
// of the organization (customer view); the service answers 403 below MANAGER
relationshipRoutes.get('/suppliers', authMiddleware, loadActor, (req, res, next) => {
  Promise.resolve()
    .then(() => listSuppliersOfOrganization(req.actor!, listSuppliersQuerySchema.parse(req.query)))
    .then((page) => res.json(page))
    .catch(next);
});

// PATCH /api/v1/organizations/:organizationId/suppliers/:relationshipId - an owner or a manager
// names a supplier; the service answers 403 below MANAGER and 404 outside the organization
relationshipRoutes.patch(
  '/suppliers/:relationshipId',
  authMiddleware,
  loadActor,
  (req, res, next) => {
    Promise.resolve()
      .then(() =>
        orgEditSupplier(
          req.actor!,
          customerParamsSchema.parse(req.params).relationshipId,
          editSupplierSchema.parse(req.body)
        )
      )
      .then((supplier) => res.json(supplier))
      .catch(next);
  }
);

/** Builds the POST handler of an end or reopen gesture: same guards, one service call. */
function endOrReopenRoute(
  path: string,
  gesture: typeof endRelationship | typeof reopenRelationship
) {
  relationshipRoutes.post(
    path,
    authMiddleware,
    loadActor,
    // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
    (req, _res, next) => {
      const parsed = endReopenSchema.safeParse(req.body);
      if (!parsed.success) return next(parsed.error);
      req.body = parsed.data;
      return next();
    },
    idempotent(),
    (req, res, next) => {
      Promise.resolve()
        .then(() => gesture(req.actor!, customerParamsSchema.parse(req.params).relationshipId))
        .then((customer) => res.json(customer))
        .catch(next);
    }
  );
}

// POST /api/v1/organizations/:organizationId/customers/:relationshipId/end - a manager online ends
// the relationship as supplier; the service checks the rules table (403), the organization scope
// (404) and the state (409)
endOrReopenRoute('/customers/:relationshipId/end', endRelationship);

// POST /api/v1/organizations/:organizationId/customers/:relationshipId/reopen - a manager online
// reopens a relationship the supplier ended; 409 when the customer ended it
endOrReopenRoute('/customers/:relationshipId/reopen', reopenRelationship);

/** Relationship routes of the signed-in person as customer, mounted at `/suppliers`. */
export const supplierRoutes = Router();

// GET /api/v1/suppliers - any signed-in person lists the relationships where they are the
// customer; the person comes from the session, never from the request
supplierRoutes.get('/', authMiddleware, (req, res, next) => {
  Promise.resolve()
    .then(() => listSuppliersOfPerson(req.user!.id, listSuppliersQuerySchema.parse(req.query)))
    .then((page) => res.json(page))
    .catch(next);
});

// PATCH /api/v1/suppliers/:relationshipId - the customer names a supplier; the person comes from
// the session and the service answers 404 outside the caller's own relationships
supplierRoutes.patch('/:relationshipId', authMiddleware, (req, res, next) => {
  Promise.resolve()
    .then(() =>
      customerEditSupplier(
        req.user!.id,
        customerParamsSchema.parse(req.params).relationshipId,
        editSupplierSchema.parse(req.body)
      )
    )
    .then((supplier) => res.json(supplier))
    .catch(next);
});

/** Builds the POST handler of a customer-side end or reopen gesture: same guards, one call. */
function customerGestureRoute(
  path: string,
  gesture: typeof customerEndRelationship | typeof customerReopenRelationship
) {
  supplierRoutes.post(
    path,
    authMiddleware,
    // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
    (req, _res, next) => {
      const parsed = endReopenSchema.safeParse(req.body);
      if (!parsed.success) return next(parsed.error);
      req.body = parsed.data;
      return next();
    },
    idempotent(),
    (req, res, next) => {
      Promise.resolve()
        .then(() => gesture(req.user!.id, customerParamsSchema.parse(req.params).relationshipId))
        .then((supplier) => res.json(supplier))
        .catch(next);
    }
  );
}

// POST /api/v1/suppliers/:relationshipId/end - the customer leaves a supplier; 409 unless ACTIVE
customerGestureRoute('/:relationshipId/end', customerEndRelationship);

// POST /api/v1/suppliers/:relationshipId/reopen - the customer comes back; 409 when the supplier
// ended the relationship
customerGestureRoute('/:relationshipId/reopen', customerReopenRelationship);
