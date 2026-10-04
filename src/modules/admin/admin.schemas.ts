import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
import { paginationQuerySchema } from '../../shared/pagination.js';
import { normalizeE164 } from '../../shared/phone.js';

/** Body of POST /admin/auth/login: all three fields are required, unknown fields are refused. */
export const adminLoginSchema = z
  .object({
    phone_number: z.string().min(1).max(32),
    password: z.string().min(1).max(256),
    totp_code: z.string().min(1).max(16),
  })
  .strict();

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

/** Body of POST /admin/auth/totp-recovery/request: the account's phone and password; unknown fields are refused. */
export const totpRecoveryRequestSchema = z
  .object({
    phone_number: z.string().min(1).max(32),
    password: z.string().min(1).max(256),
  })
  .strict();

/** Body of POST /admin/auth/totp-recovery/confirm: the same two fields and the 6-digit code received by email. */
export const totpRecoveryConfirmSchema = z
  .object({
    phone_number: z.string().min(1).max(32),
    password: z.string().min(1).max(256),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

export type TotpRecoveryRequestInput = z.infer<typeof totpRecoveryRequestSchema>;
export type TotpRecoveryConfirmInput = z.infer<typeof totpRecoveryConfirmSchema>;

const recoveryEmail = z.string().trim().toLowerCase().min(3).max(254).email();

/** Body of POST /admin/recovery-email/request: the address to verify; unknown fields are refused. */
export const recoveryEmailRequestSchema = z.object({ email: recoveryEmail }).strict();

/** Body of POST /admin/recovery-email/confirm: the same address and the 6-digit code received at it. */
export const recoveryEmailConfirmSchema = z
  .object({ email: recoveryEmail, code: z.string().regex(/^\d{6}$/) })
  .strict();

export type RecoveryEmailRequestInput = z.infer<typeof recoveryEmailRequestSchema>;
export type RecoveryEmailConfirmInput = z.infer<typeof recoveryEmailConfirmSchema>;

/**
 * Body of POST /admin/administrators. `id` is the client-generated UUIDv7 of the new
 * administrator; the phone number is normalized to E.164 here, so the service only sees a valid
 * one. Only the two administrator roles are accepted; unknown fields are refused.
 */
export const appointAdministratorSchema = z
  .object({
    id: uuidV7Schema,
    phone_number: z
      .string()
      .min(1)
      .max(32)
      .transform((value, ctx) => {
        const e164 = normalizeE164(value);
        if (e164 === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid phone number' });
          return z.NEVER;
        }
        return e164;
      }),
    role: z.enum(['MODERATOR', 'SUPER_ADMIN']),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type AppointInput = z.infer<typeof appointAdministratorSchema>;

/** Path parameters of DELETE /admin/administrators/{administratorId}: the administrator row id. */
export const administratorIdParamsSchema = z.object({ administratorId: uuidV7Schema }).strict();

/** Body of DELETE /admin/administrators/{administratorId}: the reason kept in the journal. */
export const removeAdministratorSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export type RemoveInput = z.infer<typeof removeAdministratorSchema>;

/**
 * Body of POST /reports. `id` is the client-generated UUIDv7 of the report (also the idempotency
 * key). Exactly one target (C-28). Status, decision and resolver are never accepted: the server
 * sets them (v5.0.0-15.3.3); unknown fields are refused.
 */
export const createReportSchema = z
  .object({
    id: uuidV7Schema,
    target_person_id: uuidV7Schema.optional(),
    target_organization_id: uuidV7Schema.optional(),
    reason: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(2000),
  })
  .strict()
  .refine(
    (body) => (body.target_person_id === undefined) !== (body.target_organization_id === undefined),
    {
      message: 'Exactly one target is required',
      path: ['target_person_id'],
    }
  );

export type CreateReportInput = z.infer<typeof createReportSchema>;

/** Query of GET /admin/reports: the shared page parameters and an optional status; unknown ones are refused. */
export const listReportsQuerySchema = paginationQuerySchema
  .extend({ status: z.enum(['PENDING', 'RESOLVED']).optional() })
  .strict();

export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;

/** Path parameter of GET /admin/reports/{reportId}: the report id. */
export const reportIdParamsSchema = z.object({ reportId: uuidV7Schema }).strict();

/**
 * Body of POST /admin/reports/{reportId}/resolve: the moderator's decision and the reason kept
 * in the journal (1 to 2000 characters once trimmed). Status, resolver and time are set by the
 * server (v5.0.0-15.3.3); unknown fields are refused.
 */
export const resolveReportSchema = z
  .object({
    decision: z.enum(['DISMISSED', 'SUSPENSION']),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export type ResolveReportInput = z.infer<typeof resolveReportSchema>;

/** Path parameter of POST /admin/people/{personId}/suspend and /reactivate: the person id. */
export const personIdParamsSchema = z.object({ personId: uuidV7Schema }).strict();

/** Path parameter of POST /admin/organizations/{organizationId}/suspend and /reactivate. */
export const organizationIdParamsSchema = z.object({ organizationId: uuidV7Schema }).strict();

/**
 * Body of the direct suspend and reactivate routes: only the reason kept in the journal (1 to
 * 2000 characters once trimmed); unknown fields are refused (v5.0.0-15.3.3).
 */
export const moderationReasonSchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();

export type ModerationReasonInput = z.infer<typeof moderationReasonSchema>;

/**
 * Query of GET /admin/actions: the shared page parameters and four optional filters; unknown
 * parameters are refused. `action` lists the journal's action kinds.
 */
export const listActionsQuerySchema = paginationQuerySchema
  .extend({
    action: z
      .enum([
        'SUSPEND',
        'REACTIVATE',
        'DISMISS_REPORT',
        'APPOINT_ADMIN',
        'REMOVE_ADMIN',
        'REPLAY_SYNC',
        'RECOVER_2FA',
      ])
      .optional(),
    administrator_id: uuidV7Schema.optional(),
    target_person_id: uuidV7Schema.optional(),
    target_organization_id: uuidV7Schema.optional(),
  })
  .strict();

export type ListActionsQuery = z.infer<typeof listActionsQuerySchema>;
