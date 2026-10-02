import { prisma } from '../../lib/db.js';
import type { Person } from '@prisma/client';

/**
 * User repository
 * Handles database operations for user (Person) profile management
 *
 * Identity is stored in the unified `Person` model with all credentials
 * and profile information. See specs/person-v10/.
 */

/**
 * Flatten a Person record into the shape API responses expect.
 */
function toAuthUser(person: Person) {
  return {
    id: person.id,
    phoneNumber: person.phoneNumber,
    email: person.email,
    name: person.fullName,
    emailVerifiedAt: person.emailVerifiedAt,
    createdAt: person.createdAt,
  };
}

export const userRepository = {
  /**
   * Find person by ID
   */
  async findById(id: string) {
    const person = await prisma.person.findUnique({
      where: { id },
    });
    return person ? toAuthUser(person) : null;
  },

  /**
   * Update person's profile (name is stored on Person.fullName)
   */
  async updateProfile(id: string, data: { name?: string }) {
    const person = await prisma.person.update({
      where: { id },
      data: data.name !== undefined ? { fullName: data.name } : {},
    });
    return toAuthUser(person);
  },
};
