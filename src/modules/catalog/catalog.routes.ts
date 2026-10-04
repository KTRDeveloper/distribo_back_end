import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import { createProductSchema } from './catalog.schemas.js';
import { createProduct } from './catalog.service.js';

/** Catalog routes of one organization, mounted at `/organizations/:organizationId`. */
export const catalogRoutes = Router({ mergeParams: true });

// POST /api/v1/organizations/:organizationId/products - OWNER or an online MANAGER adds an article
catalogRoutes.post(
  '/products',
  authMiddleware,
  loadActor,
  requireAbility('create', 'Product'),
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    createProduct(req.actor!, createProductSchema.parse(req.body))
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);
