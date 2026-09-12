import { prisma } from '../../lib/db.js';
import { toAuthUser, type AccountWithPerson } from '../auth/auth.repository.js';

/**
 * User repository
 * Handles database operations for user (Account+Person) profile management
 */

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
