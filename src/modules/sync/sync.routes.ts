import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { registerCatalogAdapters } from './adapters/catalog.adapter.js';
import { registerIdentityAdapters } from './adapters/identity.adapter.js';
import { registerOrderAdapters } from './adapters/order.adapter.js';
import { registerRelationshipAdapters } from './adapters/relationship.adapter.js';
import { pullQuerySchema } from './sync.schemas.js';
import { pullChanges } from './sync.service.js';
import { buildViewer } from './sync.viewer.js';
import './sync.openapi.js';

registerIdentityAdapters();
registerRelationshipAdapters();
registerCatalogAdapters();
registerOrderAdapters();

/** Sync routes; all require authentication. */
export const syncRoutes = Router();

syncRoutes.use(authMiddleware);

// GET /api/v1/sync/pull - what changed for the caller since the phone's last pull
syncRoutes.get('/pull', (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const lastPulledAt = pullQuerySchema.parse(req.query);
      const viewer = await buildViewer(req.user!.id, req.user!.deviceId);
      res.set('Cache-Control', 'no-store');
      res.json(await pullChanges(viewer, lastPulledAt));
    })
    .catch(next);
});
