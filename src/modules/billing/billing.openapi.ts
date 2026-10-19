import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import {
  createPaymentBodyOpenApiSchema,
  paymentResponseSchema,
  shopParamsOpenApiSchema,
  shopResponseSchema,
} from './billing.schemas.js';

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
