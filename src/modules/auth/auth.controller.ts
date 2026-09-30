import { Request, Response } from 'express';
import { authService } from './auth.service.js';
import {
  registerSchema,
  registerVerifySchema,
  registerResendSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  emailVerifyRequestSchema,
  emailVerifyConfirmSchema,
  refreshSchema,
  logoutSchema,
} from './auth.schemas.js';

/**
 * Authentication controller
 * Handles HTTP requests for authentication endpoints
 */

export const authController = {
  /**
   * POST /auth/register
   */
  async register(req: Request, res: Response) {
    const input = registerSchema.parse(req.body);
    const result = await authService.register(input);
    res.status(201).json(result);
  },

  /**
   * POST /auth/register/verify
   */
  async verifyRegistration(req: Request, res: Response) {
    const input = registerVerifySchema.parse(req.body);
    const result = await authService.verifyRegistration(input);
    res.json(result);
  },

  /**
   * POST /auth/register/resend
   */
  async resendRegistration(req: Request, res: Response) {
    const input = registerResendSchema.parse(req.body);
    const result = await authService.resendRegistrationOtp(input);
    res.status(202).json(result);
  },

  /**
   * POST /auth/login
   */
  async login(req: Request, res: Response) {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input);
    res.json(result);
  },

  /**
   * POST /auth/password-reset/request
   */
  async requestPasswordReset(req: Request, res: Response) {
    const input = passwordResetRequestSchema.parse(req.body);
    const result = await authService.requestPasswordReset(input);
    res.status(202).json(result);
  },

  /**
   * POST /auth/password-reset/confirm
   */
  async confirmPasswordReset(req: Request, res: Response) {
    const input = passwordResetConfirmSchema.parse(req.body);
    const result = await authService.confirmPasswordReset(input);
    res.json(result);
  },

  /**
   * POST /auth/email/verify/request
   */
  async requestEmailVerification(req: Request, res: Response) {
    const input = emailVerifyRequestSchema.parse(req.body);
    const result = await authService.requestEmailVerification(req.user!.id, input);
    res.status(202).json(result);
  },

  /**
   * POST /auth/email/verify/confirm
   */
  async confirmEmailVerification(req: Request, res: Response) {
    const input = emailVerifyConfirmSchema.parse(req.body);
    const result = await authService.confirmEmailVerification(req.user!.id, input);
    res.json(result);
  },

  /**
   * POST /auth/refresh
   */
  async refresh(req: Request, res: Response) {
    const input = refreshSchema.parse(req.body);
    const result = await authService.refresh(input);
    res.json(result);
  },

  /**
   * POST /auth/logout
   */
  async logout(req: Request, res: Response) {
    const input = logoutSchema.parse(req.body);
    await authService.logout(input);
    res.status(204).send();
  },

  /**
   * POST /auth/logout-all
   */
  async logoutAll(req: Request, res: Response) {
    await authService.logoutAll(req.user!.id);
    res.status(204).send();
  },
};
