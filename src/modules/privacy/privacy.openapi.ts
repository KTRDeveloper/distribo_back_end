import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import {
  deleteAccountBodySchema,
  deletionBlockedResponseSchema,
  deletionCheckResponseSchema,
} from './privacy.schemas.js';

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

openApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/users/me',
  tags: ['privacy'],
  summary: 'Delete the caller account by anonymization',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: deleteAccountBodySchema } },
    },
  },
  responses: {
    204: { description: 'Account anonymized' },
    400: {
      description: 'Missing or invalid password field',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing or invalid token, or wrong password (INVALID_CREDENTIALS)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'A positive balance or an owned organization blocks the deletion',
      content: { 'application/json': { schema: deletionBlockedResponseSchema } },
    },
    429: {
      description: 'Too many failed password attempts (LOGIN_LOCKED)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
