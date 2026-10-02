export interface Profile {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  phone_verified: boolean;
  email: string | null;
  email_verified: boolean;
  preferred_language: 'FR' | 'EN' | null;
  registered: boolean;
  scope_version: number;
  created_at: Date;
}

export type UserProfile = Profile;

export interface UpdateProfileInput {
  full_name?: string;
  preferred_language?: 'FR' | 'EN';
  email?: string | null;
}
