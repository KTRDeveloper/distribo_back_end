import { prisma } from '../../lib/db.js';
import type { Account, Person } from '@prisma/client';

/**
 * Authentication repository
 * Handles database operations for authentication.
 *
 * Identity is split across two models: `Person` (who someone is — phone
 * number, email, name) and `Account` (their login credentials, attached to
 * a Person). See specs/001-delivery-data-model/ and the plan that merged
 * the legacy `User` model into this split.
 */

export type AccountWithPerson = Account & { person: Person };

/**
 * Flatten an Account+Person pair into the shape API responses expect.
 */
export function toAuthUser(account: AccountWithPerson) {
  return {
    id: account.id,
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
   */
  async register(data: {
    email: string;
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
          data: {
            fullName: data.name,
            email: data.email,
          },
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
            email: data.email,
          },
        },
      },
      include: { person: true },
    });
  },

  /**
   * Find an Account by its Person's email.
   */
  async findByEmail(email: string): Promise<AccountWithPerson | null> {
    return prisma.account.findFirst({
      where: { person: { email } },
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
   * Create password reset token
   */
  async createPasswordResetToken(data: { accountId: string; token: string; expiresAt: Date }) {
    return prisma.passwordResetToken.create({
      data,
    });
  },

  /**
   * Find valid password reset token
   */
  async findPasswordResetToken(token: string) {
    return prisma.passwordResetToken.findFirst({
      where: {
        token,
        used: false,
        expiresAt: {
          gte: new Date(),
        },
      },
      include: {
        account: { include: { person: true } },
      },
    });
  },

  /**
   * Mark password reset token as used
   */
  async markTokenAsUsed(tokenId: string) {
    return prisma.passwordResetToken.update({
      where: { id: tokenId },
      data: { used: true },
    });
  },

  /**
   * Update account password
   */
  async updatePassword(accountId: string, hashedPassword: string) {
    return prisma.account.update({
      where: { id: accountId },
      data: { passwordHash: hashedPassword },
    });
  },
};
