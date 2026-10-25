import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import { idempotent } from '../../middleware/idempotent.js';
import { keepChoiceBodySchema, keepChoiceParamsSchema } from './billing.schemas.js';
import { saveKeepChoice } from './keep-choice.service.js';

/** Owner-only billing gestures, scoped by the authenticated organization's membership. */
export const billingOwnerRoutes = Router({ mergeParams: true });

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
