import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { OtpPurpose } from '@prisma/client';
import { prisma } from '../../setup';

const mobile = '+237677123456';
const ORG_ID = '0199c023-0000-7000-8000-0000000000b1';
const PERSON_ID = '0199c023-0000-7000-8000-0000000000b2';
const CONTACT_ID = '0199c023-0000-7000-8000-0000000000b3';

/** ORG-023: a code for a business contact must carry that contact, others must not. */
async function insert(purpose: string) {
  const contactId = purpose === 'ORG_CONTACT_VERIFICATION' ? CONTACT_ID : null;
  return prisma.$executeRaw`
    INSERT INTO otp_challenges
      (id, person_id, target, purpose, code_hash, expires_at, organization_contact_id)
    VALUES (gen_random_uuid(), NULL, ${mobile}, ${purpose}::"OtpPurpose", 'hash',
            now() + interval '5 minutes', ${contactId}::uuid)`;
}

async function clean() {
  await prisma.$executeRaw`DELETE FROM otp_challenges`;
  await prisma.$executeRaw`DELETE FROM organization_contacts WHERE organization_id = ${ORG_ID}::uuid`;
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${ORG_ID}::uuid`;
  await prisma.$executeRaw`DELETE FROM people WHERE id = ${PERSON_ID}::uuid`;
}

beforeEach(async () => {
  await clean();
  await prisma.$executeRaw`
    INSERT INTO people (id, phone_number, created_at, server_updated_at)
    VALUES (${PERSON_ID}::uuid, '+237677099024', now(), now())`;
  await prisma.$executeRaw`
    INSERT INTO organizations (id, name) VALUES (${ORG_ID}::uuid, 'Fixture Business')`;
  await prisma.$executeRaw`
    INSERT INTO organization_contacts (id, organization_id, kind, slot, value, created_by_id)
    VALUES (${CONTACT_ID}::uuid, ${ORG_ID}::uuid, 'PHONE'::"OrganizationContactKind", 1, ${mobile},
            ${PERSON_ID}::uuid)`;
});

afterAll(clean);

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
