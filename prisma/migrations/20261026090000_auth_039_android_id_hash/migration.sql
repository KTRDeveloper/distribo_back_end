ALTER TYPE "RefreshTokenRevokedReason" ADD VALUE IF NOT EXISTS 'REPLACED';

ALTER TABLE "devices" ADD COLUMN "android_id_hash" TEXT;

-- C-59: at most one open device per person and phone fingerprint.
CREATE UNIQUE INDEX "devices_person_id_android_id_hash_open_key"
    ON "devices"("person_id", "android_id_hash")
    WHERE "revoked_at" IS NULL AND "android_id_hash" IS NOT NULL;
