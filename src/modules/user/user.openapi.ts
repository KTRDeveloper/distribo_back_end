import { z } from 'zod';
import { openApiRegistry, errorResponseSchema } from '../../lib/openapi/registry.js';
import { updateProfileSchema } from './user.schemas.js';

/**
 * Registers the user module's routes with the shared OpenAPI registry.
 * Imported once (as a side effect) from src/app.ts so its paths are
 * included in the generated document. Every route here requires
 * authentication (see src/modules/user/user.routes.ts).
 */

const userProfileSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  emailVerifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/users/me',
  tags: ['user'],
  summary: "Get the signed-in user's profile",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Current user profile',
      content: { 'application/json': { schema: userProfileSchema } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/users/me',
  tags: ['user'],
  summary: "Update the signed-in user's profile",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: updateProfileSchema } } } },
  responses: {
    200: {
      description: 'Updated user profile',
      content: { 'application/json': { schema: userProfileSchema } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});
