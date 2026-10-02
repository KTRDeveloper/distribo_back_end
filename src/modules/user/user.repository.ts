import { prisma } from '../../lib/db.js';
import type { Prisma } from '@prisma/client';
import type { Profile, UpdateProfileInput } from './user.types.js';

const profileSelect = {
  id: true,
  fullName: true,
  phoneNumber: true,
  phoneVerifiedAt: true,
  email: true,
  emailVerifiedAt: true,
  preferredLanguage: true,
  registeredAt: true,
  scopeVersion: true,
  createdAt: true,
} satisfies Prisma.PersonSelect;

type ProfileRow = Prisma.PersonGetPayload<{ select: typeof profileSelect }>;

function toProfile(person: ProfileRow): Profile {
  return {
    id: person.id,
    full_name: person.fullName,
    phone_number: person.phoneNumber,
    phone_verified: person.phoneVerifiedAt !== null,
    email: person.email,
    email_verified: person.emailVerifiedAt !== null,
    preferred_language: person.preferredLanguage,
    registered: person.registeredAt !== null,
    scope_version: person.scopeVersion,
    created_at: person.createdAt,
  };
}

export const userRepository = {
  /** Selects only the fields that may be exposed by the self-profile API. */
  async findById(id: string): Promise<Profile | null> {
    const person = await prisma.person.findUnique({
      where: { id },
      select: profileSelect,
    });
    return person ? toProfile(person) : null;
  },

  /** Updates only profile fields authorized by the strict request schema. */
  async updateProfile(id: string, input: UpdateProfileInput): Promise<Profile | null> {
    const data: Prisma.PersonUpdateInput = {};

    if (input.full_name !== undefined) data.fullName = input.full_name;
    if (input.preferred_language !== undefined) data.preferredLanguage = input.preferred_language;
    if (input.email !== undefined) {
      data.email = input.email;
      data.emailVerifiedAt = null;
    }

    const result = await prisma.person.updateManyAndReturn({
      where: { id },
      data,
      select: profileSelect,
    });
    const person = result[0];
    return person ? toProfile(person) : null;
  },
};
