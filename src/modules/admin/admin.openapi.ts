import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { recoveryEmailConfirmSchema, recoveryEmailRequestSchema } from './admin.schemas.js';

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
