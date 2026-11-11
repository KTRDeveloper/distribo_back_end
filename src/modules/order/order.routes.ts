import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import {
  acceptOrderSchema,
  cancelOrderAsCustomerSchema,
  cancelOrderSchema,
  editOrderSchema,
  enterOrderSchema,
  listCustomerOrdersQuerySchema,
  listOrdersQuerySchema,
  orderIdParamSchema,
  placeOrderSchema,
  placePurchaseSchema,
  refuseOrderSchema,
  replaceOrderSchema,
  setSupplierNoteSchema,
} from './order.schemas.js';
import {
  acceptOrder,
  cancelOrderAsCustomer,
  cancelOrderAsSupplier,
  editOrder,
  enterOrder,
  getOrder,
  getOrderAsCustomer,
  listOrders,
  listOrdersAsCustomer,
  placeOrder,
  placePurchase,
  refuseOrder,
  replaceOrder,
  setSupplierNote,
} from './order.service.js';
import './order.openapi.js';

/** Order routes; all require authentication. */
export const orderRoutes = Router();

orderRoutes.use(authMiddleware);

// GET /api/v1/orders - a person lists their own orders; the customer is always the caller and the
// query starts from the visibility predicate narrowed to the caller as customer
orderRoutes.get('/', (req, res, next) => {
  Promise.resolve()
    .then(() =>
      listOrdersAsCustomer(
        { personId: req.user!.id },
        listCustomerOrdersQuerySchema.parse(req.query)
      )
    )
    .then((page) => res.json(page))
    .catch(next);
});

// GET /api/v1/orders/:orderId - a person opens one of their own orders (404 for anyone else's)
orderRoutes.get('/:orderId', (req, res, next) => {
  const params = orderIdParamSchema.safeParse({ orderId: req.params.orderId });
  if (!params.success) return next(params.error);
  getOrderAsCustomer({ personId: req.user!.id }, params.data.orderId)
    .then((view) => res.json(view))
    .catch(next);
});

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

// POST /api/v1/orders/:orderId/cancel - the customer cancels a PENDING or CONFIRMED order of their
// own relationship; the customer is always the caller. The status condition is the service's
// conditional update (409 once the order has left).
orderRoutes.post(
  '/:orderId/cancel',
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = orderIdParamSchema.safeParse({ orderId: req.params.orderId });
    if (!params.success) return next(params.error);
    const parsed = cancelOrderAsCustomerSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    cancelOrderAsCustomer(
      { personId: req.user!.id },
      orderIdParamSchema.parse({ orderId: req.params.orderId }).orderId,
      cancelOrderAsCustomerSchema.parse(req.body)
    )
      .then((view) => res.status(200).json(view))
      .catch(next);
  }
);

