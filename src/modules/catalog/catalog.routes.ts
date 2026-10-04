import { Router } from 'express';
import { httpError } from '../../lib/http-error.js';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import { uuidV7Schema } from '../../shared/ids.js';
import {
  browseCatalogQuerySchema,
  createProductSchema,
  customerPriceParamsSchema,
  editProductSchema,
  listProductsQuerySchema,
  setCustomerPriceSchema,
} from './catalog.schemas.js';
import {
  browseCatalog,
  createProduct,
  editProduct,
  listProducts,
  setCustomerPrice,
} from './catalog.service.js';
import './catalog.openapi.js';

/** Catalog routes of one organization, mounted at `/organizations/:organizationId`. */
export const catalogRoutes = Router({ mergeParams: true });

// GET /api/v1/organizations/:organizationId/catalog - any signed-in person browses an ACTIVE
// business with their own prices; the organization in the path is the supplier, not the caller's
catalogRoutes.get('/catalog', authMiddleware, (req, res, next) => {
  Promise.resolve()
    .then(() => {
      const personId = req.user?.id;
      if (!personId) throw httpError(401, 'UNAUTHORIZED', 'Authentication required');
      const organizationId = uuidV7Schema.parse(req.params.organizationId);
      return browseCatalog(personId, organizationId, browseCatalogQuerySchema.parse(req.query));
    })
    .then((page) => res.json(page))
    .catch(next);
});

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

// PUT /api/v1/organizations/:organizationId/customers/:relationshipId/prices/:productId - OWNER or
// an online MANAGER sets one customer's own price for an article; the service answers 404 outside
// the organization, 403 OWN_RECORD and 409 for a relationship that is not active
catalogRoutes.put(
  '/customers/:relationshipId/prices/:productId',
  authMiddleware,
  loadActor,
  requireAbility('create', 'CustomerPrice'),
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const params = customerPriceParamsSchema.safeParse(req.params);
    if (!params.success) return next(params.error);
    const parsed = setCustomerPriceSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    Promise.resolve()
      .then(() => {
        const { relationshipId, productId } = customerPriceParamsSchema.parse(req.params);
        return setCustomerPrice(
          req.actor!,
          relationshipId,
          productId,
          setCustomerPriceSchema.parse(req.body)
        );
      })
      .then((view) => res.json(view))
      .catch(next);
  }
);
