import { Router } from 'express';
import { adminAuthMiddleware, requireAdminRole } from '../../middleware/admin-auth.js';
import {
  adminLoginSchema,
  administratorIdParamsSchema,
  appointAdministratorSchema,
  recoveryEmailConfirmSchema,
  recoveryEmailRequestSchema,
  removeAdministratorSchema,
} from './admin.schemas.js';
import {
  adminLogin,
  appointAdministrator,
  confirmRecoveryEmail,
  removeAdministrator,
  requestRecoveryEmail,
} from './admin.service.js';
import { adminReportRoutes } from './report.routes.js';

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

// POST /api/v1/admin/administrators - SUPER_ADMIN only: appoints a registered person; the
// response is the only place the authenticator URI is ever shown, so it is never cached
adminRoutes.post(
  '/administrators',
  adminAuthMiddleware,
  requireAdminRole('SUPER_ADMIN'),
  (req, res, next) => {
    const body = appointAdministratorSchema.parse(req.body);
    appointAdministrator(req.admin!, body)
      .then((view) => {
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json({
          id: view.id,
          person_public: view.person_public,
          role: view.role,
          otpauth_uri: view.otpauth_uri,
        });
      })
      .catch(next);
  }
);

// DELETE /api/v1/admin/administrators/{administratorId} - SUPER_ADMIN only: removes an
// administrator; the row stays for the journal and the token stops working at once
adminRoutes.delete(
  '/administrators/:administratorId',
  adminAuthMiddleware,
  requireAdminRole('SUPER_ADMIN'),
  (req, res, next) => {
    const { administratorId } = administratorIdParamsSchema.parse(req.params);
    const body = removeAdministratorSchema.parse(req.body);
    removeAdministrator(req.admin!, administratorId, body)
      .then(() => res.status(204).end())
      .catch(next);
  }
);

// /api/v1/admin/reports - moderators list and open reports (see report.routes.ts)
adminRoutes.use('/reports', adminReportRoutes);
