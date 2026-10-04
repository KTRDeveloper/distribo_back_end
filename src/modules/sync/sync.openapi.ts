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
    'managers and sellers, a narrower view for drivers, the customer view for customers.',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      last_pulled_at: z
        .string()
        .max(15)
        .optional()
        .openapi({ description: 'Epoch milliseconds of the previous pull' }),
    }),
  },
  responses: {
    200: {
      description: 'The changes per table and the timestamp to send as the next `last_pulled_at`',
      content: {
        'application/json': {
          schema: z.object({
            changes: z.record(z.string(), tableChangesSchema),
            timestamp: z.number().int(),
          }),
        },
      },
    },
    400: {
      description: 'Invalid query',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
