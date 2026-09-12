/**
 * TypeScript interfaces for authentication module
 */

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  phoneNumber: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface PasswordResetRequestInput {
  email: string;
}

export interface PasswordResetConfirmInput {
  token: string;
  newPassword: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string | null;
    name: string | null;
    emailVerifiedAt: Date | null;
    createdAt: Date;
  };
}
