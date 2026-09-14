import { z } from 'zod';

/**
 * Zod schemas for authentication module
 */

const phoneNumberSchema = z
  .string()
  .regex(/^\+?[1-9]\d{6,14}$/, 'Phone number must be a valid E.164-style number');

const otpCodeSchema = z.string().regex(/^\d{6}$/, 'Code must be a 6-digit number');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

// Registration only collects name + phone + password. Email and other
// profile details are added later (via email verification, or a future
// profile-update flow), not required up front.
export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phoneNumber: phoneNumberSchema,
  password: passwordSchema,
});

export const registerVerifySchema = z.object({
  phoneNumber: phoneNumberSchema,
  code: otpCodeSchema,
});

export const registerResendSchema = z.object({
  phoneNumber: phoneNumberSchema,
});

// Login is phone number + password only — no OTP.
export const loginSchema = z.object({
  phoneNumber: phoneNumberSchema,
  password: z.string().min(1, 'Password is required'),
});

export const passwordResetRequestSchema = z.object({
  phoneNumber: phoneNumberSchema,
});

export const passwordResetConfirmSchema = z.object({
  phoneNumber: phoneNumberSchema,
  code: otpCodeSchema,
  newPassword: passwordSchema,
});

export const emailVerifyRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const emailVerifyConfirmSchema = z.object({
  code: otpCodeSchema,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type RegisterVerifyInput = z.infer<typeof registerVerifySchema>;
export type RegisterResendInput = z.infer<typeof registerResendSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
export type EmailVerifyRequestInput = z.infer<typeof emailVerifyRequestSchema>;
export type EmailVerifyConfirmInput = z.infer<typeof emailVerifyConfirmSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
