import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { lookupQuerySchema, personLookupResponseSchema } from './person.schemas.js';

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/people/lookup',
  tags: ['people'],
  summary: 'Look up a person by phone number',
  security: [{ bearerAuth: [] }],
  request: {
    query: lookupQuerySchema.openapi({
      example: { phone: '6 77 12 34 56' },
    }),
  },
  responses: {
    200: {
      description: 'The public registration view for the normalized phone number',
      content: { 'application/json': { schema: personLookupResponseSchema } },
    },
    400: {
      description: 'Missing or invalid mobile number',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'Hourly lookup limit reached',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
