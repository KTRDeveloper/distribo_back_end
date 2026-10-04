import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import {
  createOrganizationSchema,
  listOrganizationsQuerySchema,
  organizationIdParamsSchema,
} from './organization.schemas.js';

const roleSchema = z.enum(['OWNER', 'MANAGER', 'SELLER', 'DRIVER']);
const statusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']);

const organizationViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  email: z.string().nullable(),
  status: statusSchema,
  created_at: z.string().datetime(),
  role: roleSchema,
});

const errorContent = { 'application/json': { schema: errorResponseSchema } };

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations',
  tags: ['organization'],
  summary: 'Create an organization; the caller becomes its OWNER',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: createOrganizationSchema } } },
  },
  responses: {
    201: {
      description: 'The created organization with the caller role',
      content: { 'application/json': { schema: organizationViewSchema } },
    },
    400: { description: 'Invalid body', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    409: { description: 'Conflicting repeat of the gesture id', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations',
  tags: ['organization'],
  summary: 'List my organizations (ACTIVE collaborations), newest first',
  security: [{ bearerAuth: [] }],
  request: { query: listOrganizationsQuerySchema },
  responses: {
    200: {
      description: 'A page of organizations with my role in each',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                status: statusSchema,
                role: roleSchema,
              })
            ),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: { description: 'Invalid query', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/organizations/{organizationId}',
  tags: ['organization'],
  summary: 'Read one of my organizations with my role',
  security: [{ bearerAuth: [] }],
  request: { params: organizationIdParamsSchema },
  responses: {
    200: {
      description: 'The organization and my role',
      content: { 'application/json': { schema: organizationViewSchema } },
    },
    401: { description: 'Missing or invalid token', content: errorContent },
    404: { description: 'Not found or not a member', content: errorContent },
  },
});
