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

  /** Latest challenge (by created_at) for a target and purpose. */
  findLatest(target: string, purpose: OtpPurpose) {
    return prisma.otpChallenge.findFirst({
      where: { target, purpose },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  },

  /** Atomically count one attempt; false when 5 are used or the code is consumed. */
  async reserveAttempt(id: string, maxAttempts: number): Promise<boolean> {
    const r = await prisma.otpChallenge.updateMany({
      where: { id, attempts: { lt: maxAttempts }, consumedAt: null },
      data: { attempts: { increment: 1 } },
    });
    return r.count === 1;
  },

  /** Atomically consume; false when already consumed. */
  async consume(id: string): Promise<boolean> {
    const r = await prisma.otpChallenge.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return r.count === 1;
  },
};
