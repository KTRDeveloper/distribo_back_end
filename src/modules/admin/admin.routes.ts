import { Router } from 'express';
import { adminAuthMiddleware, requireAdminRole } from '../../middleware/admin-auth.js';
import {
  adminLoginSchema,
  recoveryEmailConfirmSchema,
  recoveryEmailRequestSchema,
} from './admin.schemas.js';
import { adminLogin, confirmRecoveryEmail, requestRecoveryEmail } from './admin.service.js';

/** Administration routes, mounted under /api/v1/admin. */
export const adminRoutes = Router();

// POST /api/v1/admin/auth/login - public: password and authenticator code give a 15-minute token
adminRoutes.post('/auth/login', (req, res, next) => {
  adminLogin(adminLoginSchema.parse(req.body))
    .then((result) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        access_token: result.access_token,
        expires_in: result.expires_in,
        role: result.role,
      });
    })
    .catch(next);
});

// POST /api/v1/admin/recovery-email/request - admin token only: sends a code to the new address
adminRoutes.post(
  '/recovery-email/request',
  adminAuthMiddleware,
  requireAdminRole('MODERATOR'),
  (req, res, next) => {
    const body = recoveryEmailRequestSchema.parse(req.body);
    requestRecoveryEmail(req.admin!, body.email)
      .then(() => res.status(204).end())
      .catch(next);
  }
);

// POST /api/v1/admin/recovery-email/confirm - admin token only: a right code stores the address
adminRoutes.post(
  '/recovery-email/confirm',
  adminAuthMiddleware,
  requireAdminRole('MODERATOR'),
  (req, res, next) => {
    const body = recoveryEmailConfirmSchema.parse(req.body);
    confirmRecoveryEmail(req.admin!, body.email, body.code)
      .then(() => res.status(204).end())
      .catch(next);
  }
);
