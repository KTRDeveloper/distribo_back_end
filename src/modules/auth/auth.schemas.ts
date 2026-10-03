import { z } from 'zod';

/** Body of the registration code request; the number is validated in the service (AUTH-009). */
export const registerRequestSchema = z.object({ phone_number: z.string().min(1).max(32) }).strict();

export const registerRequestResponseSchema = z
  .object({
    sent: z.literal(true),
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
