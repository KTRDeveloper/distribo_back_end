import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OtpPurpose } from '@prisma/client';
import { prisma } from '../../setup';

const mobile = '+237677123456';

async function insert(purpose: string) {
  return prisma.$executeRaw`
    INSERT INTO otp_challenges (id, person_id, target, purpose, code_hash, expires_at)
    VALUES (gen_random_uuid(), NULL, ${mobile}, ${purpose}::"OtpPurpose", 'hash',
            now() + interval '5 minutes')`;
}

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
});

describe('otp_challenges purposes', () => {
  it.each(['ORG_CONTACT_VERIFICATION', 'ACCESS_RESTORE', 'LOGIN', 'TOTP_RECOVERY'])(
    'purposes: accepts %s',
    async (purpose) => {
      await expect(insert(purpose)).resolves.toBe(1);
    }
  );

  it('client enum', () => {
    expect(Object.keys(OtpPurpose).sort()).toEqual(
      [
        'REGISTRATION',
        'LOGIN',
        'PASSWORD_RESET',
        'PHONE_CHANGE',
        'EMAIL_VERIFICATION',
        'TOTP_RECOVERY',
        'ORG_CONTACT_VERIFICATION',
        'ACCESS_RESTORE',
      ].sort()
    );
  });

  it('unlisted purpose', async () => {
    for (const purpose of ['ADMIN_OVERRIDE', 'NEW_DEVICE']) {
      await expect(insert(purpose)).rejects.toThrow(/22P02|invalid input value for enum/i);
    }
  });
});
