import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import {
  createPaymentBodyOpenApiSchema,
  keepChoiceBodySchema,
  keepChoiceParamsSchema,
  keepChoiceResponseSchema,
  ownerBillingQuerySchema,
  ownerBillingResponseSchema,
  paymentResponseSchema,
  paymentStatusParamsSchema,
  paymentStatusQuerySchema,
  paymentStatusResponseSchema,
  quoteQuerySchema,
  quoteResponseSchema,
  shopParamsOpenApiSchema,
  shopResponseSchema,
  swapProductBodySchema,
  swapProductResponseSchema,
  swapSeatBodySchema,
  swapSeatResponseSchema,
} from './billing.schemas.js';

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/billing',
  tags: ['billing'],
  summary: 'Read the owner subscription screen and end-of-grace preview without writing',
  security: [{ bearerAuth: [] }],
  request: { params: keepChoiceParamsSchema, query: ownerBillingQuerySchema },
  responses: {
    200: {
      description: 'Computed rights, live periods, usage and the next plan with excess counts',
      content: { 'application/json': { schema: ownerBillingResponseSchema } },
    },
    400: {
      description: 'Invalid organization UUID or unexpected query field',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Only the owner may read the subscription screen',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Organization absent or outside caller scope',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/billing/swap-product',
  tags: ['billing'],
  summary: 'Swap a paused product with a product on sale (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: keepChoiceParamsSchema,
    body: { content: { 'application/json': { schema: swapProductBodySchema } } },
  },
  responses: {
    201: {
      description: 'Products swapped with owner events and a current keep choice',
      content: { 'application/json': { schema: swapProductResponseSchema } },
    },
    400: {
      description: 'Invalid body, UUID or identical product ids',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Only the owner may swap products',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Organization outside caller scope or product absent, deleted or foreign',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'PRODUCT_STATE or REQUEST_IN_PROGRESS',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/billing/swap-seat',
  tags: ['billing'],
  summary: 'Swap a paused team seat with an active or invited seat (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: keepChoiceParamsSchema,
    body: { content: { 'application/json': { schema: swapSeatBodySchema } } },
  },
  responses: {
    201: {
      description: 'Seats swapped with owner events, notices and a current keep choice',
      content: { 'application/json': { schema: swapSeatResponseSchema } },
    },
    400: {
      description: 'Invalid body, UUID or identical seat ids',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Only the owner may swap seats',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Organization outside caller scope or seat absent, foreign or owner',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'SEAT_STATE, DRIVER_ON_DELIVERY or REQUEST_IN_PROGRESS',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/billing/keep-choice',
  tags: ['billing'],
  summary: 'Record the owner choice of seats and products to keep when a plan ends',
  security: [{ bearerAuth: [] }],
  request: {
    params: keepChoiceParamsSchema,
    body: { content: { 'application/json': { schema: keepChoiceBodySchema } } },
  },
  responses: {
    201: {
      description: 'The two lists recorded in one immutable KEEP_CHOICE event',
      content: { 'application/json': { schema: keepChoiceResponseSchema } },
    },
    400: {
      description: 'Invalid body, duplicate ids, or more than 100 ids in either list',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'Only the owner may choose',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Organization outside caller scope or any ineligible selected id',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'A request with this gesture id is already in progress',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/billing/shops/{code}',
  tags: ['billing'],
  summary: 'Read the name of a business from its payment code (public)',
  request: { params: shopParamsOpenApiSchema },
  responses: {
    200: {
      description: 'The name of the ACTIVE business, nothing more',
      content: { 'application/json': { schema: shopResponseSchema } },
    },
    400: {
      description: 'Malformed code',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'No ACTIVE business holds this code',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'More than 30 lookups an hour from this address',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/billing/shops/{code}/quote',
  tags: ['billing'],
  summary: 'Preview a paid pack price and purchased period before paying (public)',
  security: [],
  request: { params: shopParamsOpenApiSchema, query: quoteQuerySchema },
  responses: {
    200: {
      description: 'Seven public quote fields; upgrade dates cover only the purchased period',
      content: { 'application/json': { schema: quoteResponseSchema } },
    },
    400: {
      description: 'Malformed code, invalid plan or months, or unexpected query field',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'No ACTIVE business holds this code',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'More than 60 quotes an hour from this address',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/billing/payments/{id}',
  tags: ['billing'],
  summary: 'Follow a payment and read its original receipt (public)',
  security: [],
  request: { params: paymentStatusParamsSchema, query: paymentStatusQuerySchema },
  responses: {
    200: {
      description: 'Public payment status, purchased period when succeeded, and original receipt',
      content: { 'application/json': { schema: paymentStatusResponseSchema } },
    },
    400: {
      description: 'Invalid UUID or unexpected query field',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Unknown payment id',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'More than 120 status reads an hour from this address',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/billing/payments',
  tags: ['billing'],
  summary: 'Start the payment of a plan for a business (public)',
  request: {
    body: { content: { 'application/json': { schema: createPaymentBodyOpenApiSchema } } },
  },
  responses: {
    201: {
      description: 'The payment, PENDING, with the amount computed by the server',
      content: { 'application/json': { schema: paymentResponseSchema } },
    },
    400: {
      description: 'Invalid body, including an unknown field such as an amount',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'No ACTIVE business holds this code',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'TERMS_CHANGED, or PAYMENT_ID_USED when the id belongs to another body',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'More than 10 payments an hour from this address, or 5 for one payer number',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
