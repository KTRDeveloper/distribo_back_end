import { z } from 'zod';
import { openApiRegistry, errorResponseSchema } from '../../lib/openapi/registry.js';
import { uuidV7Schema } from '../../shared/ids.js';
import {
  archiveIdParamsSchema,
  listArchivesQuerySchema,
  replayBodySchema,
  syncExceptionsQuerySchema,
} from './sync.schemas.js';

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

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}/exceptions/sync',
  tags: ['sync'],
  summary: 'Flagged synchronization operations grouped by cause (OWNER only)',
  description:
    'Orders of the organization created in the period whose `sync_issue` is not empty, counted per ' +
    'code. `PRICE_CHANGED` carries the francs lost on lines sold below the current price, ' +
    '`CREDIT_EXCEEDED` the amount over the limit; other codes have amount 0. Same period rules as ' +
    'the money exceptions: `from` and `to` as dates, default the last 7 days, at most 92 days apart.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ organizationId: uuidV7Schema }),
    query: syncExceptionsQuerySchema,
  },
  responses: {
    200: {
      description: 'One item per cause, largest amount first',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(
              z.object({
                code: z.string(),
                count: z.number().int(),
                amount: z.number().int(),
                persons: z.array(z.string().uuid()),
              })
            ),
          }),
        },
      },
    },
    400: {
      description: 'Malformed date, from after to, or more than 92 days',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing or invalid token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'The caller is not the owner',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Not a member of the organization',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/admin/sync-archives/{archiveId}/replay',
  tags: ['sync'],
  summary:
    'Replay an archived batch after the cause of a refusal is fixed (super administrator only)',
  description:
    'The batch is judged as if sent by its author with their current rights, never the ' +
    "administrator's: only the version, clock and conflict checks of a push are skipped. A " +
    'REPLAY_SYNC journal row (archive id and reason) is written in the same transaction, and the ' +
    'author and the owners get a notification. A batch can be replayed more than once; lines are ' +
    'idempotent by record id.',
  security: [{ bearerAuth: [] }],
  request: {
    params: archiveIdParamsSchema,
    body: { content: { 'application/json': { schema: replayBodySchema } } },
  },
  responses: {
    200: {
      description: 'What the replay came to, as a push reports it',
      content: {
        'application/json': {
          schema: z.object({
            accepted: z.number().int(),
            rejected: z.array(
              z.object({
                table: z.string(),
                id: z.string(),
                code: z.string(),
                message: z.string(),
              })
            ),
            aside: z.number().int(),
            resync_required: z.boolean(),
          }),
        },
      },
    },
    400: {
      description: 'Missing, empty or too long reason, or a malformed archive id',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing, invalid or non-administration token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'The administrator is not a super administrator',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Unknown archive',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

const rowCountsSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  deleted: z.number().int(),
});

const archiveSummarySchema = z.object({
  id: z.string().uuid(),
  person_id: z.string().uuid(),
  device_id: z.string().uuid(),
  received_at: z.string(),
  row_counts: z.record(rowCountsSchema),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/admin/sync-archives',
  tags: ['sync'],
  summary: 'List archived batches by person and period (any administrator)',
  description:
    'Newest first. Each item carries the number of rows created, updated and deleted per table, ' +
    'never the batch content. `from` and `to` are UTC days, both included.',
  security: [{ bearerAuth: [] }],
  request: { query: listArchivesQuerySchema },
  responses: {
    200: {
      description: 'One page of batch summaries',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(archiveSummarySchema),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: {
      description: 'Malformed person, date, limit or cursor, or from after to',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing, invalid or non-administration token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/admin/sync-archives/{archiveId}',
  tags: ['sync'],
  summary: 'Open an archived batch with its changes (super administrator only)',
  security: [{ bearerAuth: [] }],
  request: { params: archiveIdParamsSchema },
  responses: {
    200: {
      description: 'The batch summary and the stored changes',
      content: {
        'application/json': {
          schema: archiveSummarySchema.extend({ changes: z.record(z.unknown()) }),
        },
      },
    },
    400: {
      description: 'Malformed archive id',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'Missing, invalid or non-administration token',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'The administrator is not a super administrator',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'Unknown archive',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
