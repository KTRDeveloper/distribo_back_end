import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { deleteAccount, deletionCheck, isDeletionBlocked } from './privacy.service.js';
import { deleteAccountBodySchema } from './privacy.schemas.js';

/** Privacy routes, mounted at /users/me/deletion-check; all require authentication. */
export const privacyRoutes = Router();

privacyRoutes.use(authMiddleware);

// GET /api/v1/users/me/deletion-check - what blocks deleting my account
privacyRoutes.get('/', (req, res, next) => {
  deletionCheck(req.user!.id)
    .then((result) => res.json(result))
    .catch(next);
});

/** Account routes, mounted at /users/me; authentication is per route so other /users/me paths are unaffected. */
export const accountRoutes = Router();

// DELETE /api/v1/users/me - delete my account by anonymization (password required)
accountRoutes.delete('/', authMiddleware, (req, res, next) => {
  const parsed = deleteAccountBodySchema.safeParse(req.body);
  if (!parsed.success) {
    next(parsed.error);
    return;
  }
  deleteAccount(req.user!.id, parsed.data)
    .then(() => res.status(204).end())
    .catch((err: unknown) => {
      if (isDeletionBlocked(err)) {
        // Map to the standard error shape, plus the blockers the caller must resolve.
        res.status(409).json({
          error: {
            code: 'DELETION_BLOCKED',
            message: err.message,
            blockers: err.blockers,
            requestId: req.requestId,
          },
        });
        return;
      }
      next(err);
    });
});
