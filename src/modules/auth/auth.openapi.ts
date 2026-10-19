import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import {
  deviceIdParamSchema,
  deviceListResponseSchema,
  emailConfirmSchema,
  loginResponseSchema,
  loginSchema,
  loginVerifySchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  phoneChangeConfirmSchema,
  phoneChangeRequestSchema,
  refreshResponseSchema,
  refreshSchema,
  registerClaimResponseSchema,
  registerClaimSchema,
  registerRequestResponseSchema,
  registerRequestSchema,
  registerSchema,
  sessionResponseSchema,
} from './auth.schemas.js';

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/register/request',
  tags: ['auth'],
  summary: 'Ask for a registration code (none is sent to a registered number)',
  request: { body: { content: { 'application/json': { schema: registerRequestSchema } } } },
  responses: {
    202: {
      description:
        'Code queued (sent true), or none for a registered number (sent false, masked name)',
      content: { 'application/json': { schema: registerRequestResponseSchema } },
    },
    400: {
      description: 'Invalid or unsupported number',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'Number check or code limits reached (RATE_LIMITED, OTP_RATE_LIMITED)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/register/claim',
  tags: ['auth'],
  summary: 'Ask for a registration code for a number that belonged to someone else',
  request: { body: { content: { 'application/json': { schema: registerClaimSchema } } } },
  responses: {
    202: {
      description: 'Code queued',
      content: { 'application/json': { schema: registerClaimResponseSchema } },
    },
    400: {
      description: 'Invalid or unsupported number',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description:
        'NUMBER_NOT_AVAILABLE: the holder is active or suspended (one body for both reasons)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'Number check or code limits reached (RATE_LIMITED, OTP_RATE_LIMITED)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/register',
  tags: ['auth'],
  summary: 'Register with the code',
  request: { body: { content: { 'application/json': { schema: registerSchema } } } },
  responses: {
    201: {
      description: 'Registered and signed in',
      content: { 'application/json': { schema: sessionResponseSchema } },
    },
    400: {
      description: 'Invalid request, code or password',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'ACCOUNT_EXISTS',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/login',
  tags: ['auth'],
  summary: 'Sign in with number and password; a code is sent',
  request: { body: { content: { 'application/json': { schema: loginSchema } } } },
  responses: {
    202: {
      description: 'Login code queued',
      content: { 'application/json': { schema: loginResponseSchema } },
    },
    400: {
      description:
        'Invalid request (VALIDATION_ERROR, including the removed email and use_email fields)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'INVALID_CREDENTIALS (wrong password)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'ACCOUNT_SUSPENDED (right password on a suspended account)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    404: {
      description: 'ACCOUNT_NOT_FOUND (unknown, guest or released number)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'LOGIN_LOCKED, RATE_LIMITED (number checks) or code limits reached',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/refresh',
  tags: ['auth'],
  summary: 'Refresh a session; the refresh token is replaced',
  request: { body: { content: { 'application/json': { schema: refreshSchema } } } },
  responses: {
    200: {
      description: 'New token pair',
      content: { 'application/json': { schema: refreshResponseSchema } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'INVALID_REFRESH_TOKEN or SESSION_REVOKED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/email/verify/request',
  tags: ['auth'],
  summary: 'Ask for an email verification code',
  security: [{ bearerAuth: [] }],
  responses: {
    202: { description: 'Code queued' },
    204: { description: 'Email already verified' },
    400: {
      description: 'EMAIL_MISSING',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'UNAUTHORIZED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'Code limits reached',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/email/verify/confirm',
  tags: ['auth'],
  summary: 'Confirm the email verification code',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': { schema: emailConfirmSchema },
      },
    },
  },
  responses: {
    204: { description: 'Email verified' },
    400: {
      description: 'OTP_INVALID, OTP_EXPIRED or VALIDATION_ERROR',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'UNAUTHORIZED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'EMAIL_TAKEN',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/phone/change/request',
  tags: ['auth'],
  summary: 'Ask for a code to move the account to a new phone number',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: phoneChangeRequestSchema } } } },
  responses: {
    202: { description: 'Code queued to the new number' },
    400: {
      description: 'VALIDATION_ERROR, UNSUPPORTED_NUMBER or SAME_NUMBER',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'UNAUTHORIZED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'PHONE_TAKEN',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'Code limits reached',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/phone/change/confirm',
  tags: ['auth'],
  summary: 'Move the account to the new phone number with the code',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: phoneChangeConfirmSchema } } } },
  responses: {
    204: { description: 'Number changed' },
    400: {
      description: 'OTP_INVALID, OTP_EXPIRED or VALIDATION_ERROR',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'UNAUTHORIZED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    409: {
      description: 'PHONE_TAKEN',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/login/verify',
  tags: ['auth'],
  summary: 'Complete sign-in with the code',
  request: { body: { content: { 'application/json': { schema: loginVerifySchema } } } },
  responses: {
    200: {
      description: 'Session opened',
      content: { 'application/json': { schema: sessionResponseSchema } },
    },
    400: {
      description: 'VALIDATION_ERROR, OTP_INVALID or OTP_EXPIRED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'ACCOUNT_SUSPENDED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'OTP_LOCKED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout',
  tags: ['auth'],
  summary: 'Sign out of this phone',
  security: [{ bearerAuth: [] }],
  responses: {
    204: { description: 'Device session ended' },
    401: {
      description: 'UNAUTHORIZED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/password-reset/request',
  tags: ['auth'],
  summary: 'Ask for a password reset code (sent by SMS only)',
  request: { body: { content: { 'application/json': { schema: passwordResetRequestSchema } } } },
  responses: {
    202: {
      description: 'Same answer for every number',
      content: { 'application/json': { schema: registerRequestResponseSchema } },
    },
    400: {
      description: 'Invalid request',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'Number check or code limits reached (RATE_LIMITED, OTP_RATE_LIMITED)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/password-reset/confirm',
  tags: ['auth'],
  summary: 'Choose a new password with the code and sign in on this phone',
  request: { body: { content: { 'application/json': { schema: passwordResetConfirmSchema } } } },
  responses: {
    200: {
      description: 'Password changed, every other device signed out, this phone signed in',
      content: { 'application/json': { schema: sessionResponseSchema } },
    },
    400: {
      description: 'VALIDATION_ERROR, WEAK_PASSWORD, OTP_INVALID, OTP_EXPIRED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'ACCOUNT_SUSPENDED (only after the right code)',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'OTP_LOCKED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

const unauthorized = {
  description: 'UNAUTHORIZED',
  content: { 'application/json': { schema: errorResponseSchema } },
};

openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/auth/devices',
  tags: ['auth'],
  summary: 'List my signed-in phones',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Live devices',
      content: { 'application/json': { schema: deviceListResponseSchema } },
    },
    401: unauthorized,
  },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/auth/devices/{id}',
  tags: ['auth'],
  summary: 'Sign one of my phones out',
  security: [{ bearerAuth: [] }],
  request: { params: deviceIdParamSchema },
  responses: {
    204: { description: 'Device removed' },
    400: {
      description: 'VALIDATION_ERROR',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: unauthorized,
    404: {
      description: 'NOT_FOUND',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout-all',
  tags: ['auth'],
  summary: 'Sign out of every phone',
  security: [{ bearerAuth: [] }],
  responses: { 204: { description: 'All sessions ended' }, 401: unauthorized },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/password/change',
  tags: ['auth'],
  summary: 'Change my password',
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: passwordChangeSchema } } } },
  responses: {
    204: { description: 'Password changed, other phones signed out' },
    400: {
      description: 'VALIDATION_ERROR, WEAK_PASSWORD',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: unauthorized,
    429: {
      description: 'LOGIN_LOCKED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
  },
});
