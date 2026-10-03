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
