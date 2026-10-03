import { errorResponseSchema, openApiRegistry } from '../../lib/openapi/registry.js';
import {
  loginResponseSchema,
  loginSchema,
  phoneChangeRequestSchema,
  refreshResponseSchema,
  refreshSchema,
  registerRequestResponseSchema,
  registerRequestSchema,
  registerSchema,
  sessionResponseSchema,
} from './auth.schemas.js';

openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/register/request',
  tags: ['auth'],
  summary: 'Ask for a registration code',
  request: { body: { content: { 'application/json': { schema: registerRequestSchema } } } },
  responses: {
    202: {
      description: 'Code queued',
      content: { 'application/json': { schema: registerRequestResponseSchema } },
    },
    400: {
      description: 'Invalid or unsupported number',
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
      description: 'Invalid request or EMAIL_NOT_VERIFIED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    401: {
      description: 'INVALID_CREDENTIALS',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    403: {
      description: 'ACCOUNT_SUSPENDED',
      content: { 'application/json': { schema: errorResponseSchema } },
    },
    429: {
      description: 'LOGIN_LOCKED or code limits reached',
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
