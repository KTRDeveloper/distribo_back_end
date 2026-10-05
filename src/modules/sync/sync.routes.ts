import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { registerCatalogAdapters } from './adapters/catalog.adapter.js';
import { registerIdentityAdapters } from './adapters/identity.adapter.js';
import { registerMoneyAdapters } from './adapters/money.adapter.js';
import { registerOrderAdapters } from './adapters/order.adapter.js';
import { registerRelationshipAdapters } from './adapters/relationship.adapter.js';
import { pushChanges } from './sync.push.js';
import {
  appVersionHeaderSchema,
  clientTimeHeaderSchema,
  issuesQuerySchema,
  pullQuerySchema,
  pushBodySchema,
  pushQuerySchema,
  scopeVersionHeaderSchema,
} from './sync.schemas.js';
import { listIssues, pull } from './sync.service.js';
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
