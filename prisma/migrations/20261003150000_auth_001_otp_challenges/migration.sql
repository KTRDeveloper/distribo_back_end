ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'LOGIN';
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'PHONE_CHANGE';
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFICATION';
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'TOTP_RECOVERY';

CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "person_id" UUID,
    "target" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "channel" "OtpChannel" NOT NULL DEFAULT 'SMS',
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "otp_challenges_attempts_check" CHECK ("attempts" <= 5),
    CONSTRAINT "otp_challenges_sms_target_check" CHECK ("channel" <> 'SMS' OR "target" LIKE '+237%'),
    CONSTRAINT "otp_challenges_person_id_fkey" FOREIGN KEY ("person_id")
        REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "otp_challenges_target_purpose_created_at_idx"
    ON "otp_challenges"("target", "purpose", "created_at" DESC);
