/**
 * TypeScript interfaces for authentication module
 */

export type OtpPurpose = 'REGISTRATION' | 'PASSWORD_RESET';

export interface RegisterInput {
  name: string;
  phoneNumber: string;
  password: string;
}

export interface RegisterVerifyInput {
  phoneNumber: string;
  code: string;
}

export interface RegisterResendInput {
  phoneNumber: string;
}

export interface LoginInput {
  phoneNumber: string;
  password: string;
}

export interface PasswordResetRequestInput {
  phoneNumber: string;
}

export interface PasswordResetConfirmInput {
  phoneNumber: string;
  code: string;
  newPassword: string;
}

export interface EmailVerifyRequestInput {
  email: string;
}

export interface EmailVerifyConfirmInput {
  code: string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface LogoutInput {
  refreshToken: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  user: {
    id: string;
    phoneNumber: string;
    email: string | null;
    name: string | null;
    emailVerifiedAt: Date | null;
    createdAt: Date;
  };
}