// POST /api/v1/orders/:orderId/replace - the customer changes a PENDING order of their own
// relationship; the new order is the body `id`, the supplier is never a body field. An order of
// another customer, or one already replaced, is a 404; one that is not PENDING is a 409.
orderRoutes.post(
  '/:orderId/replace',
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = orderIdParamSchema.safeParse({ orderId: req.params.orderId });
    if (!params.success) return next(params.error);
    const parsed = replaceOrderSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    replaceOrder(
      { personId: req.user!.id },
      orderIdParamSchema.parse({ orderId: req.params.orderId }).orderId,
      replaceOrderSchema.parse(req.body)
    )
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

/** Purchase routes of one organization, mounted at `/organizations/:organizationId`. */
export const purchaseRoutes = Router({ mergeParams: true });

// GET /api/v1/organizations/:organizationId/purchases - OWNER and MANAGER list the orders the
// business placed as customer; the service answers 403 below MANAGER and a non-member gets 404
purchaseRoutes.get('/purchases', authMiddleware, loadActor, (req, res, next) => {
  Promise.resolve()
    .then(() => listOrdersAsCustomer(req.actor!, listCustomerOrdersQuerySchema.parse(req.query)))
    .then((page) => res.json(page))
    .catch(next);
});

// GET /api/v1/organizations/:organizationId/purchases/:orderId - OWNER and MANAGER open one
// purchase; an order of another customer is a 404
purchaseRoutes.get('/purchases/:orderId', authMiddleware, loadActor, (req, res, next) => {
  const params = orderIdParamSchema.safeParse({ orderId: req.params.orderId });
  if (!params.success) return next(params.error);
  getOrderAsCustomer(req.actor!, params.data.orderId)
    .then((view) => res.json(view))
    .catch(next);
});

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

// POST /api/v1/organizations/:organizationId/purchases/:orderId/cancel - a manager cancels an
// order of the business before it leaves; the organization is the path's (a non-member gets 404),
// the order is selected through the organization's own relationship.
purchaseRoutes.post(
  '/purchases/:orderId/cancel',
  authMiddleware,
  loadActor,
  requireAbility('order_from_supplier', 'CustomerRelationship'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = orderIdParamSchema.safeParse({ orderId: req.params.orderId });
    if (!params.success) return next(params.error);
    const parsed = cancelOrderAsCustomerSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    const actor = req.actor!;
    cancelOrderAsCustomer(
      { personId: actor.personId, organizationId: actor.organizationId, role: actor.role },
      orderIdParamSchema.parse({ orderId: req.params.orderId }).orderId,
      cancelOrderAsCustomerSchema.parse(req.body)
    )
      .then((view) => res.status(200).json(view))
      .catch(next);
  }
);

/** Supplier-side order routes, mounted at `/organizations/:organizationId`. */
export const supplierOrderRoutes = Router({ mergeParams: true });

// GET /api/v1/organizations/:organizationId/orders - SELLER and above list the orders of the
// organization's customers; the service answers 403 for a DRIVER and the query starts from the
// visibility predicate for the actor's organization
supplierOrderRoutes.get('/orders', authMiddleware, loadActor, (req, res, next) => {
  Promise.resolve()
    .then(() => listOrders(req.actor!, listOrdersQuerySchema.parse(req.query)))
    .then((page) => res.json(page))
    .catch(next);
});

// GET /api/v1/organizations/:organizationId/orders/:orderId - SELLER and above open one order of
// the organization's customers; the service answers 403 for a DRIVER and 404 for an order outside
// the organization (selected by id and the visibility predicate)
supplierOrderRoutes.get('/orders/:orderId', authMiddleware, loadActor, (req, res, next) => {
  const params = orderIdParamSchema.safeParse({ orderId: req.params.orderId });
  if (!params.success) return next(params.error);
  getOrder(req.actor!, params.data.orderId)
    .then((view) => res.json(view))
    .catch(next);
});

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

// POST /api/v1/organizations/:organizationId/orders/:orderId/cancel - the supplier cancels a
// PENDING or CONFIRMED order with a reason; the organization is the caller's, never a body field.
// The status condition is the service's conditional update (409 once the order has left).
supplierOrderRoutes.post(
  '/orders/:orderId/cancel',
  authMiddleware,
  loadActor,
  requireAbility('cancel', 'Order'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = orderIdParamSchema.safeParse({ orderId: req.params.orderId });
    if (!params.success) return next(params.error);
    const parsed = cancelOrderSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    cancelOrderAsSupplier(
      req.actor!,
      orderIdParamSchema.parse({ orderId: req.params.orderId }).orderId,
      cancelOrderSchema.parse(req.body)
    )
      .then((view) => res.status(200).json(view))
      .catch(next);
  }
);

// PATCH /api/v1/organizations/:organizationId/orders/:orderId - the seller corrects a CONFIRMED
// order the business entered. Editing is part of entering orders, so the `create Order` rule
// applies; origin and status are the service's checks (409 ORDER_FROZEN).
supplierOrderRoutes.patch(
  '/orders/:orderId',
  authMiddleware,
  loadActor,
  requireAbility('create', 'Order'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = orderIdParamSchema.safeParse({ orderId: req.params.orderId });
    if (!params.success) return next(params.error);
    const parsed = editOrderSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    editOrder(
      req.actor!,
      orderIdParamSchema.parse({ orderId: req.params.orderId }).orderId,
      editOrderSchema.parse(req.body)
    )
      .then((view) => res.status(200).json(view))
      .catch(next);
  }
);

// PATCH /api/v1/organizations/:organizationId/orders/:orderId/note - the seller writes or clears
// the note the customer sees, in any order status. No gesture id: setting the same note twice is
// the same state, so a repeat is naturally harmless.
supplierOrderRoutes.patch(
  '/orders/:orderId/note',
  authMiddleware,
  loadActor,
  requireAbility('update', 'Order'),
  (req, res, next) => {
    const params = orderIdParamSchema.safeParse({ orderId: req.params.orderId });
    if (!params.success) return next(params.error);
    const parsed = setSupplierNoteSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    setSupplierNote(req.actor!, params.data.orderId, parsed.data.supplier_note)
      .then((view) => res.status(200).json(view))
      .catch(next);
  }
);
