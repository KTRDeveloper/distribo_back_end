import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { loadActor } from '../../middleware/load-actor.js';
import { requireAbility } from '../../middleware/require-ability.js';
import { imageBody } from '../../middleware/image-body.js';
import { removeAvatar, replaceAvatar } from './avatar.service.js';
import { removeLogo, replaceLogo } from './logo.service.js';

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

/** Business logo routes, mounted at /organizations/:organizationId/logo; the owner only. */
export const logoRoutes = Router({ mergeParams: true });

// PUT /api/v1/organizations/:organizationId/logo - add or replace the logo (raw image bytes).
// The role is judged before the body is read, so a refused caller never makes the server read
// or process a photo (ASVS v5.0.0-8.2.1).
logoRoutes.put(
  '/',
  authMiddleware,
  loadActor,
  requireAbility('change_logo', 'Organization'),
  imageBody(),
  (req, res, next) => {
    replaceLogo(req.actor!, req.body as Buffer)
      .then((result) => res.status(200).json(result))
      .catch(next);
  }
);

// DELETE /api/v1/organizations/:organizationId/logo - remove the logo
logoRoutes.delete(
  '/',
  authMiddleware,
  loadActor,
  requireAbility('change_logo', 'Organization'),
  (req, res, next) => {
    removeLogo(req.actor!)
      .then(() => res.status(204).end())
      .catch(next);
  }
);
