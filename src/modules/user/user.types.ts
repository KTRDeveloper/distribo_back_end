/**
 * TypeScript interfaces for user module
 */

export interface UserProfile {
  id: string;
  email: string | null;
  name: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface UpdateProfileInput {
  name?: string;
}
