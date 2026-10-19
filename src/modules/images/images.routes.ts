import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { imageBody } from '../../middleware/image-body.js';
import { removeAvatar, replaceAvatar } from './avatar.service.js';

/** Photo routes of the signed-in person, mounted at /users/me/avatar; all require authentication. */
export const avatarRoutes = Router();

// PUT /api/v1/users/me/avatar - add or replace my profile photo (raw image bytes)
// Authentication runs first, so an anonymous caller never reaches the body reader.
avatarRoutes.put('/', authMiddleware, imageBody(), (req, res, next) => {
  replaceAvatar(req.user!.id, req.body as Buffer)
    .then((result) => res.status(200).json(result))
    .catch(next);
});

// DELETE /api/v1/users/me/avatar - remove my profile photo
avatarRoutes.delete('/', authMiddleware, (req, res, next) => {
  removeAvatar(req.user!.id)
    .then(() => res.status(204).end())
    .catch(next);
});
