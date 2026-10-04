import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import type { Actor } from '../../types/express.js';
import { requireAbility } from '../../middleware/require-ability.js';
import {
  acceptInvitationSchema,
  addCounterSchema,
  contestSchema,
  correctNumberSchema,
  addCustomerSchema,
  creditLimitChangesQuerySchema,
  customerParamsSchema,
  editCustomerSchema,
  editSupplierSchema,
  endReopenSchema,
  inviteSupplierSchema,
  invitationParamsSchema,
  listCustomersQuerySchema,
  listInvitationsQuerySchema,
  listSuppliersQuerySchema,
  setCreditLimitSchema,
} from './relationship.schemas.js';
import {
  acceptSupplierInvitation,
  addCounter,
  addCustomer,
  contestRelationship,
  correctCustomerNumber,
  customerEditSupplier,
  customerEndRelationship,
  customerReopenRelationship,
  declineSupplierInvitation,
  editCustomer,
  endRelationship,
  getAttachments,
  getCustomer,
  inviteSupplier,
  listCreditLimitChanges,
  listCustomers,
  listSupplierInvitations,
  listSuppliersOfOrganization,
  listSuppliersOfPerson,
  orgEditSupplier,
  orgEndSupplier,
  orgReopenSupplier,
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

// POST /api/v1/organizations/:organizationId/customers/:relationshipId/correct-number - an owner,
// or a manager online, points the relationship to the right number; the service checks the rules
// table (403), the organization scope (404) and the reassignment rules (409, 403 OWN_RECORD)
relationshipRoutes.post(
  '/customers/:relationshipId/correct-number',
  authMiddleware,
  loadActor,
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = correctNumberSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    Promise.resolve()
      .then(() =>
        correctCustomerNumber(
          req.actor!,
          customerParamsSchema.parse(req.params).relationshipId,
          correctNumberSchema.parse(req.body)
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
  gesture: (actor: Actor, relationshipId: string) => Promise<unknown>
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

// POST /api/v1/organizations/:organizationId/suppliers/invitations - a manager online invites a
// supplier by number for the organization; 201, PENDING. Declared before the `:relationshipId`
// routes so `invitations` is never read as an id.
relationshipRoutes.post(
  '/suppliers/invitations',
  authMiddleware,
  loadActor,
  requireAbility('invite_supplier', 'CustomerRelationship'),
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = inviteSupplierSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    inviteSupplier(req.actor!, inviteSupplierSchema.parse(req.body))
      .then((supplier) => res.status(201).json(supplier))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/suppliers/:relationshipId/end - a manager online
// leaves a supplier for the organization; 403 below MANAGER, 404 outside it, 409 unless ACTIVE
endOrReopenRoute('/suppliers/:relationshipId/end', orgEndSupplier);

// POST /api/v1/organizations/:organizationId/suppliers/:relationshipId/reopen - a manager online
// comes back to a supplier the organization left; 409 when the supplier ended it
endOrReopenRoute('/suppliers/:relationshipId/reopen', orgReopenSupplier);

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

// POST /api/v1/suppliers/invitations - a signed-in person invites a supplier by number; 201,
// PENDING. The person comes from the session. Declared before `/:relationshipId/...`.
supplierRoutes.post(
  '/invitations',
  authMiddleware,
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = inviteSupplierSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    inviteSupplier({ personId: req.user!.id }, inviteSupplierSchema.parse(req.body))
      .then((supplier) => res.status(201).json(supplier))
      .catch(next);
  }
);

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

// POST /api/v1/suppliers/:relationshipId/contest - the customer says "this is not me"; 204. The
// person comes from the session; 404 outside the caller's scope, 409 on a second contestation.
supplierRoutes.post(
  '/:relationshipId/contest',
  authMiddleware,
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = contestSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    Promise.resolve()
      .then(() =>
        contestRelationship(
          req.user!.id,
          customerParamsSchema.parse(req.params).relationshipId,
          contestSchema.parse(req.body)
        )
      )
      // `json({})` on a 204 sends no body (HTTP) but lets the idempotency guard store a non-null
      // response to replay; `end()` would leave a replay looking "in progress".
      .then(() => res.status(204).json({}))
      .catch(next);
  }
);

/** Invitation routes of the signed-in person as invited supplier, mounted at `/supplier-invitations`. */
export const supplierInvitationRoutes = Router();

// GET /api/v1/supplier-invitations - the PENDING invitations addressed to the caller; the person
// comes from the session, never from the request
supplierInvitationRoutes.get('/', authMiddleware, (req, res, next) => {
  Promise.resolve()
    .then(() => listSupplierInvitations(req.user!.id, listInvitationsQuerySchema.parse(req.query)))
    .then((page) => res.json(page))
    .catch(next);
});

// POST /api/v1/supplier-invitations/:invitationId/accept - the caller accepts for an organization
// they manage; 200 with the relationship, or `{ merged: true }` when one already existed
supplierInvitationRoutes.post(
  '/:invitationId/accept',
  authMiddleware,
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = acceptInvitationSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    Promise.resolve()
      .then(() =>
        acceptSupplierInvitation(
          req.user!.id,
          invitationParamsSchema.parse(req.params).invitationId,
          acceptInvitationSchema.parse(req.body).organization_id
        )
      )
      .then((result) => res.json(result))
      .catch(next);
  }
);

// POST /api/v1/supplier-invitations/:invitationId/decline - the caller refuses; the row is
// deleted and the customer notified
supplierInvitationRoutes.post(
  '/:invitationId/decline',
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
      .then(() =>
        declineSupplierInvitation(
          req.user!.id,
          invitationParamsSchema.parse(req.params).invitationId
        )
      )
      .then(() => res.json({ declined: true }))
      .catch(next);
  }
);

/** Route of the signed-in person's attachments, mounted at `/people/me/attachments`. */
export const attachmentsRoutes = Router();

// GET /api/v1/people/me/attachments - what is attached to the caller's number: customer
// relationships, team invitations and supplier invitations; the person comes from the session
attachmentsRoutes.get('/', authMiddleware, (req, res, next) => {
  getAttachments(req.user!.id)
    .then((attachments) => res.json(attachments))
    .catch(next);
});
