import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import {
  emptyBodySchema,
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
} from './notification.schemas.js';
import { notificationRepository } from './notification.repository.js';
import { markAllRead, markRead } from './notification.service.js';

/** Notification routes; all require authentication. */
export const notificationRoutes = Router();

notificationRoutes.use(authMiddleware);

// GET /api/v1/notifications - the caller's notifications, newest first
notificationRoutes.get('/', (req, res, next) => {
  const query = listNotificationsQuerySchema.parse(req.query);
  notificationRepository
    .listNotifications(req.user!.id, query)
    .then((page) => res.json(page))
    .catch(next);
});

// POST /api/v1/notifications/read-all - mark all of the caller's notifications read
notificationRoutes.post('/read-all', (req, res, next) => {
  Promise.resolve()
    .then(() => {
      emptyBodySchema.parse(req.body ?? {});
      return markAllRead(req.user!.id);
    })
    .then(() => res.status(204).end())
    .catch(next);
});

// POST /api/v1/notifications/:id/read - mark one of the caller's notifications read
notificationRoutes.post('/:id/read', (req, res, next) => {
  Promise.resolve()
    .then(() => {
      const { id } = notificationIdParamsSchema.parse(req.params);
      emptyBodySchema.parse(req.body ?? {});
      return markRead(req.user!.id, id);
    })
    .then(() => res.status(204).end())
    .catch(next);
});
