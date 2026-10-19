import { z } from 'zod';

/** Body of the registration code request; the number is validated in the service (AUTH-009). */
export const registerRequestSchema = z.object({ phone_number: z.string().min(1).max(32) }).strict();

/** Body of a recycled-number claim; the number is validated in the service (AUTH-031). */
export const registerClaimSchema = z.object({ phone_number: z.string().min(1).max(32) }).strict();

export const registerClaimResponseSchema = z
  .object({ sent: z.literal(true), expires_in: z.number().int() })
  .strict();

export const registerRequestResponseSchema = z
  .object({
    sent: z.boolean(),
    expires_in: z.number().int(),
    existing_account: z.object({ masked_name: z.string() }).strict().nullable(),
  })
  .strict();

/** Device information sent at registration (mirrors AUTH-008 DeviceInfo). */
const deviceSchema = z
  .object({
    platform: z.enum(['ANDROID', 'IOS']),
    model: z.string().min(1).max(100).optional(),
    app_version: z.string().min(1).max(32),
    push_token: z.string().min(1).max(512).optional(),
    integrity_verdict: z.string().min(1).max(100).optional(),
  })
  .strict();

/** Body of POST /auth/register; unknown (server-owned) fields are rejected. */
export const registerSchema = z
  .object({
    phone_number: z.string().min(1).max(32),
    code: z.string().min(1).max(16),
    full_name: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(256),
    device: deviceSchema,
    new_holder: z.boolean().optional(),
    preferred_language: z.enum(['FR', 'EN']).optional(),
  })
  .strict();

export const sessionResponseSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number().int(),
    token_type: z.literal('Bearer'),
    person: z.object({ id: z.string().uuid(), full_name: z.string().nullable() }).strict(),
  })
  .strict();

/** Body of POST /auth/login; the number is normalized in the service. */
export const loginSchema = z
  .object({
    phone_number: z.string().min(1).max(32).optional(),
    email: z.string().min(3).max(254).optional(),
    password: z.string().min(1).max(256),
    use_email: z.boolean().optional(),
  })
  .strict()
  .refine((b) => (b.phone_number === undefined) !== (b.email === undefined), {
    message: 'Exactly one of phone_number and email',
  });

/** Body of POST /auth/login/verify; exactly one of `phone_number` and `email`. */
export const loginVerifySchema = z
  .object({
    phone_number: z.string().min(1).max(32).optional(),
    email: z.string().min(3).max(254).optional(),
    code: z.string().min(1).max(16),
    device: deviceSchema,
    use_email: z.boolean().optional(),
  })
  .strict()
  .refine((b) => (b.phone_number === undefined) !== (b.email === undefined), {
    message: 'Exactly one of phone_number and email',
  });

export const loginResponseSchema = z
  .object({
    sent: z.literal(true),
    channel: z.enum(['SMS', 'EMAIL']),
    expires_in: z.number().int(),
  })
  .strict();

/** Body of POST /auth/phone/change/request; the number is validated in the service. */
export const phoneChangeRequestSchema = z
  .object({ new_phone_number: z.string().min(1).max(32) })
  .strict();

/** Body of POST /auth/refresh. */
export const refreshSchema = z.object({ refresh_token: z.string().min(1).max(512) }).strict();

export const refreshResponseSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number().int(),
    token_type: z.literal('Bearer'),
  })
  .strict();

/** Body of POST /auth/password-reset/request; the number is validated in the service. */
export const passwordResetRequestSchema = z
  .object({ phone_number: z.string().min(1).max(32), use_email: z.boolean().optional() })
  .strict();

/** Body of POST /auth/email/verify/confirm. */
export const emailConfirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

/** Body of POST /auth/phone/change/confirm; the number is validated in the service. */
export const phoneChangeConfirmSchema = z
  .object({ new_phone_number: z.string().min(1).max(32), code: z.string().regex(/^\d{6}$/) })
  .strict();

/** Path parameter of DELETE /auth/devices/{id}. */
export const deviceIdParamSchema = z.object({ id: z.string().uuid() }).strict();

export const deviceListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      platform: z.string(),
      model: z.string().nullable(),
      app_version: z.string(),
      created_at: z.string(),
      last_synced_at: z.string().nullable(),
      current: z.boolean(),
    })
  ),
});

/** Body of POST /auth/password-reset/confirm; the number is validated in the service. */
export const passwordResetConfirmSchema = z
  .object({
    phone_number: z.string().min(1).max(32),
    code: z.string().regex(/^\d{6}$/),
    new_password: z.string().min(1).max(256),
    use_email: z.boolean().optional(),
  })
  .strict();

/** Body of POST /auth/password/change. */
export const passwordChangeSchema = z
  .object({
    current_password: z.string().min(1).max(256),
    new_password: z.string().min(1).max(256),
  })
  .strict();
