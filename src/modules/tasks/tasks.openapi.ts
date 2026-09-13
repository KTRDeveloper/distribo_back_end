import { z } from 'zod';
import { openApiRegistry, errorResponseSchema } from '../../lib/openapi/registry.js';
import { taskSubmitSchema } from './tasks.schemas.js';

/**
 * Registers the tasks module's routes with the shared OpenAPI registry.
 * Imported once (as a side effect) from src/app.ts so its paths are
 * included in the generated document. Every route here requires
 * authentication (see src/modules/tasks/tasks.routes.ts).
 */

const taskResponseSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  priority: z.number().int(),
  progress: z.number(),
  submittedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

const taskIdParam = z.object({ id: z.string().openapi({ example: 'a1b2c3d4-...' }) });

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/tasks',
  tags: ['tasks'],
  summary: 'Submit a new task',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: taskSubmitSchema } } } },
  responses: {
    201: {
      description: 'Task submitted',
      content: { 'application/json': { schema: taskResponseSchema } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/tasks',
  tags: ['tasks'],
  summary: "List the signed-in user's tasks",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'List of tasks',
      content: { 'application/json': { schema: z.array(taskResponseSchema) } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/tasks/{id}',
  tags: ['tasks'],
  summary: 'Get a task by ID',
  security: [{ bearerAuth: [] }],
  request: { params: taskIdParam },
  responses: {
    200: {
      description: 'The task',
      content: { 'application/json': { schema: taskResponseSchema } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Task not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});
