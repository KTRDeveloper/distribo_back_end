import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';

const photoBodySchema = z
  .string()
  .openapi({ format: 'binary', description: 'The raw photo bytes' });
const avatarResponseSchema = z.object({ avatar_url: z.string() });

openApiRegistry.registerPath({
  method: 'put',
  path: '/api/v1/users/me/avatar',
  tags: ['images'],
  summary: 'Add or replace the profile photo of the caller',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'image/jpeg': { schema: photoBodySchema },
        'image/png': { schema: photoBodySchema },
        'image/webp': { schema: photoBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: 'The photo was stored; its public address',
      content: { 'application/json': { schema: avatarResponseSchema } },
    },
    400: {
      description: 'UNSUPPORTED_IMAGE, IMAGE_TOO_LARGE or VALIDATION_ERROR (empty body)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'AVATAR_NOT_ALLOWED: a guest or an anonymized account has no photo',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/users/me/avatar',
  tags: ['images'],
  summary: 'Remove the profile photo of the caller',
  security: [{ bearerAuth: [] }],
  responses: {
    204: { description: 'The photo is removed, or there was none' },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

const logoResponseSchema = z.object({ logo_url: z.string() });
const organizationIdParams = z.object({
  organizationId: z.string().uuid().openapi({ description: 'The business' }),
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/api/v1/organizations/{organizationId}/logo',
  tags: ['images'],
  summary: 'Add or replace the logo of a business (owner only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationIdParams,
    body: {
      required: true,
      content: {
        'image/jpeg': { schema: photoBodySchema },
        'image/png': { schema: photoBodySchema },
        'image/webp': { schema: photoBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: 'The logo was stored; its public address',
      content: { 'application/json': { schema: logoResponseSchema } },
    },
    400: {
      description: 'UNSUPPORTED_IMAGE, IMAGE_TOO_LARGE or VALIDATION_ERROR',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'FORBIDDEN: only the owner changes the logo',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'NOT_FOUND: the caller is not an active member of this business',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'ORGANIZATION_NOT_ACTIVE: the business is suspended or closed',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/organizations/{organizationId}/logo',
  tags: ['images'],
  summary: 'Remove the logo of a business (owner only)',
  security: [{ bearerAuth: [] }],
  request: { params: organizationIdParams },
  responses: {
    204: { description: 'The logo is removed, or there was none' },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'FORBIDDEN: only the owner changes the logo',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'NOT_FOUND: the caller is not an active member of this business',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'ORGANIZATION_NOT_ACTIVE: the business is suspended or closed',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
