import { Router } from 'express';
import { adminAuthMiddleware, requireAdminRole } from '../../middleware/admin-auth.js';
import { authMiddleware } from '../../middleware/auth.js';
import { loadActor } from '../../middleware/load-actor.js';
import { registerCatalogAdapters } from './adapters/catalog.adapter.js';
import { registerIdentityAdapters } from './adapters/identity.adapter.js';
import { registerMoneyAdapters } from './adapters/money.adapter.js';
import { registerOrderAdapters } from './adapters/order.adapter.js';
import { registerRelationshipAdapters } from './adapters/relationship.adapter.js';
import { pushChanges } from './sync.push.js';
import {
  appVersionHeaderSchema,
  archiveIdParamsSchema,
  clientTimeHeaderSchema,
  issuesQuerySchema,
  pullQuerySchema,
  pushBodySchema,
  pushQuerySchema,
  replayBodySchema,
  scopeVersionHeaderSchema,
} from './sync.schemas.js';
import { listIssues, pull, replayArchive, syncExceptions } from './sync.service.js';
import { buildViewer } from './sync.viewer.js';
import './sync.openapi.js';

registerIdentityAdapters();
registerRelationshipAdapters();
registerCatalogAdapters();
registerOrderAdapters();
registerMoneyAdapters();

/** Sync routes; all require authentication. */
export const syncRoutes = Router();

syncRoutes.use(authMiddleware);

// GET /api/v1/sync/pull - what changed for the caller since the phone's last pull
syncRoutes.get('/pull', (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const lastPulledAt = pullQuerySchema.parse(req.query);
      const phoneScopeVersion = scopeVersionHeaderSchema.parse(req.header('x-scope-version'));
      const viewer = await buildViewer(req.user!.id, req.user!.deviceId);
      res.set('Cache-Control', 'no-store');
      res.json(await pull(viewer, lastPulledAt, phoneScopeVersion));
    })
    .catch(next);
});

// POST /api/v1/sync/push - what the phone did offline; the batch is archived, then judged
syncRoutes.post('/push', (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const lastPulledAt = pushQuerySchema.parse(req.query);
      const { changes } = pushBodySchema.parse(req.body);
      const appVersion = appVersionHeaderSchema.parse(req.header('x-app-version'));
      const clientTime = clientTimeHeaderSchema.parse(req.header('x-client-time'));
      const viewer = await buildViewer(req.user!.id, req.user!.deviceId);
      res.set('Cache-Control', 'no-store');
      res.json(
        await pushChanges(viewer, {
          lastPulledAt,
          changes,
          appVersion: appVersion ?? '',
          clientTime,
        })
      );
    })
    .catch(next);
});

// GET /api/v1/sync/issues - the caller's orders and deliveries the server flagged
syncRoutes.get('/issues', (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const query = issuesQuerySchema.parse(req.query);
      const viewer = await buildViewer(req.user!.id, req.user!.deviceId);
      res.set('Cache-Control', 'no-store');
      res.json(await listIssues(viewer, query));
    })
    .catch(next);
});

/** Synchronization exceptions of an organization, mounted at `/organizations/:organizationId`. */
export const syncExceptionRoutes = Router({ mergeParams: true });

// GET /api/v1/organizations/:organizationId/exceptions/sync - the OWNER reads the flagged
// operations grouped by cause. The service answers 403 below OWNER before it reads the query; the
// organization is the actor's, from the path through `loadActor`.
syncExceptionRoutes.get('/exceptions/sync', authMiddleware, loadActor, (req, res, next) => {
  syncExceptions(req.actor!, req.query as { from?: string; to?: string })
    .then((view) => res.json(view))
    .catch(next);
});

/** Archived batches, mounted at `/admin/sync-archives`; administration tokens only. */
export const syncArchiveRoutes = Router();

// POST /api/v1/admin/sync-archives/:archiveId/replay - a SUPER_ADMIN replays an archived batch,
// judged with its author's current rights; the role is checked before the body is read
syncArchiveRoutes.post(
  '/:archiveId/replay',
  adminAuthMiddleware,
  requireAdminRole('SUPER_ADMIN'),
  (req, res, next) => {
    Promise.resolve()
      .then(async () => {
        const { archiveId } = archiveIdParamsSchema.parse(req.params);
        const { reason } = replayBodySchema.parse(req.body);
        const result = await replayArchive(req.admin!, archiveId, { reason });
        res.set('Cache-Control', 'no-store');
        res.status(200).json(result);
      })
      .catch(next);
  }
);
