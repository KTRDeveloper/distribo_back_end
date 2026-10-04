import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import { logger } from '../../lib/logger.js';
import { httpError } from '../../lib/http-error.js';
import { atLeast } from '../../shared/access/roles.js';
import {
  creditNoteSchema,
  ledgerQuerySchema,
  openingBalanceSchema,
  paymentParamSchema,
  recordExpenseSchema,
  recordPaymentSchema,
  returnSchema,
  reverseEntrySchema,
  reverseParamSchema,
} from './finance.schemas.js';
import {
  listLedger,
  recordCreditNote,
  recordExpense,
  recordOpeningBalance,
  recordPayment,
  recordRefund,
  recordReturn,
  reverseEntry,
} from './finance.service.js';
import './finance.openapi.js';

/** Finance routes of one organization, mounted at `/organizations/:organizationId`. */
export const financeRoutes = Router({ mergeParams: true });

// POST /api/v1/organizations/:organizationId/customers/:relationshipId/payments - a SELLER or above
// records a customer's payment; the organization and the recorder are the caller's, never body
// fields. The ledger rule `create LedgerEntry kind PAYMENT` is also granted to DRIVER for payments
// taken during a delivery (DLV), so this route adds the SELLER floor itself.
financeRoutes.post(
  '/customers/:relationshipId/payments',
  authMiddleware,
  loadActor,
  requireAbility('create', 'LedgerEntry', () => ({ kind: 'PAYMENT' })),
  (req, _res, next) => {
    const actor = req.actor;
    if (actor && atLeast(actor.role, 'SELLER')) return next();
    logger.warn(
      { event: 'permission_refused', personId: actor?.personId, route: 'record_payment' },
      'Permission refused'
    );
    return next(httpError(403, 'FORBIDDEN', 'Permission denied'));
  },
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = paymentParamSchema.safeParse({ relationshipId: req.params.relationshipId });
    if (!params.success) return next(params.error);
    const parsed = recordPaymentSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    recordPayment(
      req.actor!,
      paymentParamSchema.parse({ relationshipId: req.params.relationshipId }).relationshipId,
      recordPaymentSchema.parse(req.body)
    )
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/customers/:relationshipId/refunds - a MANAGER online
// or the OWNER gives money back to a customer. The rules table grants `create LedgerEntry kind
// REFUND` to nobody below MANAGER, so a SELLER or DRIVER is refused there; the organization and
// the recorder are the caller's, never body fields.
financeRoutes.post(
  '/customers/:relationshipId/refunds',
  authMiddleware,
  loadActor,
  requireAbility('create', 'LedgerEntry', () => ({ kind: 'REFUND' })),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = paymentParamSchema.safeParse({ relationshipId: req.params.relationshipId });
    if (!params.success) return next(params.error);
    const parsed = recordPaymentSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    recordRefund(
      req.actor!,
      paymentParamSchema.parse({ relationshipId: req.params.relationshipId }).relationshipId,
      recordPaymentSchema.parse(req.body)
    )
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/customers/:relationshipId/credit-notes - a MANAGER
// online or the OWNER lowers what a customer owes, without money moving. The rules table grants
// `create LedgerEntry kind CREDIT_NOTE` to nobody below MANAGER; the organization and the
// recorder are the caller's, never body fields.
financeRoutes.post(
  '/customers/:relationshipId/credit-notes',
  authMiddleware,
  loadActor,
  requireAbility('create', 'LedgerEntry', () => ({ kind: 'CREDIT_NOTE' })),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = paymentParamSchema.safeParse({ relationshipId: req.params.relationshipId });
    if (!params.success) return next(params.error);
    const parsed = creditNoteSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    recordCreditNote(
      req.actor!,
      paymentParamSchema.parse({ relationshipId: req.params.relationshipId }).relationshipId,
      creditNoteSchema.parse(req.body)
    )
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/customers/:relationshipId/opening-balances - a MANAGER
// online or the OWNER copies a customer's debt from a paper notebook. The rules table grants
// `create LedgerEntry kind OPENING_BALANCE` to nobody below MANAGER; the organization and the
// recorder are the caller's, never body fields.
financeRoutes.post(
  '/customers/:relationshipId/opening-balances',
  authMiddleware,
  loadActor,
  requireAbility('create', 'LedgerEntry', () => ({ kind: 'OPENING_BALANCE' })),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = paymentParamSchema.safeParse({ relationshipId: req.params.relationshipId });
    if (!params.success) return next(params.error);
    const parsed = openingBalanceSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    recordOpeningBalance(
      req.actor!,
      paymentParamSchema.parse({ relationshipId: req.params.relationshipId }).relationshipId,
      openingBalanceSchema.parse(req.body)
    )
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/customers/:relationshipId/returns - a MANAGER online
// or the OWNER records a returned and refunded article: a CREDIT_NOTE and a REFUND in one
// transaction. Both kinds must be allowed by the rules table; there is no route for a lone
// refund-with-credit split, and the organization and the recorder are the caller's.
financeRoutes.post(
  '/customers/:relationshipId/returns',
  authMiddleware,
  loadActor,
  requireAbility('create', 'LedgerEntry', () => ({ kind: 'CREDIT_NOTE' })),
  requireAbility('create', 'LedgerEntry', () => ({ kind: 'REFUND' })),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = paymentParamSchema.safeParse({ relationshipId: req.params.relationshipId });
    if (!params.success) return next(params.error);
    const parsed = returnSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    recordReturn(
      req.actor!,
      paymentParamSchema.parse({ relationshipId: req.params.relationshipId }).relationshipId,
      returnSchema.parse(req.body)
    )
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/ledger-entries/:entryId/reverse - a MANAGER online or
// the OWNER cancels a wrong ledger entry by adding its mirror. The rules table grants `reverse
// LedgerEntry` to nobody below MANAGER, so a SELLER or DRIVER is refused there; the entry is
// reached only through the caller's own organization, which the service checks (404 outside it).
financeRoutes.post(
  '/ledger-entries/:entryId/reverse',
  authMiddleware,
  loadActor,
  requireAbility('reverse', 'LedgerEntry'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const params = reverseParamSchema.safeParse({ entryId: req.params.entryId });
    if (!params.success) return next(params.error);
    const parsed = reverseEntrySchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    reverseEntry(
      req.actor!,
      reverseParamSchema.parse({ entryId: req.params.entryId }).entryId,
      reverseEntrySchema.parse(req.body)
    )
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/expenses - a MANAGER online or the OWNER records an
// expense paid by a collaborator. The rules table grants `create Expense` to nobody below MANAGER,
// so a SELLER or DRIVER is refused there; the organization and the recorder are the caller's,
// never body fields.
financeRoutes.post(
  '/expenses',
  authMiddleware,
  loadActor,
  requireAbility('create', 'Expense'),
  // Strict validation first, so an invalid request never reserves the idempotency key.
  (req, _res, next) => {
    const parsed = recordExpenseSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    recordExpense(req.actor!, recordExpenseSchema.parse(req.body))
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// GET /api/v1/organizations/:organizationId/customers/:relationshipId/ledger - SELLER and above of
// the supplier read a customer's ledger; the service answers 403 for a DRIVER and 404 outside the
// organization. recorded_by_id is added for OWNER and MANAGER only.
financeRoutes.get(
  '/customers/:relationshipId/ledger',
  authMiddleware,
  loadActor,
  (req, res, next) => {
    Promise.resolve()
      .then(() =>
        listLedger(
          { side: 'SUPPLIER', actor: req.actor! },
          paymentParamSchema.parse({ relationshipId: req.params.relationshipId }).relationshipId,
          ledgerQuerySchema.parse(req.query)
        )
      )
      .then((page) => res.json(page))
      .catch(next);
  }
);

// GET /api/v1/organizations/:organizationId/suppliers/:relationshipId/ledger - a MANAGER or above
// of a customer business reads its account with a supplier; 403 below MANAGER, 404 when the
// organization is not the customer. No recorded_by_id.
financeRoutes.get(
  '/suppliers/:relationshipId/ledger',
  authMiddleware,
  loadActor,
  (req, res, next) => {
    Promise.resolve()
      .then(() =>
        listLedger(
          { side: 'CUSTOMER_ORGANIZATION', actor: req.actor! },
          paymentParamSchema.parse({ relationshipId: req.params.relationshipId }).relationshipId,
          ledgerQuerySchema.parse(req.query)
        )
      )
      .then((page) => res.json(page))
      .catch(next);
  }
);

/** Finance routes of the signed-in person as customer, mounted at `/suppliers`. */
export const financeSupplierRoutes = Router();

// GET /api/v1/suppliers/:relationshipId/ledger - the customer person reads their own account; the
// person comes from the session, and anyone else gets 404. No recorded_by_id.
financeSupplierRoutes.get('/:relationshipId/ledger', authMiddleware, (req, res, next) => {
  Promise.resolve()
    .then(() =>
      listLedger(
        { side: 'CUSTOMER_PERSON', personId: req.user!.id },
        paymentParamSchema.parse({ relationshipId: req.params.relationshipId }).relationshipId,
        ledgerQuerySchema.parse(req.query)
      )
    )
    .then((page) => res.json(page))
    .catch(next);
});
