import { Router, type RequestHandler } from 'express';
import { adminAuthMiddleware, requireAdminRole } from '../../middleware/admin-auth.js';
import {
  adminLoginSchema,
  administratorIdParamsSchema,
  appointAdministratorSchema,
  listActionsQuerySchema,
  moderationReasonSchema,
  organizationIdParamsSchema,
  personIdParamsSchema,
  recoveryEmailConfirmSchema,
  recoveryEmailRequestSchema,
  restoreCompleteSchema,
  restoreStartSchema,
  removeAdministratorSchema,
  totpRecoveryConfirmSchema,
  totpRecoveryRequestSchema,
} from './admin.schemas.js';
import {
  adminLogin,
  appointAdministrator,
  confirmRecoveryEmail,
  confirmTotpRecovery,
  listAdminActions,
  reactivateOrganization,
  reactivatePerson,
  releasePhone,
  removeAdministrator,
  requestRecoveryEmail,
  requestTotpRecovery,
  completeAccessRestore,
  startAccessRestore,
  suspendOrganization,
  suspendPerson,
} from './admin.service.js';
import './admin.openapi.js';
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

// POST /api/v1/admin/auth/totp-recovery/request - public: password checked, then a code goes to the
// recovery email; the answer is 202 whether or not a code was sent
adminRoutes.post('/auth/totp-recovery/request', (req, res, next) => {
  requestTotpRecovery(totpRecoveryRequestSchema.parse(req.body))
    .then(() => res.status(202).end())
    .catch(next);
});

// POST /api/v1/admin/auth/totp-recovery/confirm - public: password and emailed code install a
// new authenticator key; the URI is shown once, so it is never cached, and no session is issued
adminRoutes.post('/auth/totp-recovery/confirm', (req, res, next) => {
  confirmTotpRecovery(totpRecoveryConfirmSchema.parse(req.body))
    .then((result) => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ otpauth_uri: result.otpauth_uri });
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

// POST /api/v1/admin/people/{personId}/suspend|reactivate and
// /api/v1/admin/organizations/{organizationId}/suspend|reactivate - moderators act without a
// report; each change is journaled (CM-33)
const moderatorOnly = [adminAuthMiddleware, requireAdminRole('MODERATOR')];

function personAction(action: typeof suspendPerson | typeof reactivatePerson): RequestHandler {
  return (req, res, next) => {
    const { personId } = personIdParamsSchema.parse(req.params);
    const body = moderationReasonSchema.parse(req.body);
    action(req.admin!, personId, body)
      .then(() => res.status(204).end())
      .catch(next);
  };
}

function organizationAction(
  action: typeof suspendOrganization | typeof reactivateOrganization
): RequestHandler {
  return (req, res, next) => {
    const { organizationId } = organizationIdParamsSchema.parse(req.params);
    const body = moderationReasonSchema.parse(req.body);
    action(req.admin!, organizationId, body)
      .then(() => res.status(204).end())
      .catch(next);
  };
}

adminRoutes.post('/people/:personId/suspend', ...moderatorOnly, personAction(suspendPerson));
adminRoutes.post('/people/:personId/reactivate', ...moderatorOnly, personAction(reactivatePerson));
adminRoutes.post(
  '/organizations/:organizationId/suspend',
  ...moderatorOnly,
  organizationAction(suspendOrganization)
);
adminRoutes.post(
  '/organizations/:organizationId/reactivate',
  ...moderatorOnly,
  organizationAction(reactivateOrganization)
);

// POST /api/v1/admin/people/{personId}/release-phone - SUPER_ADMIN only: frees the active number
// of a person who still holds it so its new holder can register (CM-41)
adminRoutes.post(
  '/people/:personId/release-phone',
  adminAuthMiddleware,
  requireAdminRole('SUPER_ADMIN'),
  (req, res, next) => {
    const { personId } = personIdParamsSchema.parse(req.params);
    const body = moderationReasonSchema.parse(req.body);
    releasePhone(req.admin!, personId, body)
      .then(() => res.status(204).end())
      .catch(next);
  }
);

// POST /api/v1/admin/people/{personId}/restore-access/start - SUPER_ADMIN only: sends the
// code to the verified email and the code to the new number (CM-40)
adminRoutes.post(
  '/people/:personId/restore-access/start',
  adminAuthMiddleware,
  requireAdminRole('SUPER_ADMIN'),
  (req, res, next) => {
    const { personId } = personIdParamsSchema.parse(req.params);
    const body = restoreStartSchema.parse(req.body);
    startAccessRestore(req.admin!, personId, body)
      .then(() => res.status(204).end())
      .catch(next);
  }
);

// POST /api/v1/admin/people/{personId}/restore-access/complete - SUPER_ADMIN only: the two codes
// move the account to the new number (CM-40)
adminRoutes.post(
  '/people/:personId/restore-access/complete',
  adminAuthMiddleware,
  requireAdminRole('SUPER_ADMIN'),
  (req, res, next) => {
    const { personId } = personIdParamsSchema.parse(req.params);
    const body = restoreCompleteSchema.parse(req.body);
    completeAccessRestore(req.admin!, personId, body)
      .then(() => res.status(204).end())
      .catch(next);
  }
);

// GET /api/v1/admin/actions - any live administrator reads the journal, newest first
adminRoutes.get(
  '/actions',
  adminAuthMiddleware,
  requireAdminRole('MODERATOR'),
  (req, res, next) => {
    const query = listActionsQuerySchema.parse(req.query);
    listAdminActions(query)
      .then((page) => res.status(200).json(page))
      .catch(next);
  }
);
