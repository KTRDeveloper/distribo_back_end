import { prisma } from '../../lib/db.js';
import type {
  Account,
  Person,
  OtpChallenge,
  OtpPurpose,
  OtpChannel,
  EmailVerificationRequest,
  RefreshToken,
  RefreshTokenRevokedReason,
} from '@prisma/client';

/**
 * Authentication repository
 * Handles database operations for authentication.
 *
 * Identity is split across two models: `Person` (who someone is — phone
 * number, email, name) and `Account` (their login credentials, attached to
 * a Person). See specs/001-delivery-data-model/ and the plan that merged
 * the legacy `User` model into this split.
 *
 * Phone number is the sole sign-in anchor (specs/002-sms-otp-auth/); email
 * is only ever a secondary, verification-gated delivery channel for the
 * password-reset OTP — never a sign-in credential.
 */

export type AccountWithPerson = Account & { person: Person };

/**
 * Flatten an Account+Person pair into the shape API responses expect.
 */
export function toAuthUser(account: AccountWithPerson) {
  return {
    id: account.id,
    phoneNumber: account.person.phoneNumber,
    email: account.person.email,
    name: account.person.fullName,
    emailVerifiedAt: account.person.emailVerifiedAt,
    createdAt: account.createdAt,
  };
}

export const authRepository = {
  /**
   * Register a new Account, reusing an existing guest Person for the given
   * phone number if one exists (no account yet), or creating a new Person.
   * Only name + phone + password are collected here; email is added later
   * via the email-verification flow.
   */
  async register(data: {
    password: string;
    name: string;
    phoneNumber: string;
  }): Promise<AccountWithPerson> {
    const existingPerson = await prisma.person.findUnique({
      where: { phoneNumber: data.phoneNumber },
      include: { account: true },
    });

    if (existingPerson?.account) {
      throw Object.assign(new Error('An account already exists for this phone number'), {
        statusCode: 409,
        code: 'PHONE_EXISTS',
      });
    }

    if (existingPerson) {
      // Reuse the guest Person (created by an organization before this
      // person ever registered) and attach a new Account to it.
      return prisma.$transaction(async (tx) => {
        await tx.person.update({
          where: { id: existingPerson.id },
          data: { fullName: data.name },
        });

        return tx.account.create({
          data: {
            personId: existingPerson.id,
            passwordHash: data.password,
          },
          include: { person: true },
        });
      });
    }

    return prisma.account.create({
      data: {
        passwordHash: data.password,
        person: {
          create: {
            phoneNumber: data.phoneNumber,
            fullName: data.name,
          },
        },
      },
      include: { person: true },
    });
  },

  /**
   * Mark a person's phone number as verified (set at registration, once the
   * registration OTP is confirmed).
   */
  async markPhoneVerified(personId: string) {
    return prisma.person.update({
      where: { id: personId },
      data: { phoneVerifiedAt: new Date() },
    });
  },

  /**
   * Find an Account by its Person's email (registration uniqueness check only —
   * email is never used to sign in).
   */
  async findByEmail(email: string): Promise<AccountWithPerson | null> {
    return prisma.account.findFirst({
      where: { person: { email } },
      include: { person: true },
    });
  },

  /**
   * Find an Account by its Person's phone number — the sole sign-in anchor.
   */
  async findByPhoneNumber(phoneNumber: string): Promise<AccountWithPerson | null> {
    return prisma.account.findFirst({
      where: { person: { phoneNumber } },
      include: { person: true },
    });
  },

  /**
   * Find an Account by ID.
   */
  async findById(id: string): Promise<AccountWithPerson | null> {
    return prisma.account.findUnique({
      where: { id },
      include: { person: true },
    });
  },

  /**
   * Update account's failed login attempts
   */
  async updateFailedLoginAttempts(accountId: string, attempts: number) {
    return prisma.account.update({
      where: { id: accountId },
      data: {
        failedLoginAttempts: attempts,
        lastFailedLoginAt: new Date(),
      },
    });
  },

  /**
   * Lock account
   */
  async lockAccount(accountId: string, lockUntil: Date) {
    return prisma.account.update({
      where: { id: accountId },
      data: {
        lockedUntil: lockUntil,
      },
    });
  },

  /**
   * Reset failed login attempts
   */
  async resetFailedLoginAttempts(accountId: string) {
    return prisma.account.update({
      where: { id: accountId },
      data: {
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
        lastLoginAt: new Date(),
      },
    });
  },

  /**
   * Update account password (also records `passwordChangedAt` for audit
   * purposes). Session revocation is handled separately by the caller via
   * `revokeAllRefreshTokensForAccount` (specs/005-refresh-tokens/).
   */
  async updatePassword(accountId: string, hashedPassword: string) {
    return prisma.account.update({
      where: { id: accountId },
      data: {
        passwordHash: hashedPassword,
        passwordChangedAt: new Date(),
      },
    });
  },

  // ---------------------------------------------------------------------
  // OTP challenges (sign-in + password reset)
  // ---------------------------------------------------------------------

  /**
   * Invalidate any prior unconsumed challenges for this account+purpose,
   * then create a new one. Ensures only the most recently issued challenge
   * for a given (accountId, purpose) pair is ever usable.
   */
  async createOtpChallenge(data: {
    accountId: string;
    purpose: OtpPurpose;
    channel: OtpChannel;
    codeHash: string;
    expiresAt: Date;
  }): Promise<OtpChallenge> {
    return prisma.$transaction(async (tx) => {
      await tx.otpChallenge.updateMany({
        where: { accountId: data.accountId, purpose: data.purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      return tx.otpChallenge.create({ data });
    });
  },

  /**
   * Find the currently active (not consumed, not expired) challenge for an
   * account+purpose, regardless of channel.
   */
  async findActiveOtpChallenge(
    accountId: string,
    purpose: OtpPurpose
  ): Promise<OtpChallenge | null> {
    return prisma.otpChallenge.findFirst({
      where: {
        accountId,
        purpose,
        consumedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Increment the verification-attempt counter on a challenge.
   */
  async incrementOtpAttempts(challengeId: string) {
    return prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
  },

  /**
   * Mark a challenge as successfully consumed.
   */
  async consumeOtpChallenge(challengeId: string) {
    return prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { consumedAt: new Date() },
    });
  },

  // ---------------------------------------------------------------------
  // Email verification (gates the secondary password-reset email channel)
  // ---------------------------------------------------------------------

  async createEmailVerificationRequest(data: {
    accountId: string;
    email: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<EmailVerificationRequest> {
    return prisma.$transaction(async (tx) => {
      await tx.emailVerificationRequest.updateMany({
        where: { accountId: data.accountId, confirmedAt: null },
        data: { confirmedAt: new Date() },
      });

      return tx.emailVerificationRequest.create({ data });
    });
  },

  async findActiveEmailVerificationRequest(
    accountId: string
  ): Promise<EmailVerificationRequest | null> {
    return prisma.emailVerificationRequest.findFirst({
      where: {
        accountId,
        confirmedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async confirmEmailVerificationRequest(requestId: string, personId: string, email: string) {
    return prisma.$transaction(async (tx) => {
      await tx.emailVerificationRequest.update({
        where: { id: requestId },
        data: { confirmedAt: new Date() },
      });

      // Persist the now-verified email onto the person — registration never
      // collects an email, so this is the first time it's set.
      return tx.person.update({
        where: { id: personId },
        data: { email, emailVerifiedAt: new Date() },
      });
    });
  },

  // ---------------------------------------------------------------------
  // Refresh tokens (sessions) — see specs/005-refresh-tokens/data-model.md
  // ---------------------------------------------------------------------

  /**
   * Persist a newly issued refresh token (hash only — the raw value is
   * never stored).
   */
  async createRefreshToken(data: {
    accountId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return prisma.refreshToken.create({ data });
  },

  /**
   * Find a refresh token by its hash regardless of state (rotated/revoked/
   * expired) — reuse detection needs to see already-rotated rows too.
   */
  async findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  },

  /**
   * Mark a refresh token as rotated (exchanged for a new one). A rotated
   * token being presented again is how token-theft/replay is detected.
   */
  async markRefreshTokenRotated(id: string): Promise<RefreshToken> {
    return prisma.refreshToken.update({
      where: { id },
      data: { rotatedAt: new Date() },
    });
  },

  /**
   * Revoke a single refresh token (e.g. explicit single-device logout).
   */
  async revokeRefreshToken(id: string, reason: RefreshTokenRevokedReason): Promise<RefreshToken> {
    return prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  },

  /**
   * Revoke every currently-valid refresh token for an account (logout-all,
   * password reset, account lockout, or reuse-detected compromise).
   */
  async revokeAllRefreshTokensForAccount(
    accountId: string,
    reason: RefreshTokenRevokedReason
  ): Promise<{ count: number }> {
    return prisma.refreshToken.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  },
};
