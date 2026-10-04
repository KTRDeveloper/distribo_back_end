import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { deletionCheck } from './privacy.service.js';

/** Privacy routes, mounted at /users/me/deletion-check; all require authentication. */
export const privacyRoutes = Router();

privacyRoutes.use(authMiddleware);

// GET /api/v1/users/me/deletion-check - what blocks deleting my account
privacyRoutes.get('/', (req, res, next) => {
  deletionCheck(req.user!.id)
    .then((result) => res.json(result))
    .catch(next);
});
