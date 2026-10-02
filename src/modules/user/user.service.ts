import { userRepository } from './user.repository.js';
import type { UserProfile, UpdateProfileInput } from './user.types.js';

/**
 * User service
 * Implements business logic for user management
 */

export const userService = {
  /**
   * Get user profile by ID
   */
  async getProfile(userId: string): Promise<UserProfile> {
    const user = await userRepository.findById(userId);

    if (!user) {
      throw Object.assign(new Error('User not found'), {
        statusCode: 404,
        code: 'USER_NOT_FOUND',
      });
    }

    return user;
  },

  /**
   * Update user profile
   */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
    const user = await userRepository.updateProfile(userId, input);
    return user;
  },
};
