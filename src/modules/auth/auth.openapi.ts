import { z } from 'zod';
import { openApiRegistry, errorResponseSchema } from '../../lib/openapi/registry.js';
import {
  registerSchema,
  registerVerifySchema,
  registerResendSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  emailVerifyRequestSchema,
  emailVerifyConfirmSchema,
} from './auth.schemas.js';

/**
 * Registers the auth module's routes with the shared OpenAPI registry.
 * Imported once (as a side effect) from src/app.ts so its paths are
 * included in the generated document.
 */

const messageResponseSchema = z.object({
  message: z.string().openapi({ example: 'Account created. Enter the verification code sent to your phone number.' }),
});

const authResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    phoneNumber: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    emailVerifiedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  }),
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/register',
  tags: ['auth'],
  summary: 'Register a new account (name + phone + password)',
  request: { body: { content: { 'application/json': { schema: registerSchema } } } },
  responses: {
    201: {
      description: 'Account created; an OTP was sent to the phone number to verify it',
      content: { 'application/json': { schema: messageResponseSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/register/verify',
  tags: ['auth'],
  summary: 'Verify the registration OTP and sign in',
  request: { body: { content: { 'application/json': { schema: registerVerifySchema } } } },
  responses: {
    200: {
      description: 'Phone number verified; account is now active and signed in',
      content: { 'application/json': { schema: authResponseSchema } },
    },
    400: { description: 'Invalid or expired code', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/register/resend',
  tags: ['auth'],
  summary: 'Resend the registration OTP for an unverified phone number',
  request: { body: { content: { 'application/json': { schema: registerResendSchema } } } },
  responses: {
    202: {
      description:
        'Generic response — a new code was sent only if the phone number belongs to an existing, unverified, unlocked account',
      content: { 'application/json': { schema: messageResponseSchema } },
    },
    423: { description: 'Account is locked', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Too many resend requests', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  summary: 'Login with phone number + password',
  request: { body: { content: { 'application/json': { schema: loginSchema } } } },
  responses: {
    200: {
      description: 'Login succeeded',
      content: { 'application/json': { schema: authResponseSchema } },
    },
    401: { description: 'Invalid credentials', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/password-reset/request',
  tags: ['auth'],
  summary: 'Request a password-reset OTP',
  request: { body: { content: { 'application/json': { schema: passwordResetRequestSchema } } } },
  responses: {
    202: {
      description: 'If the phone number is registered, a verification code has been sent',
      content: { 'application/json': { schema: messageResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/password-reset/confirm',
  tags: ['auth'],
  summary: 'Confirm a password reset with the OTP',
  request: { body: { content: { 'application/json': { schema: passwordResetConfirmSchema } } } },
  responses: {
    200: {
      description: 'Password reset successfully',
      content: { 'application/json': { schema: messageResponseSchema } },
    },
    400: { description: 'Invalid or expired code', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/email/verify/request',
  tags: ['auth'],
  summary: 'Request email verification for the signed-in account',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: emailVerifyRequestSchema } } } },
  responses: {
    202: {
      description: 'Verification code sent to the provided email address',
      content: { 'application/json': { schema: messageResponseSchema } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/email/verify/confirm',
  tags: ['auth'],
  summary: 'Confirm email verification for the signed-in account',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: emailVerifyConfirmSchema } } } },
  responses: {
    200: {
      description: 'Email verified successfully',
      content: { 'application/json': { schema: messageResponseSchema } },
    },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});
