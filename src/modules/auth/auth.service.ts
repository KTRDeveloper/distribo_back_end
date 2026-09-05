import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { authRepository } from './auth.repository.js';
import { signToken } from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import type { RegisterInput, LoginInput, PasswordResetRequestInput, PasswordResetConfirmInput, AuthResponse } from './auth.types.js';

/**
 * Authentication service
 * Implements business logic for authentication
 */

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export const authService = {
  /**
   * Register a new user
   */
  async register(input: RegisterInput): Promise<AuthResponse> {
    // Check if user already exists
    const existingUser = await authRepository.findByEmail(input.email);
    if (existingUser) {
      throw Object.assign(new Error('User with this email already exists'), {
        statusCode: 409,
        code: 'USER_EXISTS',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    // Create user
    const user = await authRepository.createUser({
      email: input.email,
      password: hashedPassword,
      name: input.name,
    });

    // Generate JWT token
    const token = signToken({
      userId: user.id,
      email: user.email,
    });

    logger.info({ userId: user.id }, 'User registered successfully');

    return {
      token,
      user,
    };
  },

  /**
   * Login user
   */
  async login(input: LoginInput): Promise<AuthResponse> {
    // Find user
    const user = await authRepository.findByEmail(input.email);
    if (!user) {
      throw Object.assign(new Error('Invalid email or password'), {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw Object.assign(
        new Error(`Account is locked. Try again in ${remainingMinutes} minutes`),
        {
          statusCode: 423,
          code: 'ACCOUNT_LOCKED',
        }
      );
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(input.password, user.password);

    if (!isValidPassword) {
      // Increment failed login attempts
      const newAttempts = user.failedLoginAttempts + 1;
      await authRepository.updateFailedLoginAttempts(user.id, newAttempts);

      // Lock account if max attempts reached
      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
        await authRepository.lockAccount(user.id, lockUntil);
        logger.warn({ userId: user.id }, 'Account locked due to failed login attempts');
        throw Object.assign(new Error('Too many failed attempts. Account locked for 30 minutes'), {
          statusCode: 423,
          code: 'ACCOUNT_LOCKED',
        });
      }

      logger.warn({ userId: user.id, attempts: newAttempts }, 'Failed login attempt');
      throw Object.assign(new Error('Invalid email or password'), {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Reset failed login attempts
    await authRepository.resetFailedLoginAttempts(user.id);

    // Generate JWT token
    const token = signToken({
      userId: user.id,
      email: user.email,
    });

    logger.info({ userId: user.id }, 'User logged in successfully');

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      },
    };
  },

  /**
   * Request password reset
   */
  async requestPasswordReset(input: PasswordResetRequestInput): Promise<{ message: string }> {
    const user = await authRepository.findByEmail(input.email);

    // Always return success to prevent email enumeration
    if (!user) {
      logger.warn({ email: input.email }, 'Password reset requested for non-existent email');
      return { message: 'If the email exists, a password reset link has been sent' };
    }

    // Generate secure token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

    // Save token to database
    await authRepository.createPasswordResetToken({
      userId: user.id,
      token,
      expiresAt,
    });

    // TODO: Send email with reset link
    // For now, log the token (in production, send via email service)
    logger.info(
      { userId: user.id, token },
      'Password reset token generated (in production, send via email)'
    );

    return { message: 'If the email exists, a password reset link has been sent' };
  },

  /**
   * Confirm password reset
   */
  async confirmPasswordReset(input: PasswordResetConfirmInput): Promise<{ message: string }> {
    // Find valid token
    const resetToken = await authRepository.findPasswordResetToken(input.token);

    if (!resetToken) {
      throw Object.assign(new Error('Invalid or expired reset token'), {
        statusCode: 400,
        code: 'INVALID_TOKEN',
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

    // Update password
    await authRepository.updatePassword(resetToken.userId, hashedPassword);

    // Mark token as used
    await authRepository.markTokenAsUsed(resetToken.id);

    logger.info({ userId: resetToken.userId }, 'Password reset successfully');

    return { message: 'Password reset successfully' };
  },
};
