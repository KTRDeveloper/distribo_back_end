import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { shopParamsOpenApiSchema, shopResponseSchema } from './billing.schemas.js';

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
