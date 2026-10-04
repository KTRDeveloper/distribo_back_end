import { z } from 'zod';
import { openApiRegistry, errorResponseSchema } from '../../lib/openapi/registry.js';

const rowSchema = z.record(z.string(), z.unknown());

const tableChangesSchema = z.object({
  created: z.array(rowSchema),
  updated: z.array(rowSchema),
  deleted: z.array(z.string().uuid()),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/sync/pull',
  tags: ['sync'],
  summary: 'Pull what changed for the signed-in person since the last pull',
  description:
    'Returns, per synchronized table, the rows created, updated and deleted since `last_pulled_at` ' +
    '(epoch milliseconds; absent for a first pull), limited to what the caller may see. ' +
    'Order, order line and delivery rows follow the role of the caller: supplier view for owners, ' +
    'managers and sellers, a narrower view for drivers, the customer view for customers. ' +
    'The header `X-Scope-Version` is the rights version the phone knows: when it is lower than the ' +
    "person's and `last_pulled_at` is set, the answer is `{ resync_required: true }` without changes " +
    'and the phone starts again with a full pull. A full pull records the version on the device. ' +
    'Every pull sets the device `last_synced_at`.',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      last_pulled_at: z
        .string()
        .max(15)
        .optional()
        .openapi({ description: 'Epoch milliseconds of the previous pull' }),
    }),
    headers: z.object({
      'X-Scope-Version': z
        .string()
        .regex(/^\d{1,9}$/)
        .optional()
        .openapi({ description: 'The rights version the phone knows; absent counts as 0' }),
    }),
  },
  responses: {
    200: {
      description: 'The changes per table and the timestamp to send as the next `last_pulled_at`',
      content: {
        'application/json': {
          schema: z.union([
            z.object({
              changes: z.record(z.string(), tableChangesSchema),
              timestamp: z.number().int(),
              scope_version: z.number().int(),
            }),
            z.object({
              resync_required: z.literal(true),
              timestamp: z.number().int(),
              scope_version: z.number().int(),
            }),
          ]),
        },
      },
    },
    400: {
      description: 'Invalid query',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing or invalid token, or `SESSION_REVOKED` for a revoked device',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
