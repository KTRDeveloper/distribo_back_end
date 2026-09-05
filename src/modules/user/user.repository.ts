import { prisma } from '../../lib/db.js';

/**
 * User repository
 * Handles database operations for user management
 */

export const userRepository = {
  /**
   * Find user by ID
   */
  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        emailVerified: true,
        createdAt: true,
      },
    });
  },

  /**
   * Update user profile
   */
  async updateProfile(id: string, data: { name?: string }) {
    return prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        emailVerified: true,
        createdAt: true,
      },
    });
  },
};
