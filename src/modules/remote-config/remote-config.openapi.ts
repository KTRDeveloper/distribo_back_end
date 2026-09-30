import { z } from 'zod';
import { openApiRegistry } from '../../lib/openapi/registry.js';
import {
  categorySchema,
  keySchema,
  listConfigsQuerySchema,
  getHistoryQuerySchema,
  migrateRequestSchema,
  uuidSchema,
} from './remote-config.schemas.js';

/**
 * Registers the remote-config module's routes with the shared OpenAPI
 * registry. Imported once (as a side effect) from src/app.ts so its paths
 * are included in the generated document.
 *
 * `createConfigSchema`/`updateConfigSchema` are not imported directly:
 * their `value` field (`configValueSchema`) uses a `.refine()` that calls
 * `JSON.stringify(value).length`, which throws when zod-to-openapi probes
 * the schema with `undefined` to determine optionality. The `value` field
 * below documents the same shape (any JSON value, subject to a 10KB
 * JSON-encoded size limit enforced at runtime) without that crash.
 */

const configResponseSchema = z.object({
  id: z.string(),
  category: z.string(),
  key: z.string(),
  value: z.unknown(),
  isSensitive: z.boolean(),
  isProtected: z.boolean(),
  enabled: z.boolean(),
  description: z.string().nullable(),
  metadata: z.object({
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    createdBy: z.string().nullable(),
    updatedBy: z.string().nullable(),
  }),
  validation: z.object({
    lastValidatedAt: z.string().datetime().nullable(),
    status: z.enum(['valid', 'invalid', 'untested']).nullable(),
    error: z.string().nullable(),
  }),
});

const configValueOpenApiSchema = z
  .unknown()
  .openapi({ description: 'Any JSON-serializable value, up to 10KB when JSON-encoded' });

const createConfigOpenApiSchema = z.object({
  category: categorySchema,
  key: keySchema,
  value: configValueOpenApiSchema,
  isSensitive: z.boolean().optional().default(false),
  isProtected: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
  description: z.string().max(1000).optional(),
  createdBy: z.string().max(255).optional(),
});

const updateConfigOpenApiSchema = z.object({
  value: configValueOpenApiSchema.optional(),
  description: z.string().max(1000).optional().nullable(),
  enabled: z.boolean().optional(),
  isProtected: z.boolean().optional(),
  updatedBy: z.string().max(255).optional(),
  reason: z.string().max(500).optional(),
});

const configIdParam = z.object({ id: uuidSchema });

const apiErrorSchema = z.object({ success: z.literal(false), error: z.string() });

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/remote-config',
  tags: ['remote-config'],
  summary: 'Create a new configuration',
  request: { body: { content: { 'application/json': { schema: createConfigOpenApiSchema } } } },
  responses: {
    201: {
      description: 'Configuration created',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: configResponseSchema }) } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: apiErrorSchema } } },
    409: { description: 'Category+key already exists', content: { 'application/json': { schema: apiErrorSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/remote-config',
  tags: ['remote-config'],
  summary: 'List configurations with optional filtering',
  request: { query: listConfigsQuerySchema },
  responses: {
    200: {
      description: 'List of configurations',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true), data: z.array(configResponseSchema), count: z.number() }),
        },
      },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/remote-config/{id}',
  tags: ['remote-config'],
  summary: 'Get a configuration by ID',
  request: { params: configIdParam },
  responses: {
    200: {
      description: 'The configuration',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: configResponseSchema }) } },
    },
    404: { description: 'Configuration not found', content: { 'application/json': { schema: apiErrorSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/remote-config/category/{category}/key/{key}',
  tags: ['remote-config'],
  summary: 'Get a configuration by category and key',
  request: { params: z.object({ category: z.string(), key: z.string() }) },
  responses: {
    200: {
      description: 'The configuration',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: configResponseSchema }) } },
    },
    404: { description: 'Configuration not found', content: { 'application/json': { schema: apiErrorSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'put',
  path: '/api/v1/remote-config/{id}',
  tags: ['remote-config'],
  summary: 'Update an existing configuration',
  request: {
    params: configIdParam,
    body: { content: { 'application/json': { schema: updateConfigOpenApiSchema } } },
  },
  responses: {
    200: {
      description: 'Configuration updated',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), data: configResponseSchema }) } },
    },
    404: { description: 'Configuration not found', content: { 'application/json': { schema: apiErrorSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/remote-config/{id}',
  tags: ['remote-config'],
  summary: 'Delete a configuration',
  request: { params: configIdParam },
  responses: {
    200: {
      description: 'Configuration deleted',
      content: { 'application/json': { schema: z.object({ success: z.literal(true), message: z.string() }) } },
    },
    404: { description: 'Configuration not found', content: { 'application/json': { schema: apiErrorSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/remote-config/{id}/history',
  tags: ['remote-config'],
  summary: 'Get configuration change history',
  request: { params: configIdParam, query: getHistoryQuerySchema },
  responses: {
    200: {
      description: 'Paginated history',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(
              z.object({
                id: z.string(),
                configId: z.string(),
                action: z.enum(['created', 'updated', 'deleted', 'validated']),
                previousValue: z.unknown().nullable(),
                newValue: z.unknown().nullable(),
                changedAt: z.string().datetime(),
                changedBy: z.string().nullable(),
                reason: z.string().nullable(),
              })
            ),
            pagination: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
              hasMore: z.boolean(),
            }),
          }),
        },
      },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/remote-config/{id}/validate',
  tags: ['remote-config'],
  summary: 'Validate a configuration value',
  request: { params: configIdParam },
  responses: {
    200: {
      description: 'Validation result',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              valid: z.boolean(),
              status: z.enum(['valid', 'invalid', 'untested']),
              error: z.string().nullable(),
            }),
          }),
        },
      },
    },
    404: { description: 'Configuration not found', content: { 'application/json': { schema: apiErrorSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/remote-config/migrate',
  tags: ['remote-config'],
  summary: 'Migrate environment variables into the configuration database',
  request: { body: { content: { 'application/json': { schema: migrateRequestSchema } } } },
  responses: {
    200: {
      description: 'Migration completed',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              success: z.boolean(),
              migratedCount: z.number(),
              skippedCount: z.number(),
              failedCount: z.number(),
              details: z.array(
                z.object({
                  envVar: z.string(),
                  category: z.string(),
                  key: z.string(),
                  status: z.enum(['migrated', 'skipped', 'failed']),
                  reason: z.string().optional(),
                })
              ),
            }),
          }),
        },
      },
    },
    207: { description: 'Partial success', content: { 'application/json': { schema: apiErrorSchema } } },
  },
});
