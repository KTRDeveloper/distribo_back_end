import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { loadActor } from '../../middleware/load-actor.js';
import { createOrganizationSchema, listOrganizationsQuerySchema } from './organization.schemas.js';
import {
  createOrganization,
  getOrganizationDetails,
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
