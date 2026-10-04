import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { z } from 'zod';
import {
  administratorIdParamsSchema,
  appointAdministratorSchema,
  createReportSchema,
  listReportsQuerySchema,
  recoveryEmailConfirmSchema,
  recoveryEmailRequestSchema,
  removeAdministratorSchema,
  reportIdParamsSchema,
} from './admin.schemas.js';

const appointedResponseSchema = z.object({
  id: z.string(),
  person_public: z.object({
    public_name: z.string().nullable(),
    phone_number: z.string().nullable(),
    registered: z.boolean(),
  }),
  role: z.enum(['MODERATOR', 'SUPER_ADMIN']),
  otpauth_uri: z.string(),
});

const err = (description: string) => ({
  description,
  content: { 'application/json': { schema: errorResponseSchema } },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/admin/recovery-email/request',
  tags: ['admin'],
  summary: 'Send a code to a candidate recovery email (admin token only)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: recoveryEmailRequestSchema } } } },
  responses: {
    204: { description: 'Code queued; nothing saved yet' },
    400: err('VALIDATION_ERROR, including the person own email'),
    401: err('UNAUTHORIZED'),
    429: err('OTP_RATE_LIMITED'),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/admin/recovery-email/confirm',
  tags: ['admin'],
  summary: 'Save the recovery email after the code received at it (admin token only)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: recoveryEmailConfirmSchema } } } },
  responses: {
    204: { description: 'Recovery email saved' },
    400: err('VALIDATION_ERROR or OTP_INVALID'),
    401: err('UNAUTHORIZED'),
    429: err('OTP_LOCKED'),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/admin/administrators',
  tags: ['admin'],
  summary: 'Appoint a registered person as administrator (super administrator only)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: appointAdministratorSchema } } } },
  responses: {
    201: {
      description: 'Appointed; the otpauth_uri is shown only in this response',
      content: { 'application/json': { schema: appointedResponseSchema } },
    },
    400: err('VALIDATION_ERROR'),
    401: err('UNAUTHORIZED'),
    403: err('FORBIDDEN'),
    404: err('NOT_FOUND: a guest or unknown number'),
    409: err('ALREADY_ADMINISTRATOR'),
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/admin/administrators/{administratorId}',
  tags: ['admin'],
  summary: 'Remove an administrator, keeping the row for the journal (super administrator only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: administratorIdParamsSchema,
    body: { content: { 'application/json': { schema: removeAdministratorSchema } } },
  },
  responses: {
    204: { description: 'Removed; the administrator token stops working at once' },
    400: err('VALIDATION_ERROR'),
    401: err('UNAUTHORIZED'),
    403: err('FORBIDDEN'),
    404: err('NOT_FOUND: unknown or already removed'),
    409: err('LAST_SUPER_ADMIN'),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/reports',
  tags: ['admin'],
  summary: 'Report a person or an organization (any signed-in person)',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: createReportSchema } } } },
  responses: {
    201: {
      description: 'Report filed as PENDING; a repeat of the same id returns this answer again',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            status: z.literal('PENDING'),
            reported_at: z.string(),
          }),
        },
      },
    },
    400: err('VALIDATION_ERROR, including reporting oneself or one own organization'),
    401: err('UNAUTHORIZED'),
    404: err('NOT_FOUND: unknown target'),
    429: err('RATE_LIMITED: 10 reports per person per day'),
  },
});

const publicPersonSchema = z.object({
  public_name: z.string().nullable(),
  phone_number: z.string().nullable(),
  registered: z.boolean(),
});

const adminReportSchema = z.object({
  id: z.string(),
  reporter: publicPersonSchema,
  target_person: publicPersonSchema.nullable(),
  target_organization: z
    .object({ id: z.string(), name: z.string(), status: z.string() })
    .nullable(),
  reason: z.string(),
  description: z.string(),
  status: z.enum(['PENDING', 'RESOLVED']),
  decision: z.enum(['DISMISSED', 'SUSPENSION']).nullable(),
  resolved_by_id: z.string().nullable(),
  reported_at: z.string(),
  resolved_at: z.string().nullable(),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/admin/reports',
  tags: ['admin'],
  summary: 'List reports: PENDING oldest first, otherwise newest first (admin token only)',
  security: [{ bearerAuth: [] }],
  request: { query: listReportsQuerySchema },
  responses: {
    200: {
      description: 'One page of reports',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(adminReportSchema),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: err('VALIDATION_ERROR'),
    401: err('UNAUTHORIZED'),
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/admin/reports/{reportId}',
  tags: ['admin'],
  summary: 'Open one report with its reporter and target (admin token only)',
  security: [{ bearerAuth: [] }],
  request: { params: reportIdParamsSchema },
  responses: {
    200: {
      description: 'The report',
      content: { 'application/json': { schema: adminReportSchema } },
    },
    400: err('VALIDATION_ERROR'),
    401: err('UNAUTHORIZED'),
    404: err('NOT_FOUND'),
  },
});
