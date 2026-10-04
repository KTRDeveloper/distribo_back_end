import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { z } from 'zod';
import {
  administratorIdParamsSchema,
  appointAdministratorSchema,
  recoveryEmailConfirmSchema,
  recoveryEmailRequestSchema,
  removeAdministratorSchema,
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
