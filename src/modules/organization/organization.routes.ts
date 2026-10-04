import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import {
  changeRoleSchema,
  closeOrganizationSchema,
  collaborationIdParamsSchema,
  collaboratorParamsSchema,
  createOrganizationSchema,
  inviteCollaboratorSchema,
  listInvitationsQuerySchema,
  listOrganizationsQuerySchema,
  lookupOrganizationsQuerySchema,
  setPublicContactSchema,
  startSubscriptionSchema,
  transferOwnershipSchema,
} from './organization.schemas.js';
import {
  acceptInvitation,
  changeRole,
  closeOrganization,
  reopenOrganization,
  createOrganization,
  declineInvitation,
  getOrganizationDetails,
  endSubscription,
  getSubscription,
  inviteCollaborator,
  listMyInvitations,
  listMyOrganizations,
  lookupOrganizations,
  revokeCollaborator,
  setPublicContact,
  startSubscription,
  transferOwnership,
} from './organization.service.js';
import './organization.openapi.js';

/** Organization routes; all require authentication. */
export const organizationRoutes = Router();

organizationRoutes.use(authMiddleware);

// POST /api/v1/organizations - a registered person creates an organization and becomes OWNER
organizationRoutes.post(
  '/',
  // Strict validation first, so an invalid body never reserves the idempotency key.
  (req, _res, next) => {
    const parsed = createOrganizationSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    createOrganization(req.user!.id, createOrganizationSchema.parse(req.body))
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// GET /api/v1/organizations - my ACTIVE collaborations, newest first
organizationRoutes.get('/', (req, res, next) => {
  Promise.resolve()
    .then(() => listMyOrganizations(req.user!.id, listOrganizationsQuerySchema.parse(req.query)))
    .then((page) => res.json(page))
    .catch(next);
});

// GET /api/v1/organizations/lookup?phone= - find businesses by a public number; declared before
// `/:organizationId` so `lookup` is never read as an id
organizationRoutes.get('/lookup', (req, res, next) => {
  Promise.resolve()
    .then(() =>
      lookupOrganizations(req.user!.id, lookupOrganizationsQuerySchema.parse(req.query).phone)
    )
    .then((result) => res.json(result))
    .catch(next);
});

// GET /api/v1/organizations/:organizationId - details for a member; 404 for everyone else
organizationRoutes.get('/:organizationId', loadActor, (req, res, next) => {
  getOrganizationDetails(req.actor!)
    .then((view) => res.json(view))
    .catch(next);
});

// POST /api/v1/organizations/:organizationId/collaborators - the owner invites a person by number
organizationRoutes.post(
  '/:organizationId/collaborators',
  loadActor,
  requireAbility('manage', 'Collaboration'),
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = inviteCollaboratorSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    inviteCollaborator(req.actor!, inviteCollaboratorSchema.parse(req.body))
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// PATCH /api/v1/organizations/:organizationId/collaborators/me - any ACTIVE member sets their own
// public-contact flag; declared before `/:collaborationId` so `me` is never read as an id
organizationRoutes.patch('/:organizationId/collaborators/me', loadActor, (req, res, next) => {
  Promise.resolve()
    .then(() => {
      const { is_public_contact } = setPublicContactSchema.parse(req.body);
      return setPublicContact(req.actor!, is_public_contact);
    })
    .then((view) => res.json(view))
    .catch(next);
});

// PATCH /api/v1/organizations/:organizationId/collaborators/:collaborationId - the owner changes a
// role; `role` is the only writable field and the strict schema refuses everything else
organizationRoutes.patch(
  '/:organizationId/collaborators/:collaborationId',
  loadActor,
  requireAbility('manage', 'Collaboration'),
  (req, res, next) => {
    Promise.resolve()
      .then(() => {
        const { collaborationId } = collaboratorParamsSchema.parse(req.params);
        const { role } = changeRoleSchema.parse(req.body);
        return changeRole(req.actor!, collaborationId, role);
      })
      .then((view) => res.json(view))
      .catch(next);
  }
);

// DELETE /api/v1/organizations/:organizationId/collaborators/:collaborationId - the owner revokes a
// collaborator; the body is never read
organizationRoutes.delete(
  '/:organizationId/collaborators/:collaborationId',
  loadActor,
  requireAbility('manage', 'Collaboration'),
  (req, res, next) => {
    Promise.resolve()
      .then(() => {
        const { collaborationId } = collaboratorParamsSchema.parse(req.params);
        return revokeCollaborator(req.actor!, collaborationId);
      })
      .then(() => res.status(204).end())
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/subscription - the owner records a subscription
organizationRoutes.post(
  '/:organizationId/subscription',
  loadActor,
  requireAbility('manage', 'Subscription'),
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = startSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    startSubscription(req.actor!, startSubscriptionSchema.parse(req.body))
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);

// GET /api/v1/organizations/:organizationId/subscription - any member reads the ACTIVE one
organizationRoutes.get('/:organizationId/subscription', loadActor, (req, res, next) => {
  getSubscription(req.actor!)
    .then((view) => res.json(view))
    .catch(next);
});

// DELETE /api/v1/organizations/:organizationId/subscription - the owner ends the ACTIVE one; the
// body is never read
organizationRoutes.delete(
  '/:organizationId/subscription',
  loadActor,
  requireAbility('manage', 'Subscription'),
  (req, res, next) => {
    endSubscription(req.actor!)
      .then(() => res.status(204).end())
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/transfer-ownership - the owner hands the business to
// another ACTIVE collaborator; needs the network (`transfer_ownership`)
organizationRoutes.post(
  '/:organizationId/transfer-ownership',
  loadActor,
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = transferOwnershipSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  // Replay comes before the ability check: after a first success the caller is no longer OWNER,
  // and a repeat must return the first answer, not 403 (AC-5).
  idempotent(),
  requireAbility('transfer_ownership', 'Organization'),
  (req, res, next) => {
    transferOwnership(req.actor!, transferOwnershipSchema.parse(req.body))
      .then((view) => res.status(200).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/close - the owner closes the business; needs the
// network (`close`)
organizationRoutes.post(
  '/:organizationId/close',
  loadActor,
  requireAbility('close', 'Organization'),
  // Strict validation before the idempotency key is reserved, so a bad body never reserves it.
  (req, _res, next) => {
    const parsed = closeOrganizationSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    closeOrganization(req.actor!, closeOrganizationSchema.parse(req.body))
      .then((view) => res.status(200).json(view))
      .catch(next);
  }
);

// POST /api/v1/organizations/:organizationId/reopen - the owner reopens a CLOSED business; needs
// the network (`reopen`). The body is the same strict `{ id }` gesture body as `close`.
organizationRoutes.post(
  '/:organizationId/reopen',
  loadActor,
  requireAbility('reopen', 'Organization'),
  (req, _res, next) => {
    const parsed = closeOrganizationSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    reopenOrganization(req.actor!)
      .then((view) => res.status(200).json(view))
      .catch(next);
  }
);

/** Invitation routes, mounted at `/collaborations`; the caller is always the invited person. */
export const collaborationRoutes = Router();

collaborationRoutes.use(authMiddleware);

// GET /api/v1/collaborations?status=INVITED - my pending invitations
collaborationRoutes.get('/', (req, res, next) => {
  Promise.resolve()
    .then(() => listMyInvitations(req.user!.id, listInvitationsQuerySchema.parse(req.query)))
    .then((page) => res.json(page))
    .catch(next);
});

// POST /api/v1/collaborations/:id/accept - the body is never read, so no field can be assigned
collaborationRoutes.post('/:id/accept', (req, res, next) => {
  Promise.resolve()
    .then(() => acceptInvitation(req.user!.id, collaborationIdParamsSchema.parse(req.params).id))
    .then(() => res.status(204).end())
    .catch(next);
});

// POST /api/v1/collaborations/:id/decline
collaborationRoutes.post('/:id/decline', (req, res, next) => {
  Promise.resolve()
    .then(() => declineInvitation(req.user!.id, collaborationIdParamsSchema.parse(req.params).id))
    .then(() => res.status(204).end())
    .catch(next);
});
