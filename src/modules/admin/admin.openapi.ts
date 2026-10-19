import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import { z } from 'zod';
import {
  administratorIdParamsSchema,
  appointAdministratorSchema,
  createReportSchema,
  listActionsQuerySchema,
  listReportsQuerySchema,
  moderationReasonSchema,
  restoreStartSchema,
  organizationIdParamsSchema,
  personIdParamsSchema,
  recoveryEmailConfirmSchema,
  recoveryEmailRequestSchema,
  removeAdministratorSchema,
  reportIdParamsSchema,
  resolveReportSchema,
  totpRecoveryConfirmSchema,
  totpRecoveryRequestSchema,
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
  path: '/api/v1/admin/auth/totp-recovery/request',
  tags: ['admin'],
  summary: 'Send a recovery code to the administrator recovery email (public, password checked)',
  request: { body: { content: { 'application/json': { schema: totpRecoveryRequestSchema } } } },
  responses: {
    202: { description: 'Accepted whether or not a code was sent' },
    400: err('VALIDATION_ERROR'),
    401: err('INVALID_CREDENTIALS'),
    429: err('LOGIN_LOCKED or OTP_RATE_LIMITED'),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/admin/auth/totp-recovery/confirm',
  tags: ['admin'],
  summary: 'Install a new authenticator key with the recovery code (public, no session issued)',
  request: { body: { content: { 'application/json': { schema: totpRecoveryConfirmSchema } } } },
  responses: {
    200: {
      description: 'New key installed; the otpauth_uri is shown only in this response',
      content: { 'application/json': { schema: z.object({ otpauth_uri: z.string() }) } },
    },
    400: err('VALIDATION_ERROR or OTP_INVALID'),
    401: err('INVALID_CREDENTIALS'),
    429: err('LOGIN_LOCKED or OTP_LOCKED'),
  },
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

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/admin/reports/{reportId}/resolve',
  tags: ['admin'],
  summary: 'Dismiss a report or suspend its target (admin token only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: reportIdParamsSchema,
    body: { content: { 'application/json': { schema: resolveReportSchema } } },
  },
  responses: {
    200: {
      description: 'The resolved report',
      content: { 'application/json': { schema: adminReportSchema } },
    },
    400: err('VALIDATION_ERROR'),
    401: err('UNAUTHORIZED'),
    404: err('NOT_FOUND'),
    409: err('ALREADY_RESOLVED or TARGET_ANONYMIZED'),
  },
});

const moderationRoutes = [
  [
    '/api/v1/admin/people/{personId}/suspend',
    'Suspend a person without a report',
    'person',
    'suspend',
  ],
  [
    '/api/v1/admin/people/{personId}/reactivate',
    'Reactivate a suspended person',
    'person',
    'reactivate',
  ],
  [
    '/api/v1/admin/organizations/{organizationId}/suspend',
    'Suspend an organization without a report',
    'organization',
    'suspend',
  ],
  [
    '/api/v1/admin/organizations/{organizationId}/reactivate',
    'Reactivate a suspended organization',
    'organization',
    'reactivate',
  ],
] as const;

for (const [path, summary, kind, verb] of moderationRoutes) {
  openApiRegistry.registerPath({
    method: 'post',
    path,
    tags: ['admin'],
    summary: `${summary} (moderator token only)`,
    security: [{ bearerAuth: [] }],
    request: {
      params: kind === 'person' ? personIdParamsSchema : organizationIdParamsSchema,
      body: { content: { 'application/json': { schema: moderationReasonSchema } } },
    },
    responses: {
      204: {
        description: verb === 'suspend' ? 'Suspended and journaled' : 'Reactivated and journaled',
      },
      400: err('VALIDATION_ERROR'),
      401: err('UNAUTHORIZED'),
      403: err('FORBIDDEN'),
      404: err('NOT_FOUND'),
      409: err('INVALID_STATE, or TARGET_ANONYMIZED for a person'),
    },
  });
}

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/admin/people/{personId}/release-phone',
  tags: ['admin'],
  summary: 'Release the active number of a person (super administrator token only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: personIdParamsSchema,
    body: { content: { 'application/json': { schema: moderationReasonSchema } } },
  },
  responses: {
    204: { description: 'Number released, journaled and notified' },
    400: err('VALIDATION_ERROR'),
    401: err('UNAUTHORIZED'),
    403: err('FORBIDDEN'),
    404: err('NOT_FOUND'),
    409: err('TARGET_ANONYMIZED or NO_ACTIVE_NUMBER'),
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/admin/people/{personId}/restore-access/start',
  tags: ['admin'],
  summary:
    'Send a code to the verified email of a person and a code to their new number (super administrator token only)',
  security: [{ bearerAuth: [] }],
  request: {
    params: personIdParamsSchema,
    body: { content: { 'application/json': { schema: restoreStartSchema } } },
  },
  responses: {
    204: { description: 'Both codes sent; no code in the answer' },
    400: err('VALIDATION_ERROR or SAME_NUMBER'),
    401: err('UNAUTHORIZED'),
    403: err('FORBIDDEN'),
    404: err('NOT_FOUND'),
    409: err('TARGET_ANONYMIZED, INVALID_STATE, NO_VERIFIED_EMAIL or PHONE_TAKEN'),
    429: err('OTP_RATE_LIMITED'),
  },
});

const adminActionSchema = z.object({
  id: z.string(),
  administrator_id: z.string(),
  action: z.enum([
    'SUSPEND',
    'REACTIVATE',
    'DISMISS_REPORT',
    'APPOINT_ADMIN',
    'REMOVE_ADMIN',
    'REPLAY_SYNC',
    'RECOVER_2FA',
    'GIFT_DAYS',
    'RECORD_PAYMENT',
    'REFUND_PAYMENT',
    'RELEASE_PHONE',
    'RESTORE_ACCESS',
  ]),
  target_person_id: z.string().nullable(),
  target_organization_id: z.string().nullable(),
  report_id: z.string().nullable(),
  sync_archive_id: z.string().nullable(),
  reason: z.string(),
  occurred_at: z.string(),
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/admin/actions',
  tags: ['admin'],
  summary: 'List the administration action journal, newest first (admin token only)',
  security: [{ bearerAuth: [] }],
  request: { query: listActionsQuerySchema },
  responses: {
    200: {
      description: 'One page of journal rows',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(adminActionSchema),
            next_cursor: z.string().nullable(),
          }),
        },
      },
    },
    400: err('VALIDATION_ERROR'),
    401: err('UNAUTHORIZED'),
  },
});
