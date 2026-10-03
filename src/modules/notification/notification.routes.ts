import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { listNotificationsQuerySchema } from './notification.schemas.js';
import { notificationRepository } from './notification.repository.js';

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
