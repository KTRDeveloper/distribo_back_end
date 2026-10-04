import { Router } from 'express';
import { adminAuthMiddleware, requireAdminRole } from '../../middleware/admin-auth.js';
import { authMiddleware } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotent.js';
import {
  createReportSchema,
  listReportsQuerySchema,
  reportIdParamsSchema,
  resolveReportSchema,
} from './admin.schemas.js';
import { createReport, getReport, listReports, resolveReport } from './admin.service.js';
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

/** Moderator report routes, mounted under /api/v1/admin/reports; admin token only. */
export const adminReportRoutes = Router();

adminReportRoutes.use(adminAuthMiddleware, requireAdminRole('MODERATOR'));

// GET /api/v1/admin/reports - paginated list; PENDING oldest first, otherwise newest first
adminReportRoutes.get('/', (req, res, next) => {
  const query = listReportsQuerySchema.parse(req.query);
  listReports(query)
    .then((page) => res.status(200).json(page))
    .catch(next);
});

// GET /api/v1/admin/reports/{reportId} - one report with its reporter and target
adminReportRoutes.get('/:reportId', (req, res, next) => {
  const { reportId } = reportIdParamsSchema.parse(req.params);
  getReport(reportId)
    .then((view) => res.status(200).json(view))
    .catch(next);
});

// POST /api/v1/admin/reports/{reportId}/resolve - dismiss the report or suspend its target
adminReportRoutes.post('/:reportId/resolve', (req, res, next) => {
  const { reportId } = reportIdParamsSchema.parse(req.params);
  const body = resolveReportSchema.parse(req.body);
  resolveReport(req.admin!, reportId, body)
    .then((view) => res.status(200).json(view))
    .catch(next);
});
