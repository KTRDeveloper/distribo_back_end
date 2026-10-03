ALTER TYPE "RefreshTokenRevokedReason" ADD VALUE IF NOT EXISTS 'DEVICE_REMOVED';
ALTER TYPE "RefreshTokenRevokedReason" ADD VALUE IF NOT EXISTS 'ACCOUNT_SUSPENDED';

CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS');

CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "model" TEXT,
    "push_token" TEXT,
    "app_version" TEXT NOT NULL,
    "last_synced_at" TIMESTAMPTZ,
    "scope_version_seen" INTEGER NOT NULL DEFAULT 0,
    "integrity_verdict" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "devices_person_id_fkey" FOREIGN KEY ("person_id")
        REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "devices_person_id_active_idx" ON "devices"("person_id") WHERE "revoked_at" IS NULL;

CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" "RefreshTokenRevokedReason",

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refresh_tokens_revoked_check" CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL)),
    CONSTRAINT "refresh_tokens_person_id_fkey" FOREIGN KEY ("person_id")
        REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "refresh_tokens_device_id_fkey" FOREIGN KEY ("device_id")
        REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_person_id_idx" ON "refresh_tokens"("person_id");
CREATE INDEX "refresh_tokens_device_id_idx" ON "refresh_tokens"("device_id");
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
