import bcrypt from 'bcrypt';
import { authRepository, toAuthUser } from './auth.repository.js';
import { signToken } from '../../lib/jwt.js';
import { logger } from '../../lib/logger.js';
import { generateOtp, hashOtp, verifyOtp } from '../../lib/otp.js';
import { enqueueOtpDelivery } from '../../lib/otp-delivery-queue.js';
import { checkAndConsume } from '../../lib/rate-limit.js';
import type {
  RegisterInput,
  RegisterVerifyInput,
  RegisterResendInput,
  LoginInput,
  PasswordResetRequestInput,
  PasswordResetConfirmInput,
  EmailVerifyRequestInput,
  EmailVerifyConfirmInput,
  AuthResponse,
} from './auth.types.js';

/**
 * Authentication service
 * Implements business logic for authentication.
 *
 * Login is phone number + password only — no OTP (specs/002-sms-otp-auth/,
 * revised). OTP is used at registration (to verify the phone number before
 * the account can log in) and for password reset, where it is sent by SMS
 * always and, additionally, by email when the account's email is verified.
 */

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OTP_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 30;
const OTP_HOURLY_REQUEST_LIMIT = 5;
const OTP_HOURLY_WINDOW_SECONDS = 60 * 60;
const OTP_VERIFY_RATE_LIMIT = 10;
const OTP_VERIFY_WINDOW_SECONDS = 5 * 60;

const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function genericOtpSentResponse() {
  return { message: 'If the phone number is registered, a verification code has been sent' };
}

async function enforceOtpRequestRateLimit(phoneNumber: string, purpose: string) {
  const cooldown = await checkAndConsume(
    `otp:cooldown:${purpose}:${phoneNumber}`,
    1,
    OTP_RESEND_COOLDOWN_SECONDS
  );
  if (!cooldown.allowed) {
    throw Object.assign(new Error('Please wait before requesting another code'), {
      statusCode: 429,
      code: 'OTP_COOLDOWN',
    });
  }

  const hourly = await checkAndConsume(
    `otp:hourly:${purpose}:${phoneNumber}`,
    OTP_HOURLY_REQUEST_LIMIT,
    OTP_HOURLY_WINDOW_SECONDS
  );
  if (!hourly.allowed) {
    throw Object.assign(new Error('Too many code requests. Please try again later'), {
      statusCode: 429,
      code: 'OTP_RATE_LIMITED',
    });
  }
}

async function enforceOtpVerifyRateLimit(phoneNumber: string, purpose: string) {
  const result = await checkAndConsume(
    `otp:verify:${purpose}:${phoneNumber}`,
    OTP_VERIFY_RATE_LIMIT,
    OTP_VERIFY_WINDOW_SECONDS
  );
  if (!result.allowed) {
    throw Object.assign(new Error('Too many attempts. Please try again later'), {
      statusCode: 429,
      code: 'OTP_VERIFY_RATE_LIMITED',
    });
  }
}

/**
 * Validate a submitted OTP against the account's active challenge for the
 * given purpose. Throws on failure; returns the consumed challenge on
 * success. Shared by registration verification and password-reset
 * confirmation.
 */
async function verifyOtpChallenge(
  accountId: string,
  purpose: 'REGISTRATION' | 'PASSWORD_RESET',
  code: string
) {
  const challenge = await authRepository.findActiveOtpChallenge(accountId, purpose);

  if (!challenge || challenge.attempts >= MAX_OTP_ATTEMPTS) {
    throw Object.assign(new Error('Invalid or expired code'), {
      statusCode: 400,
      code: 'INVALID_OTP',
    });
  }

  const isValid = await verifyOtp(code, challenge.codeHash);

  if (!isValid) {
    await authRepository.incrementOtpAttempts(challenge.id);
    throw Object.assign(new Error('Invalid or expired code'), {
      statusCode: 400,
      code: 'INVALID_OTP',
    });
  }

  await authRepository.consumeOtpChallenge(challenge.id);
  return challenge;
}

