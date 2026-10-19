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

const productPhotoParams = z.object({
  organizationId: z.string().uuid().openapi({ description: 'The business' }),
  productId: z.string().uuid().openapi({ description: 'The product' }),
  position: z.coerce
    .number()
    .int()
    .min(1)
    .max(5)
    .openapi({ description: 'Place of the photo, 1 to 5; the one after the last adds' }),
});
const productPhotosResponseSchema = z.object({ image_urls: z.array(z.string()).max(5) });

openApiRegistry.registerPath({
  method: 'put',
  path: '/api/v1/organizations/{organizationId}/products/{productId}/photos/{position}',
  tags: ['images'],
  summary: 'Add or replace a photo of a product (manager or owner)',
  security: [{ bearerAuth: [] }],
  request: {
    params: productPhotoParams,
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
      description: 'The photo was stored; the public addresses of all photos, in order',
      content: { 'application/json': { schema: productPhotosResponseSchema } },
    },
    400: {
      description:
        'UNSUPPORTED_IMAGE, IMAGE_TOO_LARGE or VALIDATION_ERROR (empty body, position out of range or after the next free one)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'FORBIDDEN: only a manager or the owner changes product photos',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description:
        'NOT_FOUND: the caller is not an active member of this business, or the product is not in it',
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
  path: '/api/v1/organizations/{organizationId}/products/{productId}/photos/{photoId}',
  tags: ['images'],
  summary: 'Remove a photo of a product by its id (manager or owner)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      organizationId: z.string().uuid().openapi({ description: 'The business' }),
      productId: z.string().uuid().openapi({ description: 'The product' }),
      photoId: z
        .string()
        .uuid()
        .openapi({ description: 'The file name of the photo key, at the end of its address' }),
    }),
  },
  responses: {
    200: {
      description:
        'The photo is removed, or the product did not hold it; the public addresses of the remaining photos, in order',
      content: { 'application/json': { schema: productPhotosResponseSchema } },
    },
    400: {
      description: 'VALIDATION_ERROR: the product id or the photo id is not a UUID',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'FORBIDDEN: only a manager or the owner changes product photos',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description:
        'NOT_FOUND: the caller is not an active member of this business, or the product is not in it',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'ORGANIZATION_NOT_ACTIVE: the business is suspended or closed',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
