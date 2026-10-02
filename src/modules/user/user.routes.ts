import { Router } from 'express';
import { userController } from './user.controller.js';
import { authMiddleware } from '../../middleware/auth.js';

/**
 * User routes
 * All routes require authentication
 */
export const userRoutes = Router();

// Apply auth middleware to all user routes
userRoutes.use(authMiddleware);

// GET /api/users/me - Get current user profile
userRoutes.get('/me', (req, res, next) => {
  userController.getProfile(req, res).catch(next);
});

// PATCH /api/users/me - Update current user profile
userRoutes.patch('/me', (req, res, next) => {
  userController.updateProfile(req, res).catch(next);
});