/**
 * Track a failed OTP verification against the account's existing
 * failed-attempt/lockout counters, locking the account after too many
 * failures. Rethrows the original error unless a lockout error takes over.
 */
async function trackFailedOtpVerification(accountId: string, failedLoginAttempts: number) {
  const newAttempts = failedLoginAttempts + 1;
  await authRepository.updateFailedLoginAttempts(accountId, newAttempts);

  if (newAttempts >= MAX_FAILED_ATTEMPTS) {
    const lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
    await authRepository.lockAccount(accountId, lockUntil);
    throw Object.assign(new Error('Too many failed attempts. Account locked for 30 minutes'), {
      statusCode: 423,
      code: 'ACCOUNT_LOCKED',
    });
  }
}

export const authService = {
  /**
   * Register a new account with just name + phone + password. The account
   * cannot log in until the phone number is verified via OTP.
   */
  async register(input: RegisterInput): Promise<{ message: string }> {
    const hashedPassword = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const account = await authRepository.register({
      password: hashedPassword,
      name: input.name,
      phoneNumber: input.phoneNumber,
    });

    await enforceOtpRequestRateLimit(input.phoneNumber, 'REGISTRATION');

    const code = generateOtp();
    const codeHash = await hashOtp(code);

    await authRepository.createOtpChallenge({
      accountId: account.id,
      purpose: 'REGISTRATION',
      channel: 'SMS',
      codeHash,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
    });

    await enqueueOtpDelivery({
      channel: 'SMS',
      to: account.person.phoneNumber,
      message: `Your verification code is ${code}. It expires in 5 minutes.`,
    });

    logger.info({ accountId: account.id }, 'Account registered; phone verification OTP sent');

    return { message: 'Account created. Enter the verification code sent to your phone number.' };
  },

  /**
   * Verify the registration OTP, mark the phone number verified, and
   * immediately sign the user in.
   */
  async verifyRegistration(input: RegisterVerifyInput): Promise<AuthResponse> {
    await enforceOtpVerifyRateLimit(input.phoneNumber, 'REGISTRATION');

    const account = await authRepository.findByPhoneNumber(input.phoneNumber);
    if (!account || account.deletedAt) {
      throw Object.assign(new Error('Invalid or expired code'), {
        statusCode: 400,
        code: 'INVALID_OTP',
      });
    }

    if (account.lockedUntil && account.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60000);
      throw Object.assign(
        new Error(`Account is locked. Try again in ${remainingMinutes} minutes`),
        { statusCode: 423, code: 'ACCOUNT_LOCKED' }
      );
    }

    try {
      await verifyOtpChallenge(account.id, 'REGISTRATION', input.code);
    } catch (error) {
      await trackFailedOtpVerification(account.id, account.failedLoginAttempts);
      throw error;
    }

    await authRepository.markPhoneVerified(account.personId);
    await authRepository.resetFailedLoginAttempts(account.id);

    const verifiedAccount = await authRepository.findById(account.id);

    const token = signToken({
      accountId: account.id,
      phoneNumber: account.person.phoneNumber,
      tokenVersion: account.tokenVersion,
    });

    logger.info({ accountId: account.id }, 'Phone number verified; account activated');

    return {
      token,
      user: toAuthUser(verifiedAccount!),
    };
  },

  /**
   * Resend the registration OTP for a phone number that has not yet been
   * verified. Responds identically whether the phone number is unknown,
   * already verified, or a fresh code was actually sent, to avoid
   * disclosing account existence or verification state.
   */
  async resendRegistrationOtp(input: RegisterResendInput): Promise<{ message: string }> {
    await enforceOtpRequestRateLimit(input.phoneNumber, 'REGISTRATION');

    const account = await authRepository.findByPhoneNumber(input.phoneNumber);
    if (!account || account.deletedAt || account.person.phoneVerifiedAt) {
      logger.warn(
        { phoneNumber: input.phoneNumber },
        'Registration OTP resend requested for unknown or already-verified phone number'
      );
      return genericOtpSentResponse();
    }

    if (account.lockedUntil && account.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60000);
      throw Object.assign(
        new Error(`Account is locked. Try again in ${remainingMinutes} minutes`),
        { statusCode: 423, code: 'ACCOUNT_LOCKED' }
      );
    }

    const code = generateOtp();
    const codeHash = await hashOtp(code);

    await authRepository.createOtpChallenge({
      accountId: account.id,
      purpose: 'REGISTRATION',
      channel: 'SMS',
      codeHash,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
    });

    await enqueueOtpDelivery({
      channel: 'SMS',
      to: account.person.phoneNumber,
      message: `Your verification code is ${code}. It expires in 5 minutes.`,
    });

    logger.info({ accountId: account.id }, 'Registration OTP resent');

    return genericOtpSentResponse();
  },

  /**
   * Login with phone number + password.
   */
  async login(input: LoginInput): Promise<AuthResponse> {
    const account = await authRepository.findByPhoneNumber(input.phoneNumber);
    if (!account || account.deletedAt) {
      throw Object.assign(new Error('Invalid phone number or password'), {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
    }

    if (account.lockedUntil && account.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60000);
      throw Object.assign(
        new Error(`Account is locked. Try again in ${remainingMinutes} minutes`),
        { statusCode: 423, code: 'ACCOUNT_LOCKED' }
      );
    }

    if (!account.person.phoneVerifiedAt) {
      throw Object.assign(
        new Error('Phone number not verified. Complete registration verification first'),
        { statusCode: 403, code: 'PHONE_NOT_VERIFIED' }
      );
    }

    const isValidPassword = await bcrypt.compare(input.password, account.passwordHash);

    if (!isValidPassword) {
      const newAttempts = account.failedLoginAttempts + 1;
      await authRepository.updateFailedLoginAttempts(account.id, newAttempts);

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
      throw Object.assign(new Error('Invalid phone number or password'), {
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
    }

    await authRepository.resetFailedLoginAttempts(account.id);

    const token = signToken({
      accountId: account.id,
      phoneNumber: account.person.phoneNumber,
      tokenVersion: account.tokenVersion,
    });

    logger.info({ accountId: account.id }, 'Account logged in successfully');

    return {
      token,
      user: toAuthUser(account),
    };
  },

  /**
   * Request a password-reset OTP. Always sent by SMS; additionally sent by
   * email when the account's email is verified (not a user choice — both
   * channels carry the same code whenever email is eligible).
   */
  async requestPasswordReset(input: PasswordResetRequestInput): Promise<{ message: string }> {
    await enforceOtpRequestRateLimit(input.phoneNumber, 'PASSWORD_RESET');

    const account = await authRepository.findByPhoneNumber(input.phoneNumber);
    if (!account || account.deletedAt) {
      logger.warn(
        { phoneNumber: input.phoneNumber },
        'Password reset requested for unknown phone number'
      );
      return genericOtpSentResponse();
    }

    const code = generateOtp();
    const codeHash = await hashOtp(code);

    await authRepository.createOtpChallenge({
      accountId: account.id,
      purpose: 'PASSWORD_RESET',
      channel: 'SMS',
      codeHash,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
    });

    await enqueueOtpDelivery({
      channel: 'SMS',
      to: account.person.phoneNumber,
      message: `Your password reset code is ${code}. It expires in 5 minutes.`,
    });

    const emailEligible = Boolean(account.person.emailVerifiedAt && account.person.email);
    if (emailEligible) {
      await enqueueOtpDelivery({
        channel: 'EMAIL',
        to: account.person.email!,
        subject: 'Your password reset code',
        message: `Your password reset code is ${code}. It expires in 5 minutes.`,
      });
    }

    logger.info(
      { accountId: account.id, alsoSentByEmail: emailEligible },
      'Password reset OTP requested'
    );

    return genericOtpSentResponse();
  },

  /**
   * Confirm a password reset: verify the OTP, set the new password, and
   * invalidate any previously issued sessions/tokens for the account.
   */
  async confirmPasswordReset(input: PasswordResetConfirmInput): Promise<{ message: string }> {
    await enforceOtpVerifyRateLimit(input.phoneNumber, 'PASSWORD_RESET');

    const account = await authRepository.findByPhoneNumber(input.phoneNumber);
    if (!account || account.deletedAt) {
      throw Object.assign(new Error('Invalid or expired code'), {
        statusCode: 400,
        code: 'INVALID_OTP',
      });
    }

    if (account.lockedUntil && account.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60000);
      throw Object.assign(
        new Error(`Account is locked. Try again in ${remainingMinutes} minutes`),
        { statusCode: 423, code: 'ACCOUNT_LOCKED' }
      );
    }

    try {
      await verifyOtpChallenge(account.id, 'PASSWORD_RESET', input.code);
    } catch (error) {
      await trackFailedOtpVerification(account.id, account.failedLoginAttempts);
      throw error;
    }

    const hashedPassword = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    // updatePassword also bumps tokenVersion, which invalidates every
    // previously issued JWT for this account (checked in the auth middleware).
    await authRepository.updatePassword(account.id, hashedPassword);
    await authRepository.resetFailedLoginAttempts(account.id);

    logger.info({ accountId: account.id }, 'Password reset successfully via OTP');

    return { message: 'Password reset successfully' };
  },

  /**
   * Request verification of an email address (also how an email gets set on
   * the account at all, since registration never collects one). Confirming
   * it only ever unlocks the email password-reset delivery channel — it
   * grants no sign-in capability.
   */
  async requestEmailVerification(
    accountId: string,
    input: EmailVerifyRequestInput
  ): Promise<{ message: string }> {
    const account = await authRepository.findById(accountId);
    if (!account) {
      throw Object.assign(new Error('Account not found'), {
        statusCode: 404,
        code: 'ACCOUNT_NOT_FOUND',
      });
    }

    const code = generateOtp();
    const codeHash = await hashOtp(code);

    await authRepository.createEmailVerificationRequest({
      accountId: account.id,
      email: input.email,
      codeHash,
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS),
    });

    await enqueueOtpDelivery({
      channel: 'EMAIL',
      to: input.email,
      subject: 'Verify your email address',
      message: `Your email verification code is ${code}. It expires in 24 hours.`,
    });

    logger.info({ accountId: account.id }, 'Email verification requested');

    return { message: 'Verification code sent to the provided email address' };
  },

  /**
   * Confirm an email verification request. Sets the email on the account.
   */
  async confirmEmailVerification(
    accountId: string,
    input: EmailVerifyConfirmInput
  ): Promise<{ message: string }> {
    const account = await authRepository.findById(accountId);
    if (!account) {
      throw Object.assign(new Error('Account not found'), {
        statusCode: 404,
        code: 'ACCOUNT_NOT_FOUND',
      });
    }

    const request = await authRepository.findActiveEmailVerificationRequest(account.id);
    if (!request) {
      throw Object.assign(new Error('Invalid or expired verification code'), {
        statusCode: 400,
        code: 'INVALID_VERIFICATION_CODE',
      });
    }

    const isValid = await verifyOtp(input.code, request.codeHash);
    if (!isValid) {
      throw Object.assign(new Error('Invalid or expired verification code'), {
        statusCode: 400,
        code: 'INVALID_VERIFICATION_CODE',
      });
    }

    await authRepository.confirmEmailVerificationRequest(request.id, account.personId, request.email);

    logger.info({ accountId: account.id }, 'Email verified successfully');

    return { message: 'Email verified successfully' };
  },
};
