import { z } from 'zod';
import { openApiRegistry, errorResponseSchema } from '../../lib/openapi/registry.js';
import {
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
} from './notification.schemas.js';

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

const readErrors = {
  400: {
    description: 'Invalid id or body',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  401: {
    description: 'Missing or invalid token',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
};

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/notifications/{id}/read',
  tags: ['notification'],
  summary: "Mark one of the signed-in person's notifications as read",
  security: [{ bearerAuth: [] }],
  request: { params: notificationIdParamsSchema },
  responses: {
    204: { description: 'Marked read' },
    ...readErrors,
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/notifications/read-all',
  tags: ['notification'],
  summary: "Mark all of the signed-in person's notifications as read",
  security: [{ bearerAuth: [] }],
  responses: { 204: { description: 'All marked read' }, ...readErrors },
});
