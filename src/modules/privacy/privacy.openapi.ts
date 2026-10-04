import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { deletionCheckResponseSchema } from './privacy.schemas.js';

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/users/me/deletion-check',
  tags: ['privacy'],
  summary: 'List what blocks the deletion of the caller account',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Whether the account can be deleted, with the blockers',
      content: { 'application/json': { schema: deletionCheckResponseSchema } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
