import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import { createReportSchema } from './admin.schemas.js';
import { createReport } from './admin.service.js';
import './admin.openapi.js';

/** Report routes, mounted under /api/v1/reports; any signed-in person may report. */
export const reportRoutes = Router();

reportRoutes.use(authMiddleware);

// POST /api/v1/reports - a person reports another person or an organization
reportRoutes.post(
  '/',
  // Strict validation first, so an invalid body never reserves the idempotency key.
  (req, _res, next) => {
    const parsed = createReportSchema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    return next();
  },
  idempotent(),
  (req, res, next) => {
    createReport(req.user!.id, createReportSchema.parse(req.body))
      .then((view) => res.status(201).json(view))
      .catch(next);
  }
);
