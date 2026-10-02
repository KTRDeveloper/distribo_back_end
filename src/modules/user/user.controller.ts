import { Request, Response } from 'express';
import { userService } from './user.service.js';
import { updateProfileSchema } from './user.schemas.js';

/**
 * User controller
 * Handles HTTP requests for user endpoints
 */

export const userController = {
  /**
   * GET /api/users/me
   */
  async getProfile(req: Request, res: Response) {
    if (!req.user) {
      res.status(401).json({
        error: {
          message: 'Unauthorized',
          code: 'UNAUTHORIZED',
        },
      });
      return;
    }

    const profile = await userService.getProfile(req.user.id);
    res.json(profile);
  },

  /**
   * PATCH /api/users/me
   */
  async updateProfile(req: Request, res: Response) {
    if (!req.user) {
      res.status(401).json({
        error: {
          message: 'Unauthorized',
          code: 'UNAUTHORIZED',
        },
      });
      return;
    }

    const input = updateProfileSchema.parse(req.body);
    const profile = await userService.updateProfile(req.user.id, input);
    res.json(profile);
  },
};
