-- DropForeignKey
ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_accountId_fkey";

-- DropTable
DROP TABLE "password_reset_tokens";

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('SIGN_IN', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "channel" "OtpChannel" NOT NULL DEFAULT 'SMS',
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_requests" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_challenges_personId_purpose_consumedAt_idx" ON "otp_challenges"("personId", "purpose", "consumedAt");

-- CreateIndex
CREATE INDEX "otp_challenges_expiresAt_idx" ON "otp_challenges"("expiresAt");

-- CreateIndex
CREATE INDEX "email_verification_requests_personId_confirmedAt_idx" ON "email_verification_requests"("personId", "confirmedAt");

-- CreateIndex
CREATE INDEX "email_verification_requests_expiresAt_idx" ON "email_verification_requests"("expiresAt");

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_requests" ADD CONSTRAINT "email_verification_requests_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
