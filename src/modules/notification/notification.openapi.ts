import { z } from 'zod';
import { openApiRegistry, errorResponseSchema } from '../../lib/openapi/registry.js';
import { listNotificationsQuerySchema } from './notification.schemas.js';

const notificationViewSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().nullable(),
  content: z.string(),
  source_event: z.string(),
  related_entity_type: z.string().nullable(),
  related_entity_id: z.string().uuid().nullable(),
  read_status: z.enum(['UNREAD', 'READ']),
  created_at: z.string().datetime(),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/notifications',
  tags: ['notification'],
  summary: "List the signed-in person's notifications, newest first",
  security: [{ bearerAuth: [] }],
  request: { query: listNotificationsQuerySchema },
  responses: {
    200: {
      description: 'A page of notifications',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(notificationViewSchema),
            next_cursor: z.string().nullable(),
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
  },
});
