import { z } from 'zod';
import { uuidV7Schema } from '../../shared/ids.js';
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
