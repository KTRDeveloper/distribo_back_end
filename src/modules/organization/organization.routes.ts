import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { createOrganizationSchema } from './organization.schemas.js';
import { createOrganization } from './organization.service.js';

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
