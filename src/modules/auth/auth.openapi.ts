import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { registerRequestResponseSchema, registerRequestSchema } from './auth.schemas.js';

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/register/request',
  tags: ['auth'],
  summary: 'Ask for a registration code',
  request: { body: { content: { 'application/json': { schema: registerRequestSchema } } } },
  responses: {
    202: {
      description: 'Code queued',
      content: { 'application/json': { schema: registerRequestResponseSchema } },
    },
    400: {
      description: 'Invalid or unsupported number',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'Code limits reached',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
