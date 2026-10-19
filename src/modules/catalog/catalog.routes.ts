import { Router } from 'express';
import { httpError } from '../../lib/http-error.js';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import { uuidV7Schema } from '../../shared/ids.js';
import {
  addVariantParamsSchema,
  addVariantSchema,
  browseCatalogQuerySchema,
  copyCustomerPricesSchema,
  copyProductSchema,
  createProductSchema,
  customerPriceParamsSchema,
  customerPricesParamsSchema,
  editProductSchema,
  editVariantParamsSchema,
  editVariantSchema,
  listCustomerPricesQuerySchema,
  listProductsQuerySchema,
  setCustomerPriceSchema,
} from './catalog.schemas.js';
import {
  addVariant,
  browseCatalog,
  copyCustomerPrices,
  copyProduct,
  createProduct,
  editProduct,
  editVariant,
  listCustomerPrices,
  listProducts,
  removeCustomerPrice,
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

// POST /api/v1/organizations/:organizationId/products/copy - OWNER or an online MANAGER copies an
// article they buy into their own catalog; the service answers 404 for any source that is not a
// live supplier's ACTIVE article
catalogRoutes.post(
  '/products/copy',
  authMiddleware,
  loadActor,
  requireAbility('create', 'Product'),
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = copyProductSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    copyProduct(req.actor!, copyProductSchema.parse(req.body))
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/products/:productId/variants - OWNER or an online
// MANAGER adds a size, colour or format to an article; the service answers 404 for a deleted
// product or another business's, 409 VARIANT_EXISTS and PRODUCT_LIMIT_REACHED
catalogRoutes.post(
  '/products/:productId/variants',
  authMiddleware,
  loadActor,
  requireAbility('create', 'ProductVariant'),
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const params = addVariantParamsSchema.safeParse(req.params);
    if (!params.success) return next(params.error);
    const parsed = addVariantSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    Promise.resolve()
      .then(() => {
        const { productId } = addVariantParamsSchema.parse(req.params);
        return addVariant(req.actor!, productId, addVariantSchema.parse(req.body));
      })
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// PATCH /api/v1/organizations/:organizationId/products/:productId - OWNER or an online MANAGER
// edits an article's name, description and category. Repeating it sets the same values, so it needs no gesture id.
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

// PATCH /api/v1/organizations/:organizationId/products/:productId/variants/:variantId - OWNER or an
// online MANAGER changes a size's name, unit, price, minimum quantity or status. Repeating it sets
// the same values, so it needs no gesture id; the service answers 404 for a deleted variant or
// another business's, 409 VARIANT_EXISTS and PRODUCT_LIMIT_REACHED
catalogRoutes.patch(
  '/products/:productId/variants/:variantId',
  authMiddleware,
  loadActor,
  requireAbility('update', 'ProductVariant'),
  (req, res, next) => {
    const params = editVariantParamsSchema.safeParse(req.params);
    if (!params.success) return next(params.error);
    const parsed = editVariantSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    editVariant(req.actor!, params.data.productId, params.data.variantId, parsed.data)
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

// GET /api/v1/organizations/:organizationId/customers/:relationshipId/prices - SELLER and above
// list one customer's negotiated prices with the review flag; the service answers 403 for a
// DRIVER and 404 outside the organization
catalogRoutes.get(
  '/customers/:relationshipId/prices',
  authMiddleware,
  loadActor,
  (req, res, next) => {
    Promise.resolve()
      .then(() => {
        const { relationshipId } = customerPricesParamsSchema.parse(req.params);
        return listCustomerPrices(
          req.actor!,
          relationshipId,
          listCustomerPricesQuerySchema.parse(req.query)
        );
      })
      .then((page) => res.json(page))
      .catch(next);
  }
);

// DELETE /api/v1/organizations/:organizationId/customers/:relationshipId/prices/:productId -
// OWNER or an online MANAGER removes a negotiated price. It has no body and so no gesture id: a
// repeat finds no live price and answers 404.
catalogRoutes.delete(
  '/customers/:relationshipId/prices/:productId',
  authMiddleware,
  loadActor,
  requireAbility('delete', 'CustomerPrice'),
  (req, res, next) => {
    Promise.resolve()
      .then(() => {
        const { relationshipId, productId } = customerPriceParamsSchema.parse(req.params);
        return removeCustomerPrice(req.actor!, relationshipId, productId);
      })
      .then(() => res.status(204).end())
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/customers/:relationshipId/prices/copy - OWNER or an
// online MANAGER copies another customer's negotiated prices onto this one; the service answers
// 404 outside the organization and 403 OWN_RECORD
catalogRoutes.post(
  '/customers/:relationshipId/prices/copy',
  authMiddleware,
  loadActor,
  requireAbility('create', 'CustomerPrice'),
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const params = customerPricesParamsSchema.safeParse(req.params);
    if (!params.success) return next(params.error);
    const parsed = copyCustomerPricesSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    if (parsed.data.from_relationship_id === params.data.relationshipId) {
      return next(httpError(400, 'VALIDATION_ERROR', 'Source and target must differ'));
    }
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    Promise.resolve()
      .then(() => {
        const { relationshipId } = customerPricesParamsSchema.parse(req.params);
        return copyCustomerPrices(
          req.actor!,
          relationshipId,
          copyCustomerPricesSchema.parse(req.body)
        );
      })
      .then((view) => res.json(view))
      .catch(next);
  }
);
