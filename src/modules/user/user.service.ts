import { httpError } from '../../lib/http-error.js';
import { userRepository } from './user.repository.js';
import type { Profile, UpdateProfileInput } from './user.types.js';

export const userService = {
  /** Returns the explicitly allowlisted profile for the authenticated person. */
  async getProfile(personId: string): Promise<Profile> {
    const profile = await userRepository.findById(personId);
    if (!profile) throw httpError(404, 'NOT_FOUND', 'Profile not found');
    return profile;
  },

  /** Applies self-service fields only to the identity supplied by authentication. */
  async updateProfile(personId: string, input: UpdateProfileInput): Promise<Profile> {
    const profile = await userRepository.updateProfile(personId, input);
    if (!profile) throw httpError(404, 'NOT_FOUND', 'Profile not found');
    return profile;
  },
};
