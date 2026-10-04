import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import { uuidV7Schema } from '../../shared/ids.js';
import {
  createProductSchema,
  editProductSchema,
  listProductsQuerySchema,
} from './catalog.schemas.js';
import { createProduct, editProduct, listProducts } from './catalog.service.js';
import './catalog.openapi.js';

/** Catalog routes of one organization, mounted at `/organizations/:organizationId`. */
export const catalogRoutes = Router({ mergeParams: true });

// GET /api/v1/organizations/:organizationId/products - SELLER and above list the articles;
// the service answers 403 for a DRIVER
catalogRoutes.get('/products', authMiddleware, loadActor, (req, res, next) => {
  Promise.resolve()
    .then(() => listProducts(req.actor!, listProductsQuerySchema.parse(req.query)))
    .then((page) => res.json(page))
    .catch(next);
});

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

// PATCH /api/v1/organizations/:organizationId/products/:productId - OWNER or an online MANAGER
// edits or retires an article. Repeating it sets the same values, so it needs no gesture id.
catalogRoutes.patch(
  '/products/:productId',
  authMiddleware,
  loadActor,
  requireAbility('update', 'Product'),
  (req, res, next) => {
    const productId = uuidV7Schema.safeParse(req.params.productId);
    if (!productId.success) return next(productId.error);
    const parsed = editProductSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    editProduct(req.actor!, productId.data, parsed.data)
      .then((view) => res.json(view))
      .catch(next);
    return undefined;
  }
);
