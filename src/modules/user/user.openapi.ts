import { z } from 'zod';
import { openApiRegistry, errorResponseSchema } from '../../lib/openapi/registry.js';
import { updateProfileSchema } from './user.schemas.js';

const userProfileSchema = z
  .object({
    id: z.string(),
    full_name: z.string().nullable(),
    phone_number: z.string().nullable(),
    phone_verified: z.boolean(),
    email: z.string().nullable(),
    email_verified: z.boolean(),
    preferred_language: z.enum(['FR', 'EN']).nullable(),
    registered: z.boolean(),
    scope_version: z.number().int(),
    created_at: z.string().datetime(),
  })
  .strict();

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/users/me',
  tags: ['user'],
  summary: "Get the signed-in person's profile",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Current person profile',
      content: { 'application/json': { schema: userProfileSchema } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Profile not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/users/me',
  tags: ['user'],
  summary: "Update the signed-in person's profile",
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: updateProfileSchema } } } },
  responses: {
    200: {
      description: 'Updated person profile',
      content: { 'application/json': { schema: userProfileSchema } },
    },
    400: {
      description: 'Invalid profile update',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Profile not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
