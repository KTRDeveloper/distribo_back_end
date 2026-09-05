/**
 * TypeScript interfaces for user module
 */

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  status: string;
  emailVerified: boolean;
  createdAt: Date;
}

export interface UpdateProfileInput {
  name?: string;
}
