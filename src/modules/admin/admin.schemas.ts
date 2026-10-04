import { z } from 'zod';

/** Body of POST /admin/auth/login: all three fields are required, unknown fields are refused. */
export const adminLoginSchema = z
  .object({
    phone_number: z.string().min(1).max(32),
    password: z.string().min(1).max(256),
    totp_code: z.string().min(1).max(16),
  })
  .strict();

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
