import { prisma } from '../../lib/db.js';
import type { Account, Person } from '@prisma/client';

/**
 * User repository
 * Handles database operations for user (Account+Person) profile management
 *
 * Identity is split across two models: `Person` (who someone is — phone
 * number, email, name) and `Account` (their login credentials, attached to
 * a Person). See specs/001-delivery-data-model/.
 */

export type AccountWithPerson = Account & { person: Person };

/**
 * Flatten an Account+Person pair into the shape API responses expect.
 */
function toAuthUser(account: AccountWithPerson) {
  return {
    id: account.id,
    phoneNumber: account.person.phoneNumber,
    email: account.person.email,
    name: account.person.fullName,
    emailVerifiedAt: account.person.emailVerifiedAt,
    createdAt: account.createdAt,
  };
}

export const userRepository = {
  /**
   * Find account by ID
   */
  async findById(id: string) {
    const account = await prisma.account.findUnique({
      where: { id },
      include: { person: true },
    });
    return account ? toAuthUser(account as AccountWithPerson) : null;
  },

  /**
   * Update account holder's profile (name lives on the linked Person)
   */
  async updateProfile(id: string, data: { name?: string }) {
    const account = await prisma.account.update({
      where: { id },
      data: {
        person: data.name !== undefined ? { update: { fullName: data.name } } : undefined,
      },
      include: { person: true },
    });
    return toAuthUser(account as AccountWithPerson);
  },
};
