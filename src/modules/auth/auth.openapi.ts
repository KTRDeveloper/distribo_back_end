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
  refreshSchema,
  logoutSchema,
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
  accessToken: z.string(),
  refreshToken: z.string(),
  accessTokenExpiresIn: z.number().int().openapi({ description: 'Access token lifetime in seconds' }),
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
  path: '/api/v1/auth/register',
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
  path: '/api/v1/auth/register/verify',
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
  path: '/api/v1/auth/register/resend',
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
  path: '/api/v1/auth/login',
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
  path: '/api/v1/auth/password-reset/request',
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
  path: '/api/v1/auth/password-reset/confirm',
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
  path: '/api/v1/auth/email/verify/request',
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
  path: '/api/v1/auth/email/verify/confirm',
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

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/refresh',
  tags: ['auth'],
  summary: 'Exchange a valid refresh token for a new access/refresh token pair',
  request: { body: { content: { 'application/json': { schema: refreshSchema } } } },
  responses: {
    200: {
      description: 'New token pair issued; the submitted refresh token is now rotated',
      content: { 'application/json': { schema: authResponseSchema } },
    },
    401: {
      description: 'Refresh token missing, malformed, expired, or revoked',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout',
  tags: ['auth'],
  summary: 'Log out of the current device only',
  request: { body: { content: { 'application/json': { schema: logoutSchema } } } },
  responses: {
    204: { description: 'Session ended (or was already ended)' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout-all',
  tags: ['auth'],
  summary: 'Log out of every device for the authenticated account',
  security: [{ bearerAuth: [] }],
  responses: {
    204: { description: 'All sessions ended' },
    401: { description: 'Missing or invalid token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});
