import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { uuidV7Schema } from '../../shared/ids.js';
import {
  browseCatalogQuerySchema,
  createProductSchema,
  copyProductSchema,
  copyCustomerPricesSchema,
  customerPriceParamsSchema,
  customerPricesParamsSchema,
  editProductSchema,
  listCustomerPricesQuerySchema,
  listProductsQuerySchema,
  setCustomerPriceSchema,
} from './catalog.schemas.js';

const organizationParamsSchema = z.object({ organizationId: uuidV7Schema });
const productParamsSchema = organizationParamsSchema.extend({ productId: uuidV7Schema });

const productViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  unit: z.string(),
  price: z.number().int(),
  price_updated_at: z.string().datetime(),
  min_order_quantity: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  created_at: z.string().datetime(),
});

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
            items: z.array(productViewSchema),
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
  method: 'patch',
  path: '/api/v1/organizations/{organizationId}/products/{productId}',
  tags: ['catalog'],
  summary: 'The owner or an online manager edits or retires an article',
  security: [{ bearerAuth: [] }],
  request: {
    params: productParamsSchema,
    body: { content: { 'application/json': { schema: editProductSchema } } },
  },
  responses: {
    200: {
      description: 'The product and the negotiated prices to review after a price change',
      content: {
        'application/json': {
          schema: productViewSchema.extend({ negotiated_prices_to_review: z.number().int() }),
        },
      },
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
  summary: "A customer browses a business's articles with their own prices",
  security: [{ bearerAuth: [] }],
  request: { params: organizationParamsSchema, query: browseCatalogQuerySchema },
  responses: {
    200: {
      description: 'A page of ACTIVE articles and the next cursor',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                unit: z.string(),
                price: z.number().int(),
                min_order_quantity: z.string().nullable(),
                description: z.string().nullable(),
                category: z.string().nullable(),
                price_is_negotiated: z.boolean(),
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
  path: '/api/v1/organizations/{organizationId}/customers/{relationshipId}/prices/{productId}',
  tags: ['catalog'],
  summary: "The owner or an online manager sets a customer's negotiated price for an article",
  security: [{ bearerAuth: [] }],
  request: {
    params: customerPriceParamsSchema,
    body: { content: { 'application/json': { schema: setCustomerPriceSchema } } },
  },
  responses: {
    200: {
      description: 'The live negotiated price, created or replaced',
      content: {
        'application/json': {
          schema: z.object({
            product_id: z.string().uuid(),
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
      description: 'Relationship or product outside the organization, or not a member',
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
  summary: "A seller lists a customer's negotiated prices, flagged when the article price changed",
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
                product_id: z.string().uuid(),
                product_name: z.string(),
                price: z.number().int(),
                product_price: z.number().int(),
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
  path: '/api/v1/organizations/{organizationId}/customers/{relationshipId}/prices/{productId}',
  tags: ['catalog'],
  summary: "The owner or an online manager removes a customer's negotiated price",
  security: [{ bearerAuth: [] }],
  request: { params: customerPriceParamsSchema },
  responses: {
    204: { description: 'The negotiated price is removed' },
    400: { description: 'Invalid path', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed, or OWN_RECORD', content: errorContent },
    404: {
      description: 'No live price, or relationship or product outside the organization',
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
  summary: 'The owner or an online manager copies an article they buy into their catalog',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationParamsSchema,
    body: { content: { 'application/json': { schema: copyProductSchema } } },
  },
  responses: {
    201: {
      description: 'The created product, with no link to the source',
      content: { 'application/json': { schema: productViewSchema } },
    },
    400: { description: 'Invalid body', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Role not allowed', content: errorContent },
    404: {
      description: 'Not a member, or the source is not an ACTIVE article of a supplier',
      content: errorContent,
    },
    409: { description: 'Organization not active or conflicting repeat', content: errorContent },
  },
});
