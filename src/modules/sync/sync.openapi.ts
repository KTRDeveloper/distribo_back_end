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

const pushResponseSchema = z.object({
  accepted: z.number().int(),
  rejected: z.array(
    z.object({ table: z.string(), id: z.string(), code: z.string(), message: z.string() })
  ),
  aside: z.number().int(),
  clock_skew: z.boolean(),
  resync_required: z.boolean(),
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/sync/push',
  tags: ['sync'],
  summary: 'Push what the phone did offline',
  description:
    'Body `{ changes: { <table>: { created, updated, deleted } } }`, at most 2000 rows in total ' +
    '(body limit 5 MB). The batch is archived as received first. Then: an `X-App-Version` below ' +
    'the platform minimum gets 426 `APP_UPDATE_REQUIRED`; an `X-Client-Time` more than 5 minutes ' +
    'from server time sets `clock_skew`; an updated row changed on the server after ' +
    '`last_pulled_at` gets 409 `SYNC_CONFLICT` and nothing is applied; otherwise the batch is ' +
    'judged in one transaction. A table the server does not know is counted in `aside` and the ' +
    "rest passes. A processed push sets the device's `last_synced_at`.",
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      last_pulled_at: z
        .string()
        .max(15)
        .openapi({ description: 'Epoch milliseconds of the previous pull' }),
    }),
    headers: z.object({
      'X-App-Version': z
        .string()
        .optional()
        .openapi({ description: 'Dotted numbers such as 1.4.2' }),
      'X-Client-Time': z
        .string()
        .optional()
        .openapi({ description: 'Phone clock, epoch milliseconds or ISO 8601' }),
    }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({ changes: z.record(z.string(), tableChangesSchema) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The batch was processed',
      content: { 'application/json': { schema: pushResponseSchema } },
    },
    400: {
      description: 'Invalid query, headers or body, or more than 2000 rows',
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
    409: {
      description: '`SYNC_CONFLICT`: pull the latest changes, then send again',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    413: {
      description: 'Body above 5 MB',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    426: {
      description: '`APP_UPDATE_REQUIRED`: the app version is below the platform minimum',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

const issueSchema = z.object({
  table: z.enum(['orders', 'deliveries']),
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  code: z.string(),
  message: z.string(),
  created_at: z.string().datetime(),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/sync/issues',
  tags: ['sync'],
  summary: 'List the orders and deliveries the server flagged for the caller to resolve',
  description:
    'Orders and deliveries whose `sync_issue` is not empty and that the caller entered, delivered ' +
    'or is assigned to; an OWNER sees all of the organization. `code` is the text before the first ' +
    'colon of the issue and `message` the issue text. Newest first, paginated; an issue disappears ' +
    'when the record is corrected. A delivery is dated by its order.',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
      cursor: z.string().max(300).optional(),
    }),
  },
  responses: {
    200: {
      description: 'One page of issues',
      content: {
        'application/json': {
          schema: z.object({ items: z.array(issueSchema), next_cursor: z.string().nullable() }),
        },
      },
    },
    400: {
      description: 'Invalid limit or cursor',
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
