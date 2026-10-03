import { prisma } from '../../lib/db.js';
import { newId } from '../../shared/ids.js';

export type OtpPurpose =
  | 'REGISTRATION'
  | 'LOGIN'
  | 'PASSWORD_RESET'
  | 'PHONE_CHANGE'
  | 'EMAIL_VERIFICATION'
  | 'TOTP_RECOVERY';

export type OtpChallengeInsert = {
  personId: string | null;
  target: string;
  purpose: OtpPurpose;
  channel: 'SMS' | 'EMAIL';
  codeHash: string;
  expiresAt: Date;
};

/** Database operations for one-time code challenges. */
export const otpRepository = {
  async createChallenge(input: OtpChallengeInsert): Promise<string> {
    const id = newId();
    await prisma.otpChallenge.create({ data: { id, ...input } });
    return id;
  },
};
