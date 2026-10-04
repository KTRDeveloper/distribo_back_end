import { z } from 'zod';
import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import {
  changeRoleSchema,
  collaborationIdParamsSchema,
  collaboratorParamsSchema,
  createOrganizationSchema,
  inviteCollaboratorSchema,
  listInvitationsQuerySchema,
  listOrganizationsQuerySchema,
  organizationIdParamsSchema,
  organizationScopeParamsSchema,
  setPublicContactSchema,
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
    400: { description: 'Malformed id', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    404: { description: 'Not found or not a member', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/organizations/{organizationId}/collaborators',
  tags: ['organization'],
  summary: 'The owner invites a person by phone number with a role',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationIdParamsSchema,
    body: { content: { 'application/json': { schema: inviteCollaboratorSchema } } },
  },
  responses: {
    201: {
      description: 'The INVITED collaboration',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string().uuid(),
            person: z.object({
              public_name: z.string().nullable(),
              phone_number: z.string().nullable(),
              registered: z.boolean(),
            }),
            role: z.enum(['MANAGER', 'SELLER', 'DRIVER']),
            status: z.literal('INVITED'),
            invited_at: z.string().datetime(),
          }),
        },
      },
    },
    400: { description: 'Malformed id or invalid body', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Caller is not the owner', content: errorContent },
    404: { description: 'Not found or not a member', content: errorContent },
    409: {
      description: 'ALREADY_MEMBER, ORGANIZATION_NOT_ACTIVE or conflicting gesture id',
      content: errorContent,
    },
    429: { description: 'Too many person lookups', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/organizations/{organizationId}/collaborators/{collaborationId}',
  tags: ['organization'],
  summary: "The owner changes a collaborator's role",
  security: [{ bearerAuth: [] }],
  request: {
    params: collaboratorParamsSchema,
    body: { content: { 'application/json': { schema: changeRoleSchema } } },
  },
  responses: {
    200: {
      description: 'The collaboration with its new role',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string().uuid(),
            person: z.object({
              public_name: z.string().nullable(),
              phone_number: z.string().nullable(),
              registered: z.boolean(),
            }),
            role: z.enum(['MANAGER', 'SELLER', 'DRIVER']),
            status: z.enum(['INVITED', 'ACTIVE']),
            invited_at: z.string().datetime(),
          }),
        },
      },
    },
    400: { description: 'Malformed id or invalid body', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Caller is not the owner', content: errorContent },
    404: { description: 'Not found, REVOKED or not a member', content: errorContent },
    409: { description: 'OWNER_PROTECTED', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/organizations/{organizationId}/collaborators/me',
  tags: ['organization'],
  summary: 'Choose whether my number is published as a contact of the organization',
  security: [{ bearerAuth: [] }],
  request: {
    params: organizationScopeParamsSchema,
    body: { content: { 'application/json': { schema: setPublicContactSchema } } },
  },
  responses: {
    200: {
      description: 'The stored flag',
      content: { 'application/json': { schema: z.object({ is_public_contact: z.boolean() }) } },
    },
    400: { description: 'Malformed id or invalid body', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    404: { description: 'Not an ACTIVE member', content: errorContent },
    409: { description: 'NO_ACTIVE_NUMBER', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/organizations/{organizationId}/collaborators/{collaborationId}',
  tags: ['organization'],
  summary: 'The owner revokes a collaborator',
  security: [{ bearerAuth: [] }],
  request: { params: collaboratorParamsSchema },
  responses: {
    204: { description: 'Revoked; no body' },
    400: { description: 'Malformed id', content: errorContent },
    401: { description: 'Missing or invalid token', content: errorContent },
    403: { description: 'Caller is not the owner', content: errorContent },
    404: { description: 'Not found, already REVOKED or not a member', content: errorContent },
    409: { description: 'OWNER_PROTECTED', content: errorContent },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/collaborations',
  tags: ['organization'],
  summary: 'List my pending team invitations',
  security: [{ bearerAuth: [] }],
  request: { query: listInvitationsQuerySchema },
  responses: {
    200: {
      description: 'A page of my INVITED collaborations with the organization name',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                organization_id: z.string().uuid(),
                organization_name: z.string(),
                role: roleSchema,
                invited_at: z.string().datetime(),
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

for (const action of ['accept', 'decline'] as const) {
  openApiRegistry.registerPath({
    method: 'post',
    path: `/api/v1/collaborations/{id}/${action}`,
    tags: ['organization'],
    summary: action === 'accept' ? 'Accept one of my invitations' : 'Decline one of my invitations',
    security: [{ bearerAuth: [] }],
    request: { params: collaborationIdParamsSchema },
    responses: {
      204: { description: 'Done; no body' },
      400: { description: 'Malformed id', content: errorContent },
      401: { description: 'Missing or invalid token', content: errorContent },
      404: {
        description: 'Unknown, not mine or no longer INVITED',
        content: errorContent,
      },
    },
  });
}
