import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { uuidV7Schema } from '../../shared/ids.js';
import {
  addVariantSchema,
  browseCatalogQuerySchema,
  createProductSchema,
  copyProductSchema,
  copyCustomerPricesSchema,
  customerPricesParamsSchema,
  customerVariantPriceParamsSchema,
  editProductSchema,
  editVariantSchema,
  listCustomerPricesQuerySchema,
  listProductsQuerySchema,
  setCustomerPriceSchema,
} from './catalog.schemas.js';

const organizationParamsSchema = z.object({ organizationId: uuidV7Schema });
const productParamsSchema = organizationParamsSchema.extend({ productId: uuidV7Schema });
const variantParamsSchema = productParamsSchema.extend({ variantId: uuidV7Schema });

const createdVariantViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  unit: z.string(),
  label: z.string(),
  price: z.number().int(),
  price_updated_at: z.string().datetime(),
  min_order_quantity: z.string().nullable(),
  image_urls: z.array(z.string()),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

const editedVariantViewSchema = createdVariantViewSchema.extend({
  negotiated_prices_to_review: z.number().int().min(0),
});

const createdProductViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  image_urls: z.array(z.string()),
  paused: z.boolean(),
  variants: z.array(createdVariantViewSchema),
});

const errorContent = { 'application/json': { schema: errorResponseSchema } };

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/products',
  tags: ['catalog'],
  summary: 'A seller lists the organization articles, newest first',
  security: [{ bearerAuth: [] }],
  request: { params: organizationParamsSchema, query: listProductsQuerySchema },
  responses: {
    200: {
      description: 'A page of products and the next cursor',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(createdProductViewSchema),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: { description: 'Invalid query', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'A DRIVER may not list the catalog', content: errorContent },
    404: { description: 'Not a member of the organization', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/products',
  tags: ['catalog'],
  summary: 'The owner or an online manager adds an article with its variants',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema,
    body: { content: { 'application/json': { schema: createProductSchema } } },
  },
  responses: {
    201: {
      description: 'The created product with its variants, in the order sent',
      content: { 'application/json': { schema: createdProductViewSchema } },
    },
    400: { description: 'Invalid body', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed', content: errorContent },
    404: { description: 'Not a member of the organization', content: errorContent },
    409: {
      description:
        'Organization not active (ORGANIZATION_NOT_ACTIVE), plan limit reached (PRODUCT_LIMIT_REACHED) or two variants alike (VARIANT_EXISTS)',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/products/{productId}/variants',
  tags: ['catalog'],
  summary: 'The owner or an online manager adds a variant to an article',
  security: [{ bearerAuth: [] }],
  request: {
    params: productParamsSchema,
    body: { content: { 'application/json': { schema: addVariantSchema } } },
  },
  responses: {
    201: {
      description: 'The created variant',
      content: { 'application/json': { schema: createdVariantViewSchema } },
    },
    400: { description: 'Invalid body or path', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed', content: errorContent },
    404: {
      description: 'Product absent, deleted or outside the organization',
      content: errorContent,
    },
    409: {
      description:
        'Organization not active (ORGANIZATION_NOT_ACTIVE), plan limit reached (PRODUCT_LIMIT_REACHED) or a live variant with this name and unit (VARIANT_EXISTS)',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}',
  tags: ['catalog'],
  summary: "The owner or an online manager changes a variant's price, unit or availability",
  security: [{ bearerAuth: [] }],
  request: {
    params: variantParamsSchema,
    body: { content: { 'application/json': { schema: editVariantSchema } } },
  },
  responses: {
    200: {
      description:
        'The variant and the count of live negotiated prices older than its new price date',
      content: { 'application/json': { schema: editedVariantViewSchema } },
    },
    400: { description: 'Invalid body or path', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed', content: errorContent },
    404: {
      description: 'Variant absent, deleted or outside the product and organization',
      content: errorContent,
    },
    409: {
      description:
        'Organization not active (ORGANIZATION_NOT_ACTIVE), plan limit reached (PRODUCT_LIMIT_REACHED) or another live variant with this name and unit (VARIANT_EXISTS)',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/organizations/{organizationId}/products/{productId}/variants/{variantId}',
  tags: ['catalog'],
  summary: 'The owner or an online manager deletes a variant that no sale or price cites',
  security: [{ bearerAuth: [] }],
  request: { params: variantParamsSchema },
  responses: {
    204: { description: 'The variant is deleted, or already was' },
    400: { description: 'Invalid path', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed', content: errorContent },
    404: {
      description: 'Variant outside the product and organization',
      content: errorContent,
    },
    409: {
      description:
        'Organization not active (ORGANIZATION_NOT_ACTIVE), variant cited by an order line or a live negotiated price (VARIANT_IN_USE) or the last live variant (LAST_VARIANT)',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/organizations/{organizationId}/products/{productId}',
  tags: ['catalog'],
  summary: 'The owner or an online manager deletes a product with all its variants',
  security: [{ bearerAuth: [] }],
  request: { params: productParamsSchema },
  responses: {
    204: { description: 'The product and its variants are deleted, or already were' },
    400: { description: 'Invalid path', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed', content: errorContent },
    404: { description: 'Product absent or outside the organization', content: errorContent },
    409: {
      description:
        'Organization not active (ORGANIZATION_NOT_ACTIVE) or a variant cited by an order line or a live negotiated price (VARIANT_IN_USE)',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/organizations/{organizationId}/products/{productId}',
  tags: ['catalog'],
  summary: "The owner or an online manager edits an article's name, description and category",
  security: [{ bearerAuth: [] }],
  request: {
    params: productParamsSchema,
    body: { content: { 'application/json': { schema: editProductSchema } } },
  },
  responses: {
    200: {
      description: 'The product with its variants',
      content: { 'application/json': { schema: createdProductViewSchema } },
    },
    400: { description: 'Invalid body', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed', content: errorContent },
    404: { description: 'Product absent or outside the organization', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/catalog',
  tags: ['catalog'],
  summary: "A customer browses a business's articles by product and variant with their own prices",
  security: [{ bearerAuth: [] }],
  request: { params: organizationParamsSchema, query: browseCatalogQuerySchema },
  responses: {
    200: {
      description: 'A page of products on sale with their ACTIVE variants and the next cursor',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                description: z.string().nullable(),
                category: z.string().nullable(),
                image_urls: z.array(z.string()),
                variants: z.array(
                  z.object({
                    id: z.string().uuid(),
                    name: z.string().nullable(),
                    unit: z.string(),
                    label: z.string(),
                    price: z.number().int(),
                    min_order_quantity: z.string().nullable(),
                    price_is_negotiated: z.boolean(),
                    image_urls: z.array(z.string()),
                  })
                ),
              })
            ),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: { description: 'Invalid query', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    404: {
      description:
        'Organization closed, suspended or unknown, or as_organization_id not managed by the caller',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/api/v1/organizations/{organizationId}/customers/{relationshipId}/prices/{variantId}',
  tags: ['catalog'],
  summary: "The owner or an online manager sets a customer's negotiated price for one size",
  security: [{ bearerAuth: [] }],
  request: {
    params: customerVariantPriceParamsSchema,
    body: { content: { 'application/json': { schema: setCustomerPriceSchema } } },
  },
  responses: {
    200: {
      description: 'The live negotiated price, created or replaced',
      content: {
        'application/json': {
          schema: z.object({
            product_variant_id: z.string().uuid(),
            price: z.number().int(),
            set_by_id: z.string().uuid(),
            set_at: z.string().datetime(),
          }),
        },
      },
    },
    400: { description: 'Invalid path or body', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed, or OWN_RECORD', content: errorContent },
    404: {
      description: 'Relationship or variant outside the organization, or not a member',
      content: errorContent,
    },
    409: {
      description: 'Relationship not active, or organization not active',
      content: errorContent,
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/customers/{relationshipId}/prices',
  tags: ['catalog'],
  summary: "A seller lists a customer's negotiated prices, flagged when the variant price changed",
  security: [{ bearerAuth: [] }],
  request: { params: customerPricesParamsSchema, query: listCustomerPricesQuerySchema },
  responses: {
    200: {
      description: 'A page of live negotiated prices and the next cursor',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(
              z.object({
                product_variant_id: z.string().uuid(),
                label: z.string(),
                price: z.number().int(),
                variant_price: z.number().int(),
                set_by_id: z.string().uuid(),
                set_at: z.string().datetime(),
                to_review: z.boolean(),
              })
            ),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: { description: 'Invalid path or query', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed', content: errorContent },
    404: { description: 'Relationship outside the organization', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/organizations/{organizationId}/customers/{relationshipId}/prices/{variantId}',
  tags: ['catalog'],
  summary: "The owner or an online manager removes a customer's negotiated price for one size",
  security: [{ bearerAuth: [] }],
  request: { params: customerVariantPriceParamsSchema },
  responses: {
    204: { description: 'The negotiated price is removed' },
    400: { description: 'Invalid path', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed, or OWN_RECORD', content: errorContent },
    404: {
      description: 'No live price, or relationship or variant outside the organization',
      content: errorContent,
    },
    409: { description: 'Organization not active', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/customers/{relationshipId}/prices/copy',
  tags: ['catalog'],
  summary: "The owner or an online manager copies one customer's negotiated prices to another",
  security: [{ bearerAuth: [] }],
  request: {
    params: customerPricesParamsSchema,
    body: { content: { 'application/json': { schema: copyCustomerPricesSchema } } },
  },
  responses: {
    200: {
      description: 'The number of prices copied onto the target',
      content: { 'application/json': { schema: z.object({ copied: z.number().int() }) } },
    },
    400: {
      description: 'Invalid path or body, or the same relationship as source and target',
      content: errorContent,
    },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed, or OWN_RECORD', content: errorContent },
    404: {
      description: 'Source or target outside the organization, or not a member',
      content: errorContent,
    },
    409: { description: 'Organization not active', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/products/copy',
  tags: ['catalog'],
  summary: 'The owner or an online manager copies purchased variants into their catalog',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema,
    body: { content: { 'application/json': { schema: copyProductSchema } } },
  },
  responses: {
    201: {
      description: 'The destination product, copied variant ids and unchanged live twins',
      content: {
        'application/json': {
          schema: z.object({
            product: createdProductViewSchema,
            copied: z.array(z.string().uuid()),
            already_in_catalog: z.array(
              z.object({
                source_variant_id: z.string().uuid(),
                variant_id: z.string().uuid(),
                status: z.enum(['ACTIVE', 'INACTIVE']),
              })
            ),
          }),
        },
      },
    },
    400: { description: 'Invalid body', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed', content: errorContent },
    404: {
      description:
        'Not a member; source product or variant unavailable through a live supplier relationship; destination absent, deleted or outside the organization',
      content: errorContent,
    },
    409: {
      description:
        'Organization not active (ORGANIZATION_NOT_ACTIVE), plan limit reached (PRODUCT_LIMIT_REACHED) or conflicting repeat',
      content: errorContent,
    },
  },
});
