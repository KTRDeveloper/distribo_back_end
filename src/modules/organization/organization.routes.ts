import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import {
  createOrganizationSchema,
  inviteCollaboratorSchema,
  listOrganizationsQuerySchema,
} from './organization.schemas.js';
import {
  createOrganization,
  getOrganizationDetails,
  inviteCollaborator,
  listMyOrganizations,
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
