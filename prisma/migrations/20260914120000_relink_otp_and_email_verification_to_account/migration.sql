-- Relink otp_challenges and email_verification_requests to accounts instead
-- of people: every code path that creates these rows already requires an
-- existing Account (see src/modules/auth/auth.service.ts), so the FK should
-- reflect that invariant instead of pointing at the broader Person identity.

-- DropForeignKey
ALTER TABLE "otp_challenges" DROP CONSTRAINT "otp_challenges_personId_fkey";

-- DropForeignKey
ALTER TABLE "email_verification_requests" DROP CONSTRAINT "email_verification_requests_personId_fkey";

-- DropIndex
DROP INDEX "otp_challenges_personId_purpose_consumedAt_idx";

-- DropIndex
DROP INDEX "email_verification_requests_personId_confirmedAt_idx";

-- AlterTable: add accountId, backfill via the (1:1) person -> account join,
-- then drop personId. Any row whose person has no account is a short-lived
-- challenge (5 min - 24 h expiry) that can't correspond to a real flow, so
-- it's dropped rather than blocking the migration.
ALTER TABLE "otp_challenges" ADD COLUMN "accountId" TEXT;

UPDATE "otp_challenges" oc
SET "accountId" = a."id"
FROM "accounts" a
WHERE a."personId" = oc."personId";

DELETE FROM "otp_challenges" WHERE "accountId" IS NULL;

ALTER TABLE "otp_challenges" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "otp_challenges" DROP COLUMN "personId";

-- AlterTable: same treatment for email_verification_requests
ALTER TABLE "email_verification_requests" ADD COLUMN "accountId" TEXT;

UPDATE "email_verification_requests" evr
SET "accountId" = a."id"
FROM "accounts" a
WHERE a."personId" = evr."personId";

DELETE FROM "email_verification_requests" WHERE "accountId" IS NULL;

ALTER TABLE "email_verification_requests" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "email_verification_requests" DROP COLUMN "personId";

-- CreateIndex
CREATE INDEX "otp_challenges_accountId_purpose_consumedAt_idx" ON "otp_challenges"("accountId", "purpose", "consumedAt");

-- CreateIndex
CREATE INDEX "email_verification_requests_accountId_confirmedAt_idx" ON "email_verification_requests"("accountId", "confirmedAt");

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_requests" ADD CONSTRAINT "email_verification_requests_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
