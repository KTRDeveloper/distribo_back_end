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

const recoveryEmail = z.string().trim().toLowerCase().min(3).max(254).email();

/** Body of POST /admin/recovery-email/request: the address to verify; unknown fields are refused. */
export const recoveryEmailRequestSchema = z.object({ email: recoveryEmail }).strict();

/** Body of POST /admin/recovery-email/confirm: the same address and the 6-digit code received at it. */
export const recoveryEmailConfirmSchema = z
  .object({ email: recoveryEmail, code: z.string().regex(/^\d{6}$/) })
  .strict();

export type RecoveryEmailRequestInput = z.infer<typeof recoveryEmailRequestSchema>;
export type RecoveryEmailConfirmInput = z.infer<typeof recoveryEmailConfirmSchema>;
