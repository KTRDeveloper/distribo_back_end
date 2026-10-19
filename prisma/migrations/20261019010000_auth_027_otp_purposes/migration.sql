-- AUTH-027: two new one-time code purposes. Existing rows keep their purpose.
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'ORG_CONTACT_VERIFICATION';
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'ACCESS_RESTORE';
