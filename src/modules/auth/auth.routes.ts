import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authMiddleware } from '../../middleware/auth.js';

/**
 * Authentication routes
 */
export const authRoutes = Router();

// POST /auth/register - Register a new account (name + phone + password only)
authRoutes.post('/register', (req, res, next) => {
  authController.register(req, res).catch(next);
});

// POST /auth/register/verify - Verify the registration OTP and activate the account
authRoutes.post('/register/verify', (req, res, next) => {
  authController.verifyRegistration(req, res).catch(next);
});

// POST /auth/login - Login with phone number + password (no OTP)
authRoutes.post('/login', (req, res, next) => {
  authController.login(req, res).catch(next);
});

// POST /auth/password-reset/request - Request a password-reset OTP (SMS always, email too if verified)
authRoutes.post('/password-reset/request', (req, res, next) => {
  authController.requestPasswordReset(req, res).catch(next);
});

// POST /auth/password-reset/confirm - Confirm password reset with the OTP
authRoutes.post('/password-reset/confirm', (req, res, next) => {
  authController.confirmPasswordReset(req, res).catch(next);
});

// POST /auth/email/verify/request - Request email verification (authenticated)
authRoutes.post('/email/verify/request', authMiddleware, (req, res, next) => {
  authController.requestEmailVerification(req, res).catch(next);
});

// POST /auth/email/verify/confirm - Confirm email verification (authenticated)
authRoutes.post('/email/verify/confirm', authMiddleware, (req, res, next) => {
  authController.confirmEmailVerification(req, res).catch(next);
});
