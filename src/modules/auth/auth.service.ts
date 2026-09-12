import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { authRepository, toAuthUser } from './auth.repository.js';
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
   * Register a new account
   */
  async register(input: RegisterInput): Promise<AuthResponse> {
    // Check if an account already exists for this email
    const existingAccount = await authRepository.findByEmail(input.email);
    if (existingAccount) {
      throw Object.assign(new Error('An account with this email already exists'), {
        statusCode: 409,
        code: 'USER_EXISTS',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    // Create account (reuses an existing guest Person by phone number, if any)
    const account = await authRepository.register({
      email: input.email,
      password: hashedPassword,
      name: input.name,
      phoneNumber: input.phoneNumber,
    });

    // Generate JWT token
    const token = signToken({
      accountId: account.id,
      email: input.email,
    });

    logger.info({ accountId: account.id }, 'Account registered successfully');

    return {
      token,
      user: toAuthUser(account),
    };
  },

  /**
   * Login
   */
  async login(input: LoginInput): Promise<AuthResponse> {
    // Find account
    const account = await authRepository.findByEmail(input.email);
    if (!account) {
      throw Object.assign(new Error('Invalid email or password'), {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Reject login for a deleted account
    if (account.deletedAt) {
      throw Object.assign(new Error('This account has been deleted'), {
        statusCode: 401,
        code: 'ACCOUNT_DELETED',
      });
    }

    // Check if account is locked
    if (account.lockedUntil && account.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60000);
      throw Object.assign(
        new Error(`Account is locked. Try again in ${remainingMinutes} minutes`),
        {
          statusCode: 423,
          code: 'ACCOUNT_LOCKED',
        }
      );
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(input.password, account.passwordHash);

    if (!isValidPassword) {
      // Increment failed login attempts
      const newAttempts = account.failedLoginAttempts + 1;
      await authRepository.updateFailedLoginAttempts(account.id, newAttempts);

      // Lock account if max attempts reached
      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
        await authRepository.lockAccount(account.id, lockUntil);
        logger.warn({ accountId: account.id }, 'Account locked due to failed login attempts');
        throw Object.assign(new Error('Too many failed attempts. Account locked for 30 minutes'), {
          statusCode: 423,
          code: 'ACCOUNT_LOCKED',
        });
      }

      logger.warn({ accountId: account.id, attempts: newAttempts }, 'Failed login attempt');
      throw Object.assign(new Error('Invalid email or password'), {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Reset failed login attempts
    await authRepository.resetFailedLoginAttempts(account.id);

    // Generate JWT token
    const token = signToken({
      accountId: account.id,
      email: account.person.email ?? input.email,
    });

    logger.info({ accountId: account.id }, 'Account logged in successfully');

    return {
      token,
      user: toAuthUser(account),
    };
  },

  /**
   * Request password reset
   */
  async requestPasswordReset(input: PasswordResetRequestInput): Promise<{ message: string }> {
    const account = await authRepository.findByEmail(input.email);

    // Always return success to prevent email enumeration
    if (!account) {
      logger.warn({ email: input.email }, 'Password reset requested for non-existent email');
      return { message: 'If the email exists, a password reset link has been sent' };
    }

    // Generate secure token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

    // Save token to database
    await authRepository.createPasswordResetToken({
      accountId: account.id,
      token,
      expiresAt,
    });

    // TODO: Send email with reset link
    // For now, log the token (in production, send via email service)
    logger.info(
      { accountId: account.id, token },
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
    await authRepository.updatePassword(resetToken.accountId, hashedPassword);

    // Mark token as used
    await authRepository.markTokenAsUsed(resetToken.id);

    logger.info({ accountId: resetToken.accountId }, 'Password reset successfully');

    return { message: 'Password reset successfully' };
  },
};
