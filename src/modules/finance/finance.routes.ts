import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import { logger } from '../../lib/logger.js';
import { httpError } from '../../lib/http-error.js';
import { atLeast } from '../../shared/access/roles.js';
import { creditNoteSchema, paymentParamSchema, recordPaymentSchema } from './finance.schemas.js';
import { recordCreditNote, recordPayment, recordRefund } from './finance.service.js';

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
