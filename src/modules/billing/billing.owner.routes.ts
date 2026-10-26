import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import { idempotent } from '../../middleware/idempotent.js';
import { keepChoiceBodySchema, keepChoiceParamsSchema, ownerBillingQuerySchema, receiptListQuerySchema, swapProductBodySchema, swapSeatBodySchema } from './billing.schemas.js';
import { listReceipts, readOwnerBilling } from './owner-view.service.js';
import { saveKeepChoice } from './keep-choice.service.js';
import { swapProduct, swapSeat } from './swap.service.js';

/** Owner-only billing gestures, scoped by the authenticated organization's membership. */
export const billingOwnerRoutes = Router({ mergeParams: true });

billingOwnerRoutes.get(
  '/',
  authMiddleware,
  (req, _res, next) => {
    keepChoiceParamsSchema.parse(req.params);
    ownerBillingQuerySchema.parse(req.query);
    next();
  },
  loadActor,
  async (req, res) => {
    res.status(200).json(await readOwnerBilling(req.actor!, new Date()));
  },
);

billingOwnerRoutes.get(
  '/receipts',
  authMiddleware,
  (req, _res, next) => {
    keepChoiceParamsSchema.parse(req.params);
    receiptListQuerySchema.parse(req.query);
    next();
  },
  loadActor,
  async (req, res) => {
    res.status(200).json(await listReceipts(req.actor!, receiptListQuerySchema.parse(req.query)));
  },
);

billingOwnerRoutes.post(
  '/swap-product',
  authMiddleware,
  loadActor,
  requireAbility('keep', 'Product'),
  (req, _res, next) => {
    keepChoiceParamsSchema.parse(req.params);
    req.body = swapProductBodySchema.parse(req.body);
    next();
  },
  idempotent(),
  async (req, res) => {
    const input = swapProductBodySchema.parse(req.body);
    const view = await swapProduct(req.actor!, {
      id: input.id,
      pauseProductId: input.pause_product_id,
      resumeProductId: input.resume_product_id,
    }, new Date());
    res.status(201).json(view);
  },
);

billingOwnerRoutes.post(
  '/swap-seat',
  authMiddleware,
  loadActor,
  requireAbility('keep', 'Collaboration'),
  (req, _res, next) => {
    keepChoiceParamsSchema.parse(req.params);
    req.body = swapSeatBodySchema.parse(req.body);
    next();
  },
  idempotent(),
  async (req, res) => {
    const input = swapSeatBodySchema.parse(req.body);
    const view = await swapSeat(req.actor!, {
      id: input.id,
      pauseCollaborationId: input.pause_collaboration_id,
      resumeCollaborationId: input.resume_collaboration_id,
    }, new Date());
    res.status(201).json(view);
  },
);

billingOwnerRoutes.post(
  '/keep-choice',
  authMiddleware,
  loadActor,
  requireAbility('keep', 'Collaboration'),
  requireAbility('keep', 'Product'),
  (req, _res, next) => {
    keepChoiceParamsSchema.parse(req.params);
    req.body = keepChoiceBodySchema.parse(req.body);
    next();
  },
  idempotent(),
  async (req, res) => {
    const input = keepChoiceBodySchema.parse(req.body);
    const view = await saveKeepChoice(req.actor!, {
      id: input.id,
      collaborationIds: input.collaboration_ids,
      productIds: input.product_ids,
    });
    res.status(201).json(view);
  }
);
